import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import helmet from 'helmet';
import { errorHandler } from '../../../shared/middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import tenantRoutes from './routes/tenant.routes.js';
import platformRoutes from './routes/platform.routes.js';
import roleRoutes from './routes/role.routes.js';
import permissionRoutes from './routes/permission.routes.js';
import userRoleRoutes from './routes/user-role.routes.js';
import oauthClientRoutes from './routes/oauth-clients.routes.js';
import oauthProviderRoutes from './routes/oauth-providers.routes.js';
import apiKeyRoutes from './routes/api-keys.routes.js';
import interactionRoutes from './oauth/interaction/interaction.routes.js';
import socialRoutes from './oauth/social/social.routes.js';
import Logger from '../../../shared/common/logger.js';
import { setupSwagger } from '../../../shared/swagger.js';
import { requireInternalRequest } from '../../../shared/middleware/requireInternalRequest.js';
import { assertProductionSecrets } from '../../../shared/utils/validateProductionSecrets.js';

// Load .env from service directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Prevent any async Kafka errors from killing the process
process.on('unhandledRejection', (reason) => {
  console.warn('[iam-service] Unhandled rejection (non-fatal):', reason?.message || reason);
});

const app = express();
const PORT = process.env.PORT || 3001;
const logger = new Logger('iam-service');

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,           // SPA clients handle their own CSP
  frameguard: { action: 'sameorigin' },   // Allow OIDC interaction page to be framed by same-origin portals
}));

// ── Public OIDC Discovery & JWKS CORS (RFC 7517) ────────────────────────────
app.use(['/oauth/jwks', '/.well-known/openid-configuration'], (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── OIDC Provider ─────────────────────────────────────────────────────────────
// CRITICAL: must be mounted BEFORE express.json().
// node-oidc-provider uses its own body parser for /oauth/token, /oauth/userinfo, etc.
// Parsing the body before the library sees it corrupts those requests.
let oidcProvider;
try {
  const { default: providerInstance } = await import('./oauth/oidc.config.js');
  const { findAccount } = await import('./oauth/find-account.js');
  const jose = await import('jose');
  oidcProvider = providerInstance;

  // Mount OIDC engine for protocol endpoints (raw body streams)
  const oidcCallback = oidcProvider.callback();

  // Cache local JWKS from OIDC_JWKS_JSON for fast offline verification of audience-restricted tokens
  let localJwks;
  if (process.env.OIDC_JWKS_JSON) {
    try {
      localJwks = jose.createLocalJWKSet(JSON.parse(process.env.OIDC_JWKS_JSON));
    } catch { /* handled in oidc.config */ }
  }

  // Custom UserInfo handler for RS256 JWT access tokens
  // node-oidc-provider's built-in userinfo rejects tokens with aud != undefined.
  // Standard OIDC clients presenting their RS256 Bearer JWT can retrieve their profile here.
  app.get('/oauth/userinfo', async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer eyJ') && localJwks) {
      try {
        const rawToken = authHeader.slice(7);
        const { payload } = await jose.jwtVerify(rawToken, localJwks, {
          issuer: process.env.OIDC_ISSUER || 'http://localhost:3001',
        });
        const account = await findAccount(null, payload.sub);
        if (!account) return res.status(401).json({ error: 'invalid_token' });
        const claims = await account.claims('userinfo', payload.scope || 'openid profile email roles');
        return res.json(claims);
      } catch (err) {
        return res.status(401).json({ error: 'invalid_token', error_description: err.message });
      }
    }
    return oidcCallback(req, res);
  });

  app.use((req, res, next) => {
    const isOidcProtocolPath = (
      req.path.startsWith('/.well-known') ||
      (req.path.startsWith('/oauth') &&
       !req.path.startsWith('/oauth/clients') &&
       !req.path.startsWith('/oauth/providers') &&
       !req.path.startsWith('/oauth/interaction'))
    );
    if (isOidcProtocolPath) {
      return oidcCallback(req, res);
    }
    next();
  });

  logger.info('OIDC provider mounted');
} catch (err) {
  // Graceful degradation — service still starts for /auth/* if OIDC env vars are absent
  logger.warn('OIDC provider not loaded — OAuth2/OIDC features disabled', { reason: err.message });
}

// ── Body parsers (after OIDC engine callback) ─────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── OIDC Interaction UI routes (requires parsed request body) ─────────────────
app.use('/oauth/interaction', interactionRoutes);

// ── Social & Federated OAuth routes (public redirects and browser callbacks) ──
app.use('/auth/social', socialRoutes);

// ── Public static assets ──────────────────────────────────────────────────────
const uploadsDir = path.join(process.cwd(), 'uploads');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch { /* ignore */ }
app.use('/tenants/assets', express.static(uploadsDir, { maxAge: '1h' }));

// ── Swagger ───────────────────────────────────────────────────────────────────
setupSwagger(app, 'IAM Service', PORT);

// ── Health check (public — no internal token required) ────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'iam-service', timestamp: new Date().toISOString(), oidc: !!oidcProvider });
});

assertProductionSecrets([
  { name: 'JWT_SECRET', value: process.env.JWT_SECRET },
  { name: 'INTERNAL_SERVICE_TOKEN', value: process.env.INTERNAL_SERVICE_TOKEN },
]);

// ── Internal-request guard ────────────────────────────────────────────────────
// All requests must originate from the API gateway (carries INTERNAL_SERVICE_TOKEN).
// The gateway exposes /oauth/.well-known and /oauth/jwks publicly; internally they
// still travel through the gateway and carry the token.
app.use(requireInternalRequest());

// ── Application routes ────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/tenants', tenantRoutes);
app.use('/platform', platformRoutes);
app.use('/roles', roleRoutes);
app.use('/permissions', permissionRoutes);
app.use('/user-roles', userRoleRoutes);
app.use('/oauth/clients', oauthClientRoutes);
app.use('/oauth/providers', oauthProviderRoutes);
app.use('/api-keys', apiKeyRoutes);

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`IAM Service running on port ${PORT}`);
});

export default app;
