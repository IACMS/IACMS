/**
 * IACMS API Gateway
 * Single entry point for all microservices
 * Handles authentication, RBAC, and request routing
 */

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from './middleware/auth.middleware.js';
import { createRbacMiddleware } from './middleware/rbac.middleware.js';

// Load .env from service directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Service URLs (from environment or defaults)
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

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id'],
}));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Health check (public)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
  });
});

// Authentication middleware (applies to all /api/v1 routes)
app.use('/api/v1', authenticate);

// RBAC middleware (applies after authentication)
const rbacMiddleware = createRbacMiddleware(services.rbac);
app.use('/api/v1', rbacMiddleware);


// ================================
// Route definitions
// ================================

// Auth Service Routes
// /api/v1/auth/* -> Auth Service /auth/*
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

// Tenant validation (via Auth Service)
// /api/v1/tenants/* -> Auth Service /tenants/*
app.use('/api/v1/tenants', createProxyMiddleware({
  target: services.auth,
  changeOrigin: true,
  pathRewrite: (path) => '/tenants' + path,
  onError: (err, req, res) => {
    console.error('Proxy error (tenants):', err.message);
    res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Auth service unavailable' } });
  },
}));

// RBAC Service Routes
// /api/v1/rbac/* -> RBAC Service /*
app.use('/api/v1/rbac', createProxyMiddleware({
  target: services.rbac,
  changeOrigin: true,
  pathRewrite: (path) => path, // Pass through as-is
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

// Case Service Routes
// /api/v1/cases/* -> Case Service /cases/*
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

// Workflow Service Routes
// /api/v1/workflows/* -> Workflow Service /workflows/*
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

// Referral Service Routes
// /api/v1/referrals/* -> Referral Service /referrals/*
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

// Audit Service Routes
// /api/v1/audit/* -> Audit Service /audit/*
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

// Integration Service Routes
// /api/v1/integrations/* -> Integration Service /integrations/*
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

// Notification Service Routes
// /api/v1/notifications/* -> Notification Service /notifications/*
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

// ================================
// Error handling
// ================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Gateway error:', err);
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Internal server error',
    },
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 API Gateway running on port ${PORT}`);
  console.log('━'.repeat(50));
  console.log('Service routing:');
  console.log('  /api/v1/auth/*         → Auth Service');
  console.log('  /api/v1/tenants/*      → Auth Service');
  console.log('  /api/v1/rbac/*         → RBAC Service');
  console.log('  /api/v1/cases/*        → Case Service');
  console.log('  /api/v1/workflows/*    → Workflow Service');
  console.log('  /api/v1/referrals/*    → Referral Service');
  console.log('  /api/v1/audit/*        → Audit Service');
  console.log('  /api/v1/integrations/* → Integration Service');
  console.log('  /api/v1/notifications/*→ Notification Service');
  console.log('━'.repeat(50));
  console.log('Public routes (no auth required):');
  console.log('  POST /api/v1/auth/login');
  console.log('  POST /api/v1/auth/register');
  console.log('  POST /api/v1/auth/refresh');
  console.log('  GET  /api/v1/tenants/validate/:code');
  console.log('  GET  /health');
  console.log('━'.repeat(50) + '\n');
});

export default app;
