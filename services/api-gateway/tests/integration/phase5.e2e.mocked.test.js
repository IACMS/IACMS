import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock dependencies
vi.mock('../../src/config/database.js', () => {
  const prismaMock = {
    apiKey: {
      findUnique: vi.fn(),
    },
    department: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    case: {
      findFirst: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    assignment: {
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    workflow: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    workflowStep: {
      create: vi.fn(),
    },
    workflowTransition: {
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
      const context = await apiKeyService.validateApiKey(apiKey);
      req.apiKeyContext = context;
      req.tenantId = context.tenantId;
      req.user = { id: context.createdBy }; // For backwards compatibility
      return next();
    } catch (error) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: error.message } });
    }
  }
  return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No auth' } });
});

app.use('/api/v1/query', queryRouter);

describe('Phase 5: Administrative Partner API Mutations', () => {
  const mockTenantId = 'tenant-123';
  const mockUserId = 'user-123';
  const mockApiKeyId = 'key-123';

  beforeEach(() => {
    vi.clearAllMocks();
    apiKeyService.validateApiKey.mockResolvedValue({
      tenantId: mockTenantId,
      createdBy: mockUserId,
      keyId: mockApiKeyId,
      scopes: ['*'],
    });

    prisma.apiKey.findUnique.mockResolvedValue({ createdBy: mockUserId });
  });

  describe('createDepartment', () => {
    it('creates a department successfully', async () => {
      prisma.department.findUnique.mockResolvedValue(null);
      prisma.department.create.mockResolvedValue({
        id: 'dept-123',
        code: 'HR',
        name: 'Human Resources',
      });

      const response = await request(app)
        .post('/api/v1/query')
        .set('x-api-key', 'valid-key')
        .send({
          operation: 'mutate',
          action: 'createDepartment',
          data: {
            code: 'HR',
            name: 'Human Resources',
          },
        });

      console.log(response.body); expect(response.status).toBe(200);
      expect(response.body.data.departmentId).toBe('dept-123');
      expect(prisma.department.create).toHaveBeenCalledTimes(1);
      expect(prisma.auditOutbox.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('createAssignment', () => {
    it('creates an assignment successfully', async () => {
      const validCaseId = '123e4567-e89b-12d3-a456-426614174000';
      const validUserId = '123e4567-e89b-12d3-a456-426614174001';
      prisma.case.findFirst.mockResolvedValue({ id: validCaseId, status: 'open', tenantId: mockTenantId });
      prisma.user.findFirst.mockResolvedValue({ id: validUserId, isActive: true, tenantId: mockTenantId });
      prisma.assignment.create.mockResolvedValue({
        id: 'assign-123',
        caseId: validCaseId,
        assignedTo: validUserId,
        assignmentType: 'manual',
      });

      const response = await request(app)
        .post('/api/v1/query')
        .set('x-api-key', 'valid-key')
        .send({
          operation: 'mutate',
          action: 'createAssignment',
          data: {
            caseId: validCaseId,
            assignedTo: validUserId,
          },
        });

      console.log(response.body); expect(response.status).toBe(200);
      expect(response.body.data.assignmentId).toBe('assign-123');
      expect(prisma.assignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { caseId: '123e4567-e89b-12d3-a456-426614174000', isActive: true }
      }));
      expect(prisma.assignment.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('createWorkflow', () => {
    it('creates a workflow with steps and transitions', async () => {
      prisma.workflow.findMany.mockResolvedValue([]);
      prisma.workflow.create.mockResolvedValue({ id: 'wf-123', key: 'TEST', version: 1, status: 'DRAFT' });
      
      let stepCounter = 1;
      prisma.workflowStep.create.mockImplementation((data) => {
        return Promise.resolve({ id: `step-${stepCounter++}`, key: data.data.key });
      });

      const response = await request(app)
        .post('/api/v1/query')
        .set('x-api-key', 'valid-key')
        .send({
          operation: 'mutate',
          action: 'createWorkflow',
          data: {
            key: 'TEST',
            name: 'Test Workflow',
            steps: [
              { key: 'START', name: 'Start', isInitial: true },
              { key: 'END', name: 'End', isFinal: true }
            ],
            transitions: [
              { fromStepKey: 'START', toStepKey: 'END', name: 'Complete' }
            ]
          },
        });

      console.log(response.body); expect(response.status).toBe(200);
      expect(response.body.data.workflowId).toBe('wf-123');
      expect(prisma.workflow.create).toHaveBeenCalledTimes(1);
      expect(prisma.workflowStep.create).toHaveBeenCalledTimes(2);
      expect(prisma.workflowTransition.create).toHaveBeenCalledTimes(1);
      expect(prisma.workflowTransition.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          fromStepId: 'step-1',
          toStepId: 'step-2'
        })
      }));
    });
  });

  describe('updateDepartment', () => {
    it('updates a department successfully', async () => {
      const deptUuid = '123e4567-e89b-12d3-a456-426614174010';
      prisma.department.findUnique.mockImplementation(({ where }) => {
        if (where.id) return Promise.resolve({ id: deptUuid, tenantId: mockTenantId, name: 'Old HR' });
        if (where.tenantId_name) return Promise.resolve(null);
        return Promise.resolve(null);
      });
      prisma.department.update.mockResolvedValue({ id: deptUuid, name: 'Updated HR' });

      const response = await request(app)
        .post('/api/v1/query')
        .set('x-api-key', 'valid-key')
        .send({
          operation: 'mutate',
          action: 'updateDepartment',
          data: {
            departmentId: deptUuid,
            name: 'Updated HR',
          },
        });

      console.log('updateDepartment res:', response.body);
      expect(response.status).toBe(200);
      expect(response.body.data.departmentId).toBe(deptUuid);
      expect(prisma.department.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: deptUuid },
        data: { name: 'Updated HR' }
      }));
    });
  });

  describe('updateWorkflowStatus', () => {
    it('updates workflow status successfully', async () => {
      const wfUuid = '123e4567-e89b-12d3-a456-426614174020';
      prisma.workflow.findUnique.mockResolvedValue({ 
        id: wfUuid, 
        tenantId: mockTenantId, 
        status: 'DRAFT',
        steps: [{ isInitial: true }] // required for publishing validation
      });
      prisma.workflow.update.mockResolvedValue({ id: wfUuid, status: 'PUBLISHED' });

      const response = await request(app)
        .post('/api/v1/query')
        .set('x-api-key', 'valid-key')
        .send({
          operation: 'mutate',
          action: 'updateWorkflowStatus',
          data: {
            workflowId: wfUuid,
            status: 'PUBLISHED',
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.data.workflowId).toBe(wfUuid);
      expect(prisma.workflow.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: wfUuid },
        data: expect.objectContaining({ 
          status: 'PUBLISHED',
          publishedAt: expect.any(Date)
        })
      }));
    });
  });
});
