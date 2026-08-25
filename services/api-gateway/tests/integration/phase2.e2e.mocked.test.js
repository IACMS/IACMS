import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock dependencies
vi.mock('../../src/config/database.js', () => {
  const prismaMock = {
    apiKey: {
      findUnique: vi.fn(),
    },
    workflow: {
      findFirst: vi.fn(),
    },
    workflowTransition: {
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
    },
    caseSequence: {
      upsert: vi.fn(),
    },
    case: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    caseHistory: {
      create: vi.fn(),
    },
    caseReferral: {
      create: vi.fn(),
    },
    auditOutbox: {
      create: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (callback) => {
      return await callback(prismaMock);
    }),
  };
  return { default: prismaMock };
});

vi.mock('../../src/services/apiKey.service.js', () => ({
  validateApiKey: vi.fn(),
}));

// Import the routers and mocks
import { queryRouter } from '../../src/engine/queryRouter.js';
import * as apiKeyService from '../../src/services/apiKey.service.js';
import prisma from '../../src/config/database.js';

const app = express();
app.use(express.json());

// Mock Auth Middleware
app.use('/api/v1/query', async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    try {
      const keyData = await apiKeyService.validateApiKey(apiKey, req.ip);
      req.apiKeyContext = {
        keyId: keyData.keyId,
        keyName: keyData.keyName,
        scopes: keyData.scopes,
        tenantId: keyData.tenantId,
        tenantCode: keyData.tenantCode,
      };
      return next();
    } catch (error) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid key' } });
    }
  }
  return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing key' } });
}, queryRouter);

app.use((err, req, res, next) => {
  res.status(err.statusCode || err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Internal server error'
    }
  });
});

describe('Phase 2: Partner API Mutations E2E (Mocked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock the API key validation with mutation scopes
    apiKeyService.validateApiKey.mockResolvedValue({
      tenantId: 'tenant-123',
      scopes: ['cases:create', 'cases:update', 'referrals:create'],
      keyId: 'key-123',
      keyName: 'Phase 2 Pilot Partner',
      tenantCode: 'TENANT_A',
    });

    prisma.apiKey.findUnique.mockResolvedValue({ createdBy: 'sys-user' });
  });

  describe('createCase', () => {
    it('creates a case via API key with valid workflow', async () => {
      prisma.workflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        version: 1,
        steps: [{ id: 'step-1', isInitial: true, name: 'Triage' }]
      });
      prisma.tenant.findUnique.mockResolvedValue({ code: 'TNA' });
      prisma.caseSequence.upsert.mockResolvedValue({ lastSeq: 42 });
      prisma.case.create.mockResolvedValue({
        id: 'case-1',
        caseNumber: 'TNA-2026-0042',
        status: 'open',
        createdAt: new Date(),
      });

      const res = await request(app)
        .post('/api/v1/query')
        .set('X-API-Key', 'iacms_live_test')
        .send({
          operation: 'mutate',
          action: 'createCase',
          data: {
            workflowKey: 'standard-incident',
            title: 'Test Incident',
            type: 'incident',
          }
        });

      if (res.status === 500) console.error(res.body);
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.caseNumber).toBe('TNA-2026-0042');
      expect(prisma.caseHistory.create).toHaveBeenCalled();
      expect(prisma.auditOutbox.create).toHaveBeenCalled();
    });

    it('returns 422 if workflow is unpublished or missing', async () => {
      prisma.workflow.findFirst.mockResolvedValue(null); // Not found or not published

      const res = await request(app)
        .post('/api/v1/query')
        .set('X-API-Key', 'iacms_live_test')
        .send({
          operation: 'mutate',
          action: 'createCase',
          data: {
            workflowKey: 'missing-workflow',
            title: 'Test',
            type: 'incident',
          }
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
    });
  });

  describe('executeTransition', () => {
    it('executes a valid transition', async () => {
      prisma.case.findFirst.mockResolvedValue({
        id: 'case-1',
        tenantId: 'tenant-123',
        status: 'open',
        currentStepId: 'step-1'
      });
      prisma.workflowTransition.findUnique.mockResolvedValue({
        id: 'trans-1',
        fromStepId: 'step-1',
        toStepId: 'step-2',
        requiresComment: false,
        toStep: { isFinal: false, name: 'In Progress' }
      });
      prisma.case.update.mockResolvedValue({});

      const res = await request(app)
        .post('/api/v1/query')
        .set('X-API-Key', 'iacms_live_test')
        .send({
          operation: 'mutate',
          action: 'executeTransition',
          data: {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            transitionId: '123e4567-e89b-12d3-a456-426614174001',
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.currentStep).toBe('In Progress');
      expect(prisma.case.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ currentStepId: 'step-2', status: 'open' })
      }));
    });

    it('returns 422 if transition requires a comment but none is provided', async () => {
      prisma.case.findFirst.mockResolvedValue({
        id: 'case-1',
        status: 'open',
        currentStepId: 'step-1'
      });
      prisma.workflowTransition.findUnique.mockResolvedValue({
        id: 'trans-1',
        fromStepId: 'step-1',
        requiresComment: true,
        toStep: { isFinal: false }
      });

      const res = await request(app)
        .post('/api/v1/query')
        .set('X-API-Key', 'iacms_live_test')
        .send({
          operation: 'mutate',
          action: 'executeTransition',
          data: {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            transitionId: '123e4567-e89b-12d3-a456-426614174001',
          }
        });

      expect(res.status).toBe(422);
      expect(res.body.error.message).toMatch(/requires a comment/);
    });
  });

  describe('createReferral', () => {
    it('creates a referral to a valid tenant', async () => {
      prisma.case.findFirst.mockResolvedValue({
        id: 'case-1',
        tenantId: 'tenant-123',
        currentTenantId: 'tenant-123',
        caseNumber: 'CASE-123'
      });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-456', code: 'TARGET', isActive: true });
      prisma.caseReferral.create.mockResolvedValue({
        id: 'ref-1',
        referredAt: new Date()
      });

      const res = await request(app)
        .post('/api/v1/query')
        .set('X-API-Key', 'iacms_live_test')
        .send({
          operation: 'mutate',
          action: 'createReferral',
          data: {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            toTenantCode: 'TARGET',
            referralReason: 'Needs specialist'
          }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.toTenant).toBe('TARGET');
    });

    it('returns 400 if target tenant is not found', async () => {
      prisma.case.findFirst.mockResolvedValue({
        tenantId: 'tenant-123',
        currentTenantId: 'tenant-123'
      });
      prisma.tenant.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/query')
        .set('X-API-Key', 'iacms_live_test')
        .send({
          operation: 'mutate',
          action: 'createReferral',
          data: {
            caseId: '123e4567-e89b-12d3-a456-426614174000',
            toTenantCode: 'INVALID',
            referralReason: 'Test'
          }
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Authorization', () => {
    it('returns 403 if API key lacks required scope', async () => {
      apiKeyService.validateApiKey.mockResolvedValue({
        tenantId: 'tenant-123',
        scopes: ['cases:read'], // Lacks cases:create
        keyId: 'key-123',
      });

      const res = await request(app)
        .post('/api/v1/query')
        .set('X-API-Key', 'iacms_live_test')
        .send({
          operation: 'mutate',
          action: 'createCase',
          data: {
            workflowKey: 'test',
            title: 'Test',
            type: 'incident',
          }
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
