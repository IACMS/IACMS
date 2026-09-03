import { describe, it, expect, vi } from 'vitest';
import { executeMutation } from '../../src/engine/mutationDispatcher.js';
import * as mutationsRegistry from '../../src/engine/mutations/index.js';
import { ConflictError, ValidationError, NotFoundError } from '../../../../shared/common/errors.js';
import { z } from 'zod';
import prisma from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    auditOutbox: {
      create: vi.fn(),
    }
  }
}));

describe('mutationDispatcher error mapping', () => {
  it('should map P2002 to ConflictError', async () => {
    vi.spyOn(mutationsRegistry, 'getMutation').mockReturnValue({
      requiredScope: 'cases:update',
      schema: z.object({}),
      execute: async () => {
        const err = new Error('Prisma error');
        err.code = 'P2002';
        err.meta = { target: ['email'] };
        throw err;
      }
    });

    const request = { action: 'testAction', data: {} };
    const context = { tenantId: 'tenant-1', apiKeyId: 'key-1', scopes: ['cases:update'] };

    await expect(executeMutation(request, context)).rejects.toThrow(ConflictError);
    await expect(executeMutation(request, context)).rejects.toThrow('A record with this email already exists.');
  });

  it('should map P2003 to ValidationError', async () => {
    vi.spyOn(mutationsRegistry, 'getMutation').mockReturnValue({
      requiredScope: 'cases:update',
      schema: z.object({}),
      execute: async () => {
        const err = new Error('Prisma error');
        err.code = 'P2003';
        err.meta = { field_name: 'caseId' };
        throw err;
      }
    });

    const request = { action: 'testAction', data: {} };
    const context = { tenantId: 'tenant-1', apiKeyId: 'key-1', scopes: ['cases:update'] };

    await expect(executeMutation(request, context)).rejects.toThrow(ValidationError);
    await expect(executeMutation(request, context)).rejects.toThrow('Related caseId does not exist.');
  });

  it('should map P2025 to NotFoundError', async () => {
    vi.spyOn(mutationsRegistry, 'getMutation').mockReturnValue({
      requiredScope: 'cases:update',
      schema: z.object({}),
      execute: async () => {
        const err = new Error('Prisma error');
        err.code = 'P2025';
        throw err;
      }
    });

    const request = { action: 'testAction', data: {} };
    const context = { tenantId: 'tenant-1', apiKeyId: 'key-1', scopes: ['cases:update'] };

    await expect(executeMutation(request, context)).rejects.toThrow(NotFoundError);
  });
});
