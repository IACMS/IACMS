/**
 * IACMS API Gateway
 * Single entry point for all microservices
 * Handles authentication (session + JWT), RBAC, and request routing
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
import { apiRateLimiter, authRateLimiter } from './middleware/rateLimit.middleware.js';
import { createSessionMiddleware, closeSessionStore } from './config/session.config.js';
import { closeRedisClient } from './config/redis.config.js';
import sessionRoutes from './routes/session.routes.js';

// Load .env from service directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Service URLs
/** Forward identity + RBAC role ids to downstream microservices */
function attachDownstreamHeaders(proxyReq, req) {
  if (!req.user) return;
  proxyReq.setHeader('x-user-id', req.user.id);
  proxyReq.setHeader('x-tenant-id', req.user.tenantId);
  const roleIds = req.rbacEnvelope?.roleIds;
  if (Array.isArray(roleIds) && roleIds.length) {
    proxyReq.setHeader('x-user-roles', roleIds.join(','));
  }
}

const services = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  rbac: process.env.RBAC_SERVICE_URL || 'http://localhost:3002',
  case: process.env.CASE_SERVICE_URL || 'http://localhost:3003',
  workflow: process.env.WORKFLOW_SERVICE_URL || 'http://localhost:3004',
  referral: process.env.REFERRAL_SERVICE_URL || 'http://localhost:3005',
  audit: process.env.AUDIT_SERVICE_URL || 'http://localhost:3006',
  integration: process.env.INTEGRATION_SERVICE_URL || 'http://localhost:3007',
  notification: process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3008',
};

/** Forward identity to microservices (headers are not reliably inherited from req.headers by the proxy). */
function forwardProxyIdentity(proxyReq, req) {
  if (!req.user) return;
  proxyReq.setHeader('x-user-id', req.user.id);
  proxyReq.setHeader('x-tenant-id', req.user.tenantId);
  if (req.user.email) proxyReq.setHeader('x-user-email', req.user.email);
  if (req.user.roles?.length) {
    proxyReq.setHeader('x-user-roles', req.user.roles.join(','));
  }
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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
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

  // Health check (before session middleware)
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      features: { sessionAuth: true, jwtAuth: true },
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

  // RBAC middleware
  const rbacMiddleware = createRbacMiddleware(services.rbac);
  app.use('/api/v1', rbacMiddleware);

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
      { key: 'auth', label: 'Auth service', baseUrl: services.auth },
      { key: 'rbac', label: 'RBAC service', baseUrl: services.rbac },
      { key: 'case', label: 'Case service', baseUrl: services.case },
      { key: 'workflow', label: 'Workflow service', baseUrl: services.workflow },
      { key: 'referral', label: 'Referral service', baseUrl: services.referral },
      { key: 'audit', label: 'Audit service', baseUrl: services.audit },
      { key: 'integration', label: 'Integration service', baseUrl: services.integration },
      { key: 'notification', label: 'Notification service', baseUrl: services.notification },
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
  app.use('/api/v1/auth', createProxyMiddleware({
    target: services.auth,
    changeOrigin: true,
    pathRewrite: (path) => '/auth' + path,
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
    onError: (err, req, res) => {
      console.error('Proxy error (auth):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Auth service unavailable' } });
    },
  }));

  app.use('/api/v1/chat', createProxyMiddleware({
    target: services.auth,
    changeOrigin: true,
    pathRewrite: (path) => '/chat' + path,
    onProxyReq: (proxyReq, req) => {
      attachDownstreamHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error('Proxy error (chat):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Auth service unavailable' } });
    },
  }));

  app.use('/api/v1/tenants', createProxyMiddleware({
    target: services.auth,
    changeOrigin: true,
    pathRewrite: (path) => '/tenants' + path,
    onProxyReq: (proxyReq, req) => {
      attachDownstreamHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error('Proxy error (tenants):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Auth service unavailable' } });
    },
  }));

  app.use('/api/v1/rbac', createProxyMiddleware({
    target: services.rbac,
    changeOrigin: true,
    pathRewrite: (path) => path,
    onProxyReq: (proxyReq, req) => {
      attachDownstreamHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error('Proxy error (rbac):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'RBAC service unavailable' } });
    },
  }));

  app.use('/api/v1/dashboard', createProxyMiddleware({
    target: services.case,
    changeOrigin: true,
    pathRewrite: (path) => '/dashboard' + path,
    onProxyReq: (proxyReq, req) => {
      attachDownstreamHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error('Proxy error (dashboard):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Case service unavailable' } });
    },
  }));

  app.use('/api/v1/cases', createProxyMiddleware({
    target: services.case,
    changeOrigin: true,
    pathRewrite: (path) => '/cases' + path,
    onProxyReq: (proxyReq, req) => {
      attachDownstreamHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error('Proxy error (cases):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Case service unavailable' } });
    },
  }));

  app.use('/api/v1/assignments', createProxyMiddleware({
    target: services.case,
    changeOrigin: true,
    pathRewrite: (path) => '/assignments' + path,
    onProxyReq: (proxyReq, req) => forwardProxyIdentity(proxyReq, req),
    onError: (err, req, res) => {
      console.error('Proxy error (assignments):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Case service unavailable' } });
    },
  }));

  app.use('/api/v1/attachments', createProxyMiddleware({
    target: services.case,
    changeOrigin: true,
    pathRewrite: (path) => '/attachments' + path,
    onProxyReq: (proxyReq, req) => forwardProxyIdentity(proxyReq, req),
    onError: (err, req, res) => {
      console.error('Proxy error (attachments):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Case service unavailable' } });
    },
  }));

  app.use('/api/v1/workflows', createProxyMiddleware({
    target: services.workflow,
    changeOrigin: true,
    pathRewrite: (path) => '/workflows' + path,
    onProxyReq: (proxyReq, req) => {
      attachDownstreamHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error('Proxy error (workflows):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Workflow service unavailable' } });
    },
  }));

  app.use('/api/v1/referrals', createProxyMiddleware({
    target: services.referral,
    changeOrigin: true,
    pathRewrite: (path) => '/referrals' + path,
    onProxyReq: (proxyReq, req) => {
      attachDownstreamHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error('Proxy error (referrals):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Referral service unavailable' } });
    },
  }));

  app.use('/api/v1/audit', createProxyMiddleware({
    target: services.audit,
    changeOrigin: true,
    pathRewrite: (path) => '/audit' + path,
    onProxyReq: (proxyReq, req) => {
      attachDownstreamHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error('Proxy error (audit):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Audit service unavailable' } });
    },
  }));

  app.use('/api/v1/integrations', createProxyMiddleware({
    target: services.integration,
    changeOrigin: true,
    pathRewrite: (path) => '/integrations' + path,
    onProxyReq: (proxyReq, req) => {
      attachDownstreamHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error('Proxy error (integrations):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Integration service unavailable' } });
    },
  }));

  app.use('/api/v1/notifications', createProxyMiddleware({
    target: services.notification,
    changeOrigin: true,
    pathRewrite: (path) => '/notifications' + path,
    onProxyReq: (proxyReq, req) => {
      attachDownstreamHeaders(proxyReq, req);
    },
    onError: (err, req, res) => {
      console.error('Proxy error (notifications):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Notification service unavailable' } });
    },
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

  // Start server
  app.listen(PORT, () => {
    console.log(`\nAPI Gateway running on port ${PORT}`);
    console.log('='.repeat(50));
    console.log('Authentication : Session (Redis) + JWT');
    console.log('Caching        : Redis (RBAC permissions)');
    console.log('Rate Limiting  : Redis (per-user / per-IP)');
    console.log('Events         : Kafka');
    console.log('='.repeat(50));
    console.log('Session Routes:');
    console.log('  POST /api/v1/session/login');
    console.log('  POST /api/v1/session/logout');
    console.log('  GET  /api/v1/session/status');
    console.log('='.repeat(50));
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[Gateway] SIGTERM received — shutting down gracefully');
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
