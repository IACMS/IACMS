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
import { createRbacMiddleware } from './middleware/rbac.middleware.js';
import { createSessionMiddleware } from './config/session.config.js';
import sessionRoutes from './routes/session.routes.js';

// Load .env from service directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Service URLs
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

/**
 * Initialize and start the server
 */
async function startServer() {
  // CORS with credentials for session cookies
  app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
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

  // Session middleware (PostgreSQL store)
  const sessionMiddleware = await createSessionMiddleware();
  app.use(sessionMiddleware);

  // Session routes (handled at gateway level)
  app.use('/api/v1/session', express.json());
  app.use('/api/v1/session', sessionRoutes);

  // Authentication middleware
  app.use('/api/v1', authenticate);

  // RBAC middleware
  const rbacMiddleware = createRbacMiddleware(services.rbac);
  app.use('/api/v1', rbacMiddleware);

  // Proxy routes
  app.use('/api/v1/auth', createProxyMiddleware({
    target: services.auth,
    changeOrigin: true,
    pathRewrite: (path) => '/auth' + path,
    onProxyReq: (proxyReq, req) => {
      if (req.user) {
        proxyReq.setHeader('x-user-id', req.user.id);
        proxyReq.setHeader('x-tenant-id', req.user.tenantId);
      }
    },
    onError: (err, req, res) => {
      console.error('Proxy error (auth):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Auth service unavailable' } });
    },
  }));

  app.use('/api/v1/tenants', createProxyMiddleware({
    target: services.auth,
    changeOrigin: true,
    pathRewrite: (path) => '/tenants' + path,
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
      if (req.user) {
        proxyReq.setHeader('x-user-id', req.user.id);
        proxyReq.setHeader('x-tenant-id', req.user.tenantId);
      }
    },
    onError: (err, req, res) => {
      console.error('Proxy error (rbac):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'RBAC service unavailable' } });
    },
  }));

  app.use('/api/v1/cases', createProxyMiddleware({
    target: services.case,
    changeOrigin: true,
    pathRewrite: (path) => '/cases' + path,
    onProxyReq: (proxyReq, req) => {
      if (req.user) {
        proxyReq.setHeader('x-user-id', req.user.id);
        proxyReq.setHeader('x-tenant-id', req.user.tenantId);
      }
    },
    onError: (err, req, res) => {
      console.error('Proxy error (cases):', err.message);
      res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Case service unavailable' } });
    },
  }));

  app.use('/api/v1/workflows', createProxyMiddleware({
    target: services.workflow,
    changeOrigin: true,
    pathRewrite: (path) => '/workflows' + path,
    onProxyReq: (proxyReq, req) => {
      if (req.user) {
        proxyReq.setHeader('x-user-id', req.user.id);
        proxyReq.setHeader('x-tenant-id', req.user.tenantId);
      }
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
      if (req.user) {
        proxyReq.setHeader('x-user-id', req.user.id);
        proxyReq.setHeader('x-tenant-id', req.user.tenantId);
      }
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
      if (req.user) {
        proxyReq.setHeader('x-user-id', req.user.id);
        proxyReq.setHeader('x-tenant-id', req.user.tenantId);
      }
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
      if (req.user) {
        proxyReq.setHeader('x-user-id', req.user.id);
        proxyReq.setHeader('x-tenant-id', req.user.tenantId);
      }
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
      if (req.user) {
        proxyReq.setHeader('x-user-id', req.user.id);
        proxyReq.setHeader('x-tenant-id', req.user.tenantId);
      }
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
    console.log('Authentication: Session (PostgreSQL) + JWT');
    console.log('='.repeat(50));
    console.log('Session Routes:');
    console.log('  POST /api/v1/session/login');
    console.log('  POST /api/v1/session/logout');
    console.log('  GET  /api/v1/session/status');
    console.log('='.repeat(50));
  });
}

startServer().catch((err) => {
  console.error('Failed to start API Gateway:', err);
  process.exit(1);
});

export default app;
