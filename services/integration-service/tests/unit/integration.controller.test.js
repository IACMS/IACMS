import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  default: {
    integration: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const { mockPublish } = vi.hoisted(() => ({
  mockPublish: vi.fn(),
}));
vi.mock('../../../../shared/utils/eventBus.js', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      publish: mockPublish,
    })),
  };
});

import prisma from '../../src/config/database.js';
import EventBus from '../../../../shared/utils/eventBus.js';
import {
  getIntegrations,
  getIntegration,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  syncIntegration,
} from '../../src/controllers/integration.controller.js';

describe('Integration Controller Unit Tests', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPublish.mockClear();
    req = {
      params: {},
      query: {},
      body: {},
    };
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    };
    next = vi.fn();
  });

  describe('getIntegrations', () => {
    it('returns a list of integrations', async () => {
      req.query = { tenantId: 'tenant-123', type: 'stripe' };
      const mockIntegrations = [{ id: 'int-1' }];
      prisma.integration.findMany.mockResolvedValue(mockIntegrations);

      await getIntegrations(req, res, next);

      expect(prisma.integration.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-123', type: 'stripe' },
        })
      );
      expect(res.json).toHaveBeenCalledWith({ integrations: mockIntegrations });
    });
  });

  describe('getIntegration', () => {
    it('returns a safe integration by id without sensitive fields', async () => {
      req.params = { id: 'int-1' };
      const mockIntegration = { id: 'int-1', apiKey: 'secret', apiSecret: 'super-secret', name: 'Test' };
      prisma.integration.findUnique.mockResolvedValue(mockIntegration);

      await getIntegration(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        integration: { id: 'int-1', name: 'Test' }, // secrets omitted
      });
    });

    it('throws NotFoundError if integration is missing', async () => {
      req.params = { id: 'int-1' };
      prisma.integration.findUnique.mockResolvedValue(null);

      await getIntegration(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'NotFoundError' }));
    });
  });

  describe('createIntegration', () => {
    it('creates an integration, publishes an event, and returns safe data', async () => {
      req.body = { type: 'stripe', name: 'Payments' };
      const mockIntegration = { id: 'int-1', tenantId: 't-1', type: 'stripe', apiKey: 'secret' };
      prisma.integration.create.mockResolvedValue(mockIntegration);

      await createIntegration(req, res, next);

      expect(mockPublish).toHaveBeenCalledWith('integration.created', {
        integrationId: 'int-1',
        tenantId: 't-1',
        type: 'stripe',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        integration: { id: 'int-1', tenantId: 't-1', type: 'stripe' }, // apiKey omitted
      });
    });
  });

  describe('updateIntegration', () => {
    it('updates integration and publishes event', async () => {
      req.params = { id: 'int-1' };
      req.body = { name: 'Updated Name' };
      const mockIntegration = { id: 'int-1', name: 'Updated Name', apiSecret: 'hidden' };
      prisma.integration.update.mockResolvedValue(mockIntegration);

      await updateIntegration(req, res, next);

      expect(mockPublish).toHaveBeenCalledWith('integration.updated', {
        integrationId: 'int-1',
      });
      expect(res.json).toHaveBeenCalledWith({
        integration: { id: 'int-1', name: 'Updated Name' },
      });
    });
  });

  describe('deleteIntegration', () => {
    it('deletes integration', async () => {
      req.params = { id: 'int-1' };
      prisma.integration.delete.mockResolvedValue({});
      
      await deleteIntegration(req, res, next);
      expect(prisma.integration.delete).toHaveBeenCalledWith({ where: { id: 'int-1' } });
      expect(res.json).toHaveBeenCalledWith({ message: 'Integration deleted' });
    });
  });

  describe('syncIntegration', () => {
    it('initiates a sync process and publishes event', async () => {
      req.params = { id: 'int-1' };
      const mockIntegration = { id: 'int-1', type: 'slack' };
      prisma.integration.findUnique.mockResolvedValue(mockIntegration);
      prisma.integration.update.mockResolvedValue({ ...mockIntegration, lastSyncAt: new Date() });

      await syncIntegration(req, res, next);

      expect(prisma.integration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'int-1' },
          data: expect.objectContaining({
            syncStatus: expect.objectContaining({ status: 'syncing' }),
          }),
        })
      );
      expect(mockPublish).toHaveBeenCalledWith('integration.sync', {
        integrationId: 'int-1',
        type: 'slack',
      });
    });
  });
});
