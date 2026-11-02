/**
 * oidc.config.js
 * Builds and exports the configured node-oidc-provider instance.
 *
 * Design decisions captured from the definitive plan:
 *  - accessTokenFormat: 'jwt'  (RS256) — required so the API gateway can
 *    validate tokens offline via JWKS; opaque is the library default.
 *  - proxy: true  — we're behind the API gateway; trust X-Forwarded-* headers.
 *  - devInteractions: false  — we provide our own interaction UI.
 *  - All routes remapped to /oauth/* to avoid collision with /auth/* paths.
 *  - rotateRefreshToken: true  — library handles family invalidation on reuse.
 *  - clientCredentials + introspection + revocation + resourceIndicators enabled.
 *  - custom grant urn:iacms:grant:api_key enabled for M2M API key token exchange.
 *  - OIDC client discovery happens via a DB-backed find function (dynamic clients).
 *  - OIDC_JWKS_JSON env var must be a JSON string containing the JWKS with RS256 key.
 */

import Provider from 'oidc-provider';
import { PrismaAdapter } from './prisma.adapter.js';
import { findAccount } from './find-account.js';
import { decryptClientSecret } from './client-secret.utils.js';
import { GRANT_TYPE, apiKeyGrantHandler, PARAMETERS } from './grants/api-key.grant.js';
import prisma from '../config/database.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('iam-oidc');

// ── JWKS ─────────────────────────────────────────────────────────────────────

function loadJwks() {
  const raw = process.env.OIDC_JWKS_JSON;
  if (!raw) {
    throw new Error(
      '[oidc.config] OIDC_JWKS_JSON env var is missing. ' +
        'Set it to a JSON string with a JWKS containing at least one RS256 signing key.',
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('[oidc.config] OIDC_JWKS_JSON is not valid JSON.');
  }
}

// ── Dynamic client lookup ────────────────────────────────────────────────────

/**
 * The library calls this function when it needs to resolve a client_id that is
 * not hard-coded in the `clients` array of the config.
 * We look it up in the OAuthClient table and return the shape the library expects.
 */
async function findClient(clientId) {
  // Built-in dedicated M2M client for API key exchanges without separate client secret
  if (clientId === 'iacms_api_key_client') {
    return {
      client_id: 'iacms_api_key_client',
      client_name: 'IACMS Dedicated API Key Client',
      redirect_uris: [],
      grant_types: [GRANT_TYPE],
      response_types: [],
      scope: 'openid roles api_key',
      token_endpoint_auth_method: 'none',
      [Symbol.for('tenant_id')]: null,
    };
  }

  const record = await prisma.oAuthClient.findUnique({
    where: { clientId, isActive: true },
  });
  if (!record) return undefined;

  // Decrypt the secret on the fly — library needs plaintext for comparison
  let clientSecret;
  if (record.clientSecretCiphertext) {
    try {
      clientSecret = decryptClientSecret(record.clientSecretCiphertext);
    } catch (err) {
      logger.error('Failed to decrypt client secret', { clientId, error: err.message });
      return undefined;
    }
  }

  const configuredGrants = Array.isArray(record.grantTypes) ? record.grantTypes : ['authorization_code'];
  // Support custom API key grant on registered clients
  const grant_types = Array.from(new Set([...configuredGrants, GRANT_TYPE]));

  return {
    client_id: record.clientId,
    client_secret: clientSecret,
    client_name: record.name,
    redirect_uris: Array.isArray(record.redirectUris) ? record.redirectUris : [],
    grant_types,
    response_types: Array.isArray(record.responseTypes) ? record.responseTypes : ['code'],
    scope: record.scope || 'openid profile email',
    token_endpoint_auth_method: record.tokenEndpointAuthMethod || 'client_secret_basic',
    // Pass tenant context for isolation checks in the interaction controller
    [Symbol.for('tenant_id')]: record.tenantId ?? null,
  };
}

// ── Provider configuration ───────────────────────────────────────────────────

const ISSUER = process.env.OIDC_ISSUER || 'http://localhost:3001';

const config = {
  // ── Storage ──────────────────────────────────────────────────────────────
  adapter: PrismaAdapter,

  // ── Account resolution ───────────────────────────────────────────────────
  findAccount,

  // ── Dynamic client resolution (DB-backed) ────────────────────────────────
  clients: [], // No hard-coded clients — all resolved dynamically
  // The library calls this when a client_id is not in the `clients` array.
  // Assign after construction (see bottom of file).

  // ── JWKS ──────────────────────────────────────────────────────────────────
  jwks: loadJwks(),

  // ── Token format ──────────────────────────────────────────────────────────
  // CRITICAL: must be 'jwt' — default is 'opaque' which breaks offline validation.
  // customizers.jwt embeds custom claims (tenant_id, roles, api_key_id) into the Access Token JWT.
  formats: {
    AccessToken: 'jwt',
    ClientCredentials: 'jwt',
    customizers: {
      async jwt(ctx, token, structuredToken) {
        // Embed custom claims attached directly to the token (e.g. from API Key grant)
        if (token.get?.('api_key_id')) {
          structuredToken.payload.api_key_id = token.get('api_key_id');
        }
        if (token.get?.('tenant_id')) {
          structuredToken.payload.tenant_id = token.get('tenant_id');
        }
        if (token.get?.('tenant_code')) {
          structuredToken.payload.tenant_code = token.get('tenant_code');
        }
        if (token.get?.('roles')) {
          structuredToken.payload.roles = token.get('roles');
        }

        if (token.accountId) {
          const account = await findAccount(ctx, token.accountId);
          if (account) {
            const claims = await account.claims('access_token', token.scope);
            if (claims.tenant_id) structuredToken.payload.tenant_id = claims.tenant_id;
            if (claims.tenant_code) structuredToken.payload.tenant_code = claims.tenant_code;
            if (claims.roles) structuredToken.payload.roles = claims.roles;
            if (claims.department_id) structuredToken.payload.department_id = claims.department_id;
          }
        } else if (token.clientId) {
          const client = await prisma.oAuthClient.findUnique({
            where: { clientId: token.clientId },
            select: { tenantId: true },
          });
          if (client?.tenantId && !structuredToken.payload.tenant_id) {
            structuredToken.payload.tenant_id = client.tenantId;
          }
        }
      },
    },
  },

  // ── Cookie secret ─────────────────────────────────────────────────────────
  cookies: {
    keys: [process.env.OIDC_COOKIE_SECRET || (() => { throw new Error('[oidc.config] OIDC_COOKIE_SECRET is required'); })()],
    short: { sameSite: 'Lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' },
    long: { sameSite: 'Lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' },
  },

  // ── Enabled features ──────────────────────────────────────────────────────
  features: {
    // M2M flows
    clientCredentials: { enabled: true },

    // Token management
    introspection: { enabled: true },
    revocation: { enabled: true },

    // Audience-scoped access tokens
    resourceIndicators: {
      enabled: true,
      defaultResource: (_ctx, _client) => process.env.OIDC_DEFAULT_RESOURCE || 'https://api.iacms.local',
      getResourceServerInfo: (_ctx, resourceIndicator) => ({
        scope: 'openid profile email roles api_key',
        audience: resourceIndicator,
        accessTokenFormat: 'jwt',
        accessTokenTTL: 60 * 60, // 1h
        jwt: { sign: { alg: 'RS256' } },
      }),
      useGrantedResource: () => true,
    },

    // Disable the built-in dev UI — we bring our own
    devInteractions: { enabled: false },
  },

  // ── Scopes ────────────────────────────────────────────────────────────────
  scopes: ['openid', 'offline_access', 'profile', 'email', 'roles', 'api_key'],

  // ── Claims mapping ────────────────────────────────────────────────────────
  claims: {
    openid: ['sub'],
    profile: ['name', 'given_name', 'family_name', 'department_id', 'tenant_id', 'tenant_code'],
    email: ['email', 'email_verified'],
    roles: ['roles'],
    api_key: ['api_key_id'],
  },

  // ── Token TTLs ────────────────────────────────────────────────────────────
  ttl: {
    AccessToken: 60 * 60,           // 1h
    AuthorizationCode: 60,          // 60s (spec minimum)
    ClientCredentials: 60 * 60,     // 1h
    Grant: 14 * 24 * 60 * 60,       // 14d
    IdToken: 60 * 60,               // 1h
    Interaction: 60 * 60,           // 1h
    RefreshToken: 14 * 24 * 60 * 60, // 14d
    Session: 14 * 24 * 60 * 60,     // 14d
  },

  // ── Refresh token rotation ────────────────────────────────────────────────
  // Library handles family invalidation on reuse-detect automatically
  rotateRefreshToken: true,

  // ── Interaction endpoint ───────────────────────────────────────────────────
  interactions: {
    // Our interaction controller lives at /oauth/interaction/:uid
    url(_ctx, interaction) {
      return `/oauth/interaction/${interaction.uid}`;
    },
  },

  // ── Route remapping ───────────────────────────────────────────────────────
  // Map all well-known OIDC endpoints to /oauth/* to avoid collision with /auth/*
  routes: {
    authorization:   '/oauth/authorize',
    backchannel_authentication: '/oauth/backchannel',
    code_verification: '/oauth/device',
    device_authorization: '/oauth/device/auth',
    end_session:     '/oauth/session/end',
    introspection:   '/oauth/token/introspect',
    jwks:            '/oauth/jwks',
    pushed_authorization_request: '/oauth/par',
    registration:    '/oauth/register',
    revocation:      '/oauth/token/revoke',
    token:           '/oauth/token',
    userinfo:        '/oauth/userinfo',
  },

  // ── Discovery document ────────────────────────────────────────────────────
  extraParams: ['tenant_code'],

  // ── Proxy trust ───────────────────────────────────────────────────────────
  proxy: true,

  // ── CORS ───────────────────────────────────────────────────────────────────
  // Allow per-client origins based on their registered redirect_uris for token/userinfo
  clientBasedCORS(ctx, origin, client) {
    if (!origin) return false;
    try {
      const allowedOrigins = (client.redirectUris || []).map((uri) => {
        try { return new URL(uri).origin; } catch { return null; }
      }).filter(Boolean);
      return allowedOrigins.includes(origin);
    } catch {
      return false;
    }
  },

  // ── RS256 signing algorithm (v8/v9 enabledJWA schema) ─────────────────────
  enabledJWA: {
    clientAuthSigningAlgValues: ['RS256', 'PS256'],
    idTokenSigningAlgValues: ['RS256'],
    requestObjectSigningAlgValues: ['RS256', 'PS256'],
    userinfoSigningAlgValues: ['RS256'],
    introspectionSigningAlgValues: ['RS256', 'PS256'],
    authorizationSigningAlgValues: ['RS256', 'PS256'],
  },
};

// ── Build provider ────────────────────────────────────────────────────────────

const provider = new Provider(ISSUER, config);

// Wire up the dynamic client resolver (must be done after instantiation)
provider.Client.find = findClient;

// Register custom grant: urn:iacms:grant:api_key (Phase 5)
provider.registerGrantType(GRANT_TYPE, apiKeyGrantHandler, PARAMETERS);

// Surface library errors through our logger
provider.on('server_error', (ctx, err) => {
  logger.error('OIDC server error', { error: err.message, stack: err.stack, path: ctx?.path });
});

provider.on('authorization.error', (ctx, err) => {
  logger.warn('OIDC authorization error', { error: err.message, path: ctx?.path });
});

export default provider;
