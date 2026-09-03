import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../src/config/database.js', () => {
  const prismaMock = {
    apiKey: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    tenant: { findUnique: vi.fn() },
    $transaction: vi.fn().mockImplementation(async (cb) => cb(prismaMock)),
  };
  return { default: prismaMock };
});

vi.mock('../../src/services/apiKey.service.js', () => ({
  generateApiKey: vi.fn(),
  listApiKeys: vi.fn(),
  revokeApiKey: vi.fn(),
  rotateApiKey: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock('../../src/config/redis.config.js', () => ({
  getRedisClient: vi.fn(() => null),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import apiKeyRouter from '../../src/routes/apiKey.routes.js';
import * as apiKeyService from '../../src/services/apiKey.service.js';
import { queryRouter } from '../../src/engine/queryRouter.js';

// ── Test App Setup ─────────────────────────────────────────────────────────────
//
// We build a minimal Express app that replicates the gateway's middleware chain
// for the two routes under test:
//   • /api/v1/api-keys  — key management (session-authenticated)
//   • /api/v1/query     — unified query endpoint (API-key-authenticated)
//

function buildApp({ sessionUser = null } = {}) {
  const app = express();
  app.use(express.json());

  // Simulate gateway auth middleware:
  //   - If a session user is injected, expose req.user (human session).
  //   - If X-API-Key header is present, set req.apiKeyContext via the mock.
  app.use(async (req, _res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey && typeof apiKey === 'string' && apiKey.startsWith('iacms_live_')) {
      try {
        const keyData = await apiKeyService.validateApiKey(apiKey, req.ip);
        req.user = { id: `apikey:${keyData.keyId}`, tenantId: keyData.tenantId, isApiKey: true };
        req.apiKeyContext = {
          keyId: keyData.keyId,
          keyName: keyData.keyName,
          scopes: keyData.scopes,
          tenantId: keyData.tenantId,
          tenantCode: keyData.tenantCode,
        };
      } catch (err) {
        return _res.status(401).json({ error: { code: 'UNAUTHORIZED', message: err.message || 'Invalid API key' } });
      }
    } else if (sessionUser) {
      req.user = sessionUser;
    }
    next();
  });

  // Mount both routers as the real gateway does
  app.use('/api/v1/api-keys', apiKeyRouter);
  app.use('/api/v1/query', express.json(), queryRouter);

  // Error handler
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Internal server error' },
    });
  });

  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ADMIN_USER = {
  id: 'user-admin-1',
  tenantId: 'tenant-001',
  email: 'admin@agency.gov',
  roles: ['admin'],
};

const CREATED_KEY_RESPONSE = {
  rawKey: 'iacms_live_abc123def456ghi789',
  keyId: 'key-uuid-001',
  keyPrefix: 'iacms_live_abc123',
  name: 'Partner Integration Key',
  scopes: ['cases:read', 'referrals:read'],
};

const KEY_RECORD = {
  id: 'key-uuid-001',
  name: 'Partner Integration Key',
  keyPrefix: 'iacms_live_abc123',
  scopes: ['cases:read', 'referrals:read'],
  isActive: true,
  expiresAt: null,
  lastUsedAt: null,
  createdAt: new Date().toISOString(),
  revokedAt: null,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 3: General Availability — Self-Service API Key Portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Create API Key ──────────────────────────────────────────────────────

  describe('POST /api/v1/api-keys (create)', () => {
    it('creates a new key for a human admin session', async () => {
      apiKeyService.generateApiKey.mockResolvedValue(CREATED_KEY_RESPONSE);
      const app = buildApp({ sessionUser: ADMIN_USER });

      const res = await request(app)
        .post('/api/v1/api-keys')
        .send({
          name: 'Partner Integration Key',
          scopes: ['cases:read', 'referrals:read'],
          expiresAt: '2027-12-31T23:59:59Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.apiKey.rawKey).toBe(CREATED_KEY_RESPONSE.rawKey);
      expect(res.body.apiKey.id).toBe('key-uuid-001');
      expect(apiKeyService.generateApiKey).toHaveBeenCalledWith(
        'tenant-001',
        'Partner Integration Key',
        ['cases:read', 'referrals:read'],
        '2027-12-31T23:59:59Z',
        'user-admin-1',
      );
    });

    it('rejects creation if no name is provided', async () => {
      const app = buildApp({ sessionUser: ADMIN_USER });
      const res = await request(app)
        .post('/api/v1/api-keys')
        .send({ scopes: ['cases:read'] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/name is required/i);
    });

    it('rejects creation with an invalid scope', async () => {
      const app = buildApp({ sessionUser: ADMIN_USER });
      const res = await request(app)
        .post('/api/v1/api-keys')
        .send({ name: 'Bad Key', scopes: ['super:root', 'cases:read'] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/invalid scopes/i);
    });

    it('rejects creation with an expired expiresAt date', async () => {
      const app = buildApp({ sessionUser: ADMIN_USER });
      const res = await request(app)
        .post('/api/v1/api-keys')
        .send({ name: 'Expired Key', scopes: ['cases:read'], expiresAt: '2020-01-01T00:00:00Z' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toMatch(/valid future/i);
    });

    it('blocks creation when the request is authenticated via an API key (not a session)', async () => {
      apiKeyService.validateApiKey.mockResolvedValue({
        tenantId: 'tenant-001',
        scopes: ['*'],
        keyId: 'existing-key',
        keyName: 'Superuser Key',
        tenantCode: 'AGENCY',
      });

      // App without sessionUser — will fall through to X-API-Key path
      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/api-keys')
        .set('X-API-Key', 'iacms_live_superuser_key')
        .send({ name: 'Rogue Key', scopes: ['cases:read'] });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/session/i);
    });
  });

  // ── 2. List API Keys ───────────────────────────────────────────────────────

  describe('GET /api/v1/api-keys (list)', () => {
    it('returns keys for the admin tenant', async () => {
      apiKeyService.listApiKeys.mockResolvedValue([KEY_RECORD]);
      const app = buildApp({ sessionUser: ADMIN_USER });

      const res = await request(app).get('/api/v1/api-keys');

      expect(res.status).toBe(200);
      expect(res.body.apiKeys).toHaveLength(1);
      expect(res.body.apiKeys[0].id).toBe('key-uuid-001');
      // rawKey should never appear in list response
      expect(res.body.apiKeys[0]).not.toHaveProperty('keyHash');
      expect(res.body.apiKeys[0]).not.toHaveProperty('rawKey');
    });

    it('returns 403 when no session is present', async () => {
      const app = buildApp(); // no sessionUser
      const res = await request(app).get('/api/v1/api-keys');
      expect(res.status).toBe(403);
    });
  });

  // ── 3. Revoke API Key ──────────────────────────────────────────────────────

  describe('DELETE /api/v1/api-keys/:id (revoke)', () => {
    it('revokes a key successfully', async () => {
      apiKeyService.revokeApiKey.mockResolvedValue(undefined);
      const app = buildApp({ sessionUser: ADMIN_USER });

      const res = await request(app).delete('/api/v1/api-keys/key-uuid-001');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(apiKeyService.revokeApiKey).toHaveBeenCalledWith('key-uuid-001', 'tenant-001', 'user-admin-1');
    });

    it('returns 404 when the key is not found', async () => {
      apiKeyService.revokeApiKey.mockRejectedValue(new Error('API key not found'));
      const app = buildApp({ sessionUser: ADMIN_USER });

      const res = await request(app).delete('/api/v1/api-keys/nonexistent-key');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── 4. Rotate API Key ──────────────────────────────────────────────────────

  describe('POST /api/v1/api-keys/:id/rotate', () => {
    it('rotates a key and returns the new raw key', async () => {
      apiKeyService.rotateApiKey.mockResolvedValue({
        ...CREATED_KEY_RESPONSE,
        rawKey: 'iacms_live_newkey_xyz',
        keyPrefix: 'iacms_live_newkey',
      });
      const app = buildApp({ sessionUser: ADMIN_USER });

      const res = await request(app).post('/api/v1/api-keys/key-uuid-001/rotate');

      expect(res.status).toBe(200);
      expect(res.body.apiKey.rawKey).toBe('iacms_live_newkey_xyz');
      expect(apiKeyService.rotateApiKey).toHaveBeenCalledWith('key-uuid-001', 'tenant-001', 'user-admin-1');
    });

    it('returns 404 when rotating a non-existent key', async () => {
      apiKeyService.rotateApiKey.mockRejectedValue(new Error('API key not found'));
      const app = buildApp({ sessionUser: ADMIN_USER });

      const res = await request(app).post('/api/v1/api-keys/bad-id/rotate');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ── 5. Full GA Lifecycle (end-to-end) ─────────────────────────────────────

  describe('Full GA Lifecycle: create → use → revoke', () => {
    it('allows a freshly created key to query, then rejects it after revocation', async () => {
      // Step 1: Admin creates a key
      apiKeyService.generateApiKey.mockResolvedValue(CREATED_KEY_RESPONSE);
      const mgmtApp = buildApp({ sessionUser: ADMIN_USER });

      const createRes = await request(mgmtApp)
        .post('/api/v1/api-keys')
        .send({ name: 'GA Partner Key', scopes: ['cases:read'] });

      expect(createRes.status).toBe(201);
      const { rawKey } = createRes.body.apiKey;
      expect(rawKey).toBeTruthy();

      // Step 2: Partner uses the key for a query (validateApiKey succeeds)
      apiKeyService.validateApiKey.mockResolvedValue({
        tenantId: 'tenant-001',
        scopes: ['cases:read'],
        keyId: 'key-uuid-001',
        keyName: 'GA Partner Key',
        tenantCode: 'AGENCY',
      });

      // The query engine will try to call Prisma — mock it to return empty results
      const queryApp = buildApp();
      // We only care about the auth path here — the query will fail with a Prisma error
      // which is fine; the important thing is it got *past* auth.
      // (Full query engine tests are in phase1/2 suites.)
      const queryRes = await request(queryApp)
        .post('/api/v1/query')
        .set('X-API-Key', rawKey)
        .send({ operation: 'query', entity: 'cases', select: ['id'] });

      // Auth passed (not 401); query engine may return an error due to mocked DB
      expect(queryRes.status).not.toBe(401);

      // Step 3: Admin revokes the key
      apiKeyService.revokeApiKey.mockResolvedValue(undefined);
      const revokeRes = await request(mgmtApp).delete('/api/v1/api-keys/key-uuid-001');
      expect(revokeRes.status).toBe(200);

      // Step 4: Revoked key is now rejected
      apiKeyService.validateApiKey.mockRejectedValue(new Error('API key is revoked or inactive'));
      const retryApp = buildApp();
      const retryRes = await request(retryApp)
        .post('/api/v1/query')
        .set('X-API-Key', rawKey)
        .send({ operation: 'query', entity: 'cases', select: ['id'] });

      expect(retryRes.status).toBe(401);
    });
  });
});
