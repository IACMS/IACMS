/**
 * IACMS API Gateway
 * Single entry point for all microservices
 * Handles authentication (session + JWT + API key), RBAC, and request routing
 */

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from './middleware/auth.middleware.js';
import { enforcePasswordChanged } from './middleware/passwordChangeGate.middleware.js';
import { createRbacMiddleware } from './middleware/rbac.middleware.js';
import { apiRateLimiter, authRateLimiter, partnerApiRateLimiter } from './middleware/rateLimit.middleware.js';
import { createSessionMiddleware, closeSessionStore } from './config/session.config.js';
import { closeRedisClient } from './config/redis.config.js';
import sessionRoutes from './routes/session.routes.js';
import apiKeyRoutes from './routes/apiKey.routes.js';
import { queryRouter } from './engine/queryRouter.js';
import { startOutboxPublisher, stopOutboxPublisher } from './workers/outboxPublisher.js';
import { setupSwagger } from '../../../shared/swagger.js';

// Load .env from service directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Service URLs
/** Forward identity + RBAC role ids + permissions to downstream microservices */
function attachDownstreamHeaders(proxyReq, req) {
  if (!req.user) return;
  proxyReq.setHeader('x-user-id', req.user.id);
  proxyReq.setHeader('x-tenant-id', req.user.tenantId);
  if (req.user.departmentId) proxyReq.setHeader('x-department-id', req.user.departmentId);
  if (req.user.email) proxyReq.setHeader('x-user-email', req.user.email);
  const roleIds = req.rbacEnvelope?.roleIds;
  if (Array.isArray(roleIds) && roleIds.length) {
    proxyReq.setHeader('x-user-roles', roleIds.join(','));
  } else if (req.user.roles?.length) {
    proxyReq.setHeader('x-user-roles', req.user.roles.join(','));
  }
  const permissions = req.rbacEnvelope?.permissions;
  if (Array.isArray(permissions) && permissions.length) {
    proxyReq.setHeader('x-user-permissions', permissions.join(','));
  }
}

const services = {
  iam: process.env.IAM_SERVICE_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  auth: process.env.AUTH_SERVICE_URL || process.env.IAM_SERVICE_URL || 'http://localhost:3001',
  rbac: process.env.RBAC_SERVICE_URL || process.env.IAM_SERVICE_URL || 'http://localhost:3001',
  caseEngine: process.env.CASE_ENGINE_SERVICE_URL || process.env.CASE_SERVICE_URL || 'http://localhost:3003',
  case: process.env.CASE_SERVICE_URL || process.env.CASE_ENGINE_SERVICE_URL || 'http://localhost:3003',
  workflow: process.env.WORKFLOW_SERVICE_URL || process.env.CASE_ENGINE_SERVICE_URL || 'http://localhost:3003',
  referral: process.env.REFERRAL_SERVICE_URL || process.env.CASE_ENGINE_SERVICE_URL || 'http://localhost:3003',
  audit: process.env.AUDIT_SERVICE_URL || 'http://localhost:3006',
  integration: process.env.INTEGRATION_SERVICE_URL || 'http://localhost:3007',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008',
  file: process.env.FILE_SERVICE_URL || 'http://localhost:3009',
};

/** Fail hung/slow downstreams before the browser's client timeout (~30s). */
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 25_000);

function proxyOnError(label) {
  return (err, req, res) => {
    console.error(`Proxy error (${label}):`, err.message);
    if (res.headersSent) return;
    const timedOut = err.code === 'ECONNRESET' || /timeout/i.test(err.message || '');
    res.status(timedOut ? 504 : 503).json({
      error: {
        code: timedOut ? 'GATEWAY_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        message: timedOut
          ? `${label} did not respond in time. Check that the service is running and not blocked.`
          : `${label} unavailable`,
      },
    });
  };
}

function serviceProxy({ target, pathRewrite, label, onProxyReq, onProxyRes }) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    pathRewrite,
    timeout: PROXY_TIMEOUT_MS,
    proxyTimeout: PROXY_TIMEOUT_MS,
    ...(onProxyReq ? { onProxyReq } : {}),
    ...(onProxyRes ? { onProxyRes } : {}),
    onError: proxyOnError(label),
  });
}

/** Forward identity to microservices (headers are not reliably inherited from req.headers by the proxy). */
function forwardProxyIdentity(proxyReq, req) {
  attachDownstreamHeaders(proxyReq, req);
}

/**
 * Initialize and start the server
 */
async function startServer() {
  // CORS with credentials for session cookies (comma-separated origins in dev, e.g. Vite 5173 and 5174)
  const corsOriginEnv = process.env.CORS_ORIGIN || 'http://localhost:5173';
  const corsOrigins = corsOriginEnv.split(',').map((o) => o.trim()).filter(Boolean);
  const corsOriginOption =
    corsOrigins.length === 0
      ? 'http://localhost:5173'
      : corsOrigins.length === 1
        ? corsOrigins[0]
        : corsOrigins;

  app.use(cors({
    origin: corsOriginOption,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'X-API-Key'],
    credentials: true,
  }));

  // Cookie parser
  app.use(cookieParser());

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const sessionInfo = req.session?.user ? `[Session: ${req.session.user.email}]` : '[No Session]';
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms ${sessionInfo}`);
    });
    next();
  });

  // Setup Swagger OpenAPI Documentation
  setupSwagger(app, 'API Gateway', PORT);

  // Health check (before session middleware)
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      features: { sessionAuth: true, jwtAuth: true, apiKeyAuth: true, partnerQueryApi: true },
    });
  });

  // Session middleware (Redis store; requires REDIS_URL)
  const sessionMiddleware = await createSessionMiddleware();
  app.use(sessionMiddleware);

  // Session routes (handled at gateway level)
  app.use('/api/v1/session', express.json());
  app.use('/api/v1/session', sessionRoutes);

  // Rate limiting — stricter for auth endpoints, standard for everything else
  app.use('/api/v1/auth/login', authRateLimiter);
  app.use('/api/v1/session/login', authRateLimiter);
  app.use('/api/v1', apiRateLimiter);

  // Authentication middleware
  app.use('/api/v1', authenticate);

  // Until first-login password change completes, block APIs (browser session exposes status / logout separately).
  app.use('/api/v1', enforcePasswordChanged);

  // RBAC middleware (skip for API key routes — they use scope-based auth)
  const rbacMiddleware = createRbacMiddleware(services.rbac);
  app.use('/api/v1', (req, res, next) => {
    // Skip RBAC for API key authenticated requests (they use scope-based auth)
    if (req.apiKeyContext) return next();
    return rbacMiddleware(req, res, next);
  });

  // ─── Partner API: Unified Query Endpoint ───────────────────────────────
  // API key authenticated requests go through the query engine directly
  app.use('/api/v1/query', express.json({ limit: '1mb' }), partnerApiRateLimiter, queryRouter);

  // ─── API Key Management (admin-only, session/JWT auth) ─────────────────
  app.use('/api/v1/api-keys', express.json(), apiKeyRoutes);

  /** Platform operators: reachability of downstream services (HTTP /health), not user RBAC. */
  async function probeDownstreamHealth(url) {
    const target = url.replace(/\/$/, '');
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const res = await fetch(`${target}/health`, { signal: ac.signal });
      clearTimeout(timer);
      return { ok: res.ok, status: res.status, error: null };
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'Request timed out' : String(e?.message || e);
      return { ok: false, status: 0, error: msg };
    }
  }

  app.get('/api/v1/platform/service-probes', async (req, res) => {
    const definitions = [
      { key: 'iam', label: 'IAM service (Auth + RBAC)', baseUrl: services.iam },
      { key: 'case-engine', label: 'Case Engine service (Cases + Workflows + Referrals)', baseUrl: services.caseEngine },
      { key: 'audit', label: 'Audit service', baseUrl: services.audit },
      { key: 'integration', label: 'Integration service', baseUrl: services.integration },
      { key: 'notification', label: 'Notification service', baseUrl: services.notification },
      { key: 'file', label: 'File service', baseUrl: services.file },
    ];
    const probes = await Promise.all(
      definitions.map(async (d) => {
        const r = await probeDownstreamHealth(d.baseUrl);
        const healthUrl = `${d.baseUrl.replace(/\/$/, '')}/health`;
        return {
          key: d.key,
          label: d.label,
          target: healthUrl,
          ok: r.ok,
          status: r.status,
          error: r.error,
        };
      }),
    );
    res.json({
      at: new Date().toISOString(),
      gateway: { ok: true, service: 'api-gateway' },
      probes,
    });
  });

  // Proxy routes
  app.use('/api/v1/auth', serviceProxy({
    target: services.auth,
    pathRewrite: (path) => '/auth' + path,
    label: 'Auth service',
    onProxyReq: (proxyReq, req) => forwardProxyIdentity(proxyReq, req),
    onProxyRes: (proxyRes, req) => {
      if (req.method !== 'POST' || proxyRes.statusCode !== 200) return;
      const norm = [
        typeof req.originalUrl === 'string' ? req.originalUrl.split('?')[0] : '',
        typeof req.path === 'string' ? req.path : '',
        typeof req.url === 'string' ? req.url.split('?')[0] : '',
      ];
      if (!norm.some((p) => p.endsWith('/change-password'))) return;
      if (req.session?.user) {
        req.session.user.mustChangePassword = false;
        req.session.save((err) => {
          if (err)
            console.warn('[Gateway] session save after password change failed:', err.message);
        });
      }
    },
  }));

  app.use('/api/v1/chat', serviceProxy({
    target: services.auth,
    pathRewrite: (path) => '/chat' + path,
    label: 'Auth service',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  app.use('/api/v1/tenants', serviceProxy({
    target: services.auth,
    pathRewrite: (path) => '/tenants' + path,
    label: 'Auth service',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  app.use('/api/v1/rbac', serviceProxy({
    target: services.rbac,
    pathRewrite: (path) => path,
    label: 'RBAC service',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  app.use('/api/v1/dashboard', serviceProxy({
    target: services.case,
    pathRewrite: (path) => '/dashboard' + path,
    label: 'Case service',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  app.use('/api/v1/cases', serviceProxy({
    target: services.case,
    pathRewrite: (path) => '/cases' + path,
    label: 'Case service',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  app.use('/api/v1/assignments', serviceProxy({
    target: services.case,
    pathRewrite: (path) => '/assignments' + path,
    label: 'Case service',
    onProxyReq: (proxyReq, req) => forwardProxyIdentity(proxyReq, req),
  }));

  app.use('/api/v1/attachments', serviceProxy({
    target: services.case,
    pathRewrite: (path) => '/attachments' + path,
    label: 'Case service',
    onProxyReq: (proxyReq, req) => forwardProxyIdentity(proxyReq, req),
  }));

  app.use('/api/v1/workflows', serviceProxy({
    target: services.workflow,
    pathRewrite: (path) => '/workflows' + path,
    label: 'Workflow service',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  app.use('/api/v1/referrals', serviceProxy({
    target: services.referral,
    pathRewrite: (path) => '/referrals' + path,
    label: 'Referral service',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  app.use('/api/v1/audit', serviceProxy({
    target: services.audit,
    pathRewrite: (path) => '/audit' + path,
    label: 'Audit service',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  app.use('/api/v1/integrations', serviceProxy({
    target: services.integration,
    pathRewrite: (path) => '/integrations' + path,
    label: 'Integration service',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  app.use('/api/v1/notifications', serviceProxy({
    target: services.notification,
    pathRewrite: (path) => '/notifications' + path,
    label: 'Notification service',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  app.use('/api/v1/files', serviceProxy({
    target: services.file,
    pathRewrite: (path) => '/files' + path,
    label: 'File service',
    onProxyReq: (proxyReq, req) => forwardProxyIdentity(proxyReq, req),
  }));

  app.use('/api/v1/uploads', serviceProxy({
    target: services.file,
    pathRewrite: (path) => '/uploads' + path,
    label: 'File service',
    onProxyReq: (proxyReq, req) => forwardProxyIdentity(proxyReq, req),
  }));

  // Platform admin routes (system_admin only — enforced in auth-service controller)
  app.use('/api/v1/platform', serviceProxy({
    target: services.auth,
    pathRewrite: (path) => '/platform' + path,
    label: 'Auth service (platform admin)',
    onProxyReq: (proxyReq, req) => attachDownstreamHeaders(proxyReq, req),
  }));

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Gateway error:', err);
    res.status(err.status || 500).json({
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Internal server error' },
    });
  });

  // Start the audit outbox publisher
  startOutboxPublisher();

  // Start server
  app.listen(PORT, () => {
    console.log(`\nAPI Gateway running on port ${PORT}`);
    console.log('='.repeat(50));
    console.log('Authentication : Session (Redis) + JWT + API Key');
    console.log('Caching        : Redis (RBAC permissions)');
    console.log('Rate Limiting  : Redis (per-user / per-IP / per-API-key)');
    console.log('Events         : Kafka');
    console.log('='.repeat(50));
    console.log('Session Routes:');
    console.log('  POST /api/v1/session/login');
    console.log('  POST /api/v1/session/logout');
    console.log('  GET  /api/v1/session/status');
    console.log('Partner API Routes:');
    console.log('  POST /api/v1/query             (X-API-Key auth)');
    console.log('API Key Management Routes:');
    console.log('  POST   /api/v1/api-keys        (create key)');
    console.log('  GET    /api/v1/api-keys        (list keys)');
    console.log('  DELETE /api/v1/api-keys/:id     (revoke key)');
    console.log('  POST   /api/v1/api-keys/:id/rotate');
    console.log('='.repeat(50));
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[Gateway] SIGTERM received — shutting down gracefully');
    stopOutboxPublisher();
    await closeSessionStore();
    await closeRedisClient();
    process.exit(0);
  });
}

startServer().catch((err) => {
  console.error('Failed to start API Gateway:', err);
  process.exit(1);
});

export default app;
