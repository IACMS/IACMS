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

import Provider, { errors as OIDC_ERRORS } from 'oidc-provider';
import { PrismaAdapter } from './prisma.adapter.js';
import { findAccount } from './find-account.js';
import { decryptClientSecret } from './client-secret.utils.js';
import { GRANT_TYPE, apiKeyGrantHandler, PARAMETERS } from './grants/api-key.grant.js';
import prisma from '../config/database.js';
import Logger from '#iam/iamLogger.js';
import { loadJwks } from './jwks.js';
export { loadJwks } from './jwks.js';

const logger = new Logger('iam-oidc');

// ── JWKS ─────────────────────────────────────────────────────────────────────

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
      [Symbol.for('iam_organization_id')]: null,
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
    [Symbol.for('iam_organization_id')]: record.iamOrganizationId ?? null,
    [Symbol.for('target_audience')]: record.targetAudience ?? null,
  };
}

// ── Provider configuration ───────────────────────────────────────────────────

const ISSUER = process.env.OIDC_ISSUER || 'http://localhost:3001';
const STANDARD_SCOPES = ['openid', 'offline_access', 'profile', 'email', 'roles', 'api_key', 'iam:admin'];
const STANDARD_RESOURCE_SCOPES = ['openid', 'profile', 'email', 'roles', 'api_key', 'iam:admin'];

function readScopeList(value, fallback) {
  if (!value?.trim()) return fallback;
  return [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))];
}

const supportedScopes = readScopeList(process.env.OIDC_SUPPORTED_SCOPES, STANDARD_SCOPES);
const resourceScopes = readScopeList(process.env.OIDC_RESOURCE_SCOPES, STANDARD_RESOURCE_SCOPES);

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
        if (token.get?.('api_key_owner_id')) {
          structuredToken.payload.api_key_owner_id = token.get('api_key_owner_id');
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

        let clientRecord = null;
        if (token.clientId) {
          clientRecord = await prisma.oAuthClient.findUnique({
            where: { clientId: token.clientId },
            select: { id: true, clientId: true, tenantId: true, iamOrganizationId: true, targetAudience: true },
          });
          if (clientRecord?.tenantId && !structuredToken.payload.tenant_id) {
            structuredToken.payload.tenant_id = clientRecord.tenantId;
          }
          if (clientRecord?.iamOrganizationId) {
            structuredToken.payload.organization_id = clientRecord.iamOrganizationId;
          }
        }

        if (token.accountId) {
          const account = await findAccount(ctx, token.accountId, token);
          if (account) {
            const claims = await account.claims('access_token', token.scope, clientRecord);
            if (claims.tenant_id) structuredToken.payload.tenant_id = claims.tenant_id;
            if (claims.tenant_code) structuredToken.payload.tenant_code = claims.tenant_code;
            if (claims.organization_id) structuredToken.payload.organization_id = claims.organization_id;
            if (claims.roles) structuredToken.payload.roles = claims.roles;
            const tokenScopes = typeof structuredToken.payload.scope === 'string'
              ? structuredToken.payload.scope.split(/\s+/).filter(Boolean)
              : [];
            if (tokenScopes.includes('iam:admin') && claims.iam_admin === true) {
              structuredToken.payload.iam_admin = true;
            } else if (tokenScopes.includes('iam:admin')) {
              structuredToken.payload.scope = tokenScopes.filter((scope) => scope !== 'iam:admin').join(' ');
            }
            if (claims.role_ids) structuredToken.payload.role_ids = claims.role_ids;
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
      // No hard-coded audience: deployments may set a legacy default or require clients
      // to request an explicit resource indicator.
      defaultResource: (_ctx, _client) => process.env.OIDC_DEFAULT_RESOURCE || undefined,
      getResourceServerInfo: (_ctx, resourceIndicator, client) => {
        const registeredAudience = client?.[Symbol.for('target_audience')];
        if (registeredAudience && registeredAudience !== resourceIndicator) {
          throw new OIDC_ERRORS.InvalidTarget('client is not authorized for the requested resource');
        }
        return {
          scope: resourceScopes.join(' '),
          audience: resourceIndicator,
          accessTokenFormat: 'jwt',
          accessTokenTTL: Number(process.env.OIDC_ACCESS_TOKEN_TTL_SECONDS || 600),
          jwt: { sign: { alg: 'RS256' } },
        };
      },
      useGrantedResource: () => true,
    },

    // Disable the built-in dev UI — we bring our own
    devInteractions: { enabled: false },
  },

  // ── Scopes ────────────────────────────────────────────────────────────────
  scopes: supportedScopes,

  // ── Claims mapping ────────────────────────────────────────────────────────
  claims: {
    openid: ['sub'],
    profile: ['name', 'given_name', 'family_name', 'tenant_id', 'tenant_code', 'organization_id', 'organization_name'],
    email: ['email', 'email_verified'],
    roles: ['roles'],
    api_key: ['api_key_id'],
  },

  // ── Token TTLs ────────────────────────────────────────────────────────────
  ttl: {
    AccessToken: Number(process.env.OIDC_ACCESS_TOKEN_TTL_SECONDS || 600),
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

// Wire up the dynamic client resolver (must return a provider.Client instance)
provider.Client.find = async function (clientId) {
  const meta = await findClient(clientId);
  if (!meta) return undefined;
  if (meta instanceof provider.Client) return meta;
  const client = new provider.Client(meta);
  client[Symbol.for('tenant_id')] = meta[Symbol.for('tenant_id')];
  client[Symbol.for('target_audience')] = meta[Symbol.for('target_audience')];
  return client;
};

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
