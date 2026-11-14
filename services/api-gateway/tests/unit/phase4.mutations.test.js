/**
 * Phase 4.1 — Expanded Mutations Test Suite
 *
 * Tests all 5 new mutation handlers using mocked Prisma and context.
 * Pattern mirrors phase3.e2e.mocked.test.js — no real DB or network needed.
 */

import { vi, vi as jest, describe, it, expect, beforeEach } from 'vitest';
import { createIamUser, setIamIdentityActive, updateIamIdentity } from '../../src/services/iamIdentity.service.js';

vi.mock('../../src/services/iamIdentity.service.js', () => ({
  createIamUser: jest.fn().mockResolvedValue({
    id: 'user-new', email: 'new@agency.gov', firstName: 'Jane', lastName: 'Doe',
    username: 'jdoe_a1b2c3', mustChangePassword: true,
  }),
  setIamIdentityActive: jest.fn().mockResolvedValue({}),
  updateIamIdentity: jest.fn().mockImplementation(({ userId, fields }) => Promise.resolve({
    id: userId,
    email: 'x@y.com',
    firstName: fields.firstName || 'Old',
    lastName: fields.lastName || 'Name',
    phone: fields.phone || null,
    updatedAt: new Date(),
  })),
}));

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** Build a minimal mutation context */
function makeContext(overrides = {}) {
  return {
    tenantId: 'tenant-aaa',
    apiKeyId: 'key-111',
    apiKeyOwnerId: 'user-actor',
    sourceIp: '127.0.0.1',
    requestId: 'req-test',
    scopes: ['cases:update', 'users:create', 'users:update'],
    ...overrides,
  };
}

/** Build a mock Prisma client for the given test shape */
function makePrisma(shape = {}) {
  return {
    apiKey: {
      findUnique: jest.fn().mockResolvedValue({ createdBy: 'user-actor' }),
    },
    case: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    caseHistory: {
      create: jest.fn().mockResolvedValue({}),
    },
    identityProjection: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    department: {
      findFirst: jest.fn(),
    },
    role: {
      findUnique: jest.fn(),
    },
    userRole: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((cb) => cb({
      case: { findFirst: jest.fn(), update: jest.fn() },
      caseHistory: { create: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      department: { findFirst: jest.fn() },
      role: { findUnique: jest.fn() },
      userRole: { create: jest.fn().mockResolvedValue({}) },
    })),
    ...shape,
  };
}

// ─── updateCase ────────────────────────────────────────────────────────────────

describe('updateCase mutation', () => {
  let execute, schema;

  beforeEach(async () => {
    const mod = await import('../../src/engine/mutations/updateCase.mutation.js');
    execute = mod.execute;
    schema = mod.schema;
  });

  it('updates allowed fields on an open case', async () => {
    const prisma = makePrisma({
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'case-1', status: 'open', caseNumber: 'TST-2026-0001',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'case-1', caseNumber: 'TST-2026-0001',
          title: 'Updated Title', description: null,
          priority: 'high', type: 'standard',
          status: 'open', dueDate: null,
          updatedAt: new Date('2026-09-03T00:00:00Z'),
        }),
      },
    });

    const ctx = { ...makeContext(), prisma };
    const result = await execute(
      { caseId: 'case-1', title: 'Updated Title', priority: 'high' },
      ctx,
    );

    expect(result.caseNumber).toBe('TST-2026-0001');
    expect(result.updatedFields).toContain('title');
    expect(result.updatedFields).toContain('priority');
    expect(prisma.case.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'case-1' },
      data: expect.objectContaining({ title: 'Updated Title', priority: 'high' }),
    }));
  });

  it('blocks updates on a closed case', async () => {
    const prisma = makePrisma({
      case: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'case-1', status: 'closed', caseNumber: 'TST-2026-0001',
        }),
        update: jest.fn(),
      },
    });

    const ctx = { ...makeContext(), prisma };
    await expect(execute({ caseId: 'case-1', title: 'X' }, ctx))
      .rejects.toThrow(/closed/);
    expect(prisma.case.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError if case does not belong to tenant', async () => {
    const prisma = makePrisma({
      case: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    });

    const ctx = { ...makeContext(), prisma };
    await expect(execute({ caseId: 'case-other', title: 'X' }, ctx))
      .rejects.toThrow(/not found/i);
  });

  it('rejects schema if only caseId is provided', () => {
    const result = schema.safeParse({ caseId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    expect(result.success).toBe(false);
  });
});

// ─── closeCase ────────────────────────────────────────────────────────────────

describe('closeCase mutation', () => {
  let execute;

  beforeEach(async () => {
    const mod = await import('../../src/engine/mutations/closeCase.mutation.js');
    execute = mod.execute;
  });

  it('closes an open case and returns closedAt', async () => {
    const fakeCase = {
      id: 'case-2', status: 'open', caseNumber: 'TST-2026-0002',
      currentStepId: 'step-1',
      currentStep: { id: 'step-1', name: 'Initial' },
    };
    const txMock = {
      case: {
        findFirst: jest.fn().mockResolvedValue(fakeCase),
        update: jest.fn(),
      },
      caseHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      apiKey: { findUnique: jest.fn().mockResolvedValue({ createdBy: 'user-actor' }) },
      $transaction: jest.fn((cb) => cb(txMock)),
    };

    const ctx = { ...makeContext(), prisma };
    const result = await execute({ caseId: 'case-2' }, ctx);

    expect(result.status).toBe('closed');
    expect(result.closedAt).toBeDefined();
    expect(txMock.case.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'closed' }),
    }));
    expect(txMock.caseHistory.create).toHaveBeenCalled();
  });

  it('throws BusinessRuleViolationError if case is already closed', async () => {
    const fakeCase = {
      id: 'case-2', status: 'closed', caseNumber: 'TST-2026-0002',
      currentStepId: 'step-1', currentStep: { id: 'step-1', name: 'Closed' },
    };
    const txMock = {
      case: { findFirst: jest.fn().mockResolvedValue(fakeCase), update: jest.fn() },
      caseHistory: { create: jest.fn() },
    };
    const prisma = {
      apiKey: { findUnique: jest.fn().mockResolvedValue({ createdBy: 'user-actor' }) },
      $transaction: jest.fn((cb) => cb(txMock)),
    };

    const ctx = { ...makeContext(), prisma };
    await expect(execute({ caseId: 'case-2' }, ctx))
      .rejects.toThrow(/already closed/i);
  });
});

// ─── inviteUser ────────────────────────────────────────────────────────────────

describe('inviteUser mutation', () => {
  let execute;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('../../src/engine/mutations/inviteUser.mutation.js');
    execute = mod.execute;
  });

  it('creates a user with mustChangePassword true', async () => {
    const txMock = {
      $executeRaw: jest.fn(),
      identityProjection: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      department: { findFirst: jest.fn() },
      role: { findUnique: jest.fn() },
      userRole: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn((cb) => cb(txMock)),
    };

    const ctx = { ...makeContext(), prisma };
    const result = await execute(
      { email: 'new@agency.gov', firstName: 'Jane', lastName: 'Doe' },
      ctx,
    );

    expect(result.mustChangePassword).toBe(true);
    expect(result.email).toBe('new@agency.gov');
    expect(createIamUser).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'user-actor', tenantId: 'tenant-aaa',
    }));
    expect(txMock.identityProjection.upsert).toHaveBeenCalled();
  });

  it('rejects when email already exists in tenant', async () => {
    const txMock = {
      $executeRaw: jest.fn(),
      identityProjection: { findFirst: jest.fn().mockResolvedValue({ subjectId: 'existing-user' }) },
      department: { findFirst: jest.fn() },
      role: { findUnique: jest.fn() },
      userRole: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((cb) => cb(txMock)) };

    const ctx = { ...makeContext(), prisma };
    await expect(execute(
      { email: 'existing@agency.gov', firstName: 'A', lastName: 'B' },
      ctx,
    )).rejects.toThrow(/already exists/i);
    expect(createIamUser).not.toHaveBeenCalled();
  });

  it('blocks assignment of a system role', async () => {
    const txMock = {
      $executeRaw: jest.fn(),
      identityProjection: { findFirst: jest.fn().mockResolvedValue(null) },
      department: { findFirst: jest.fn() },
      role: { findUnique: jest.fn().mockResolvedValue({
        id: 'sys-role', tenantId: 'tenant-aaa', isSystemRole: true, isActive: true,
      }) },
      userRole: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((cb) => cb(txMock)) };

    const ctx = { ...makeContext(), prisma };
    await expect(execute(
      { email: 'x@y.com', firstName: 'A', lastName: 'B', roleId: 'sys-role' },
      ctx,
    )).rejects.toThrow(/system roles/i);
  });
});

// ─── deactivateUser ────────────────────────────────────────────────────────────

describe('deactivateUser mutation', () => {
  let execute;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('../../src/engine/mutations/deactivateUser.mutation.js');
    execute = mod.execute;
  });

  it('deactivates an active user', async () => {
    const prisma = {
      apiKey: { findUnique: jest.fn().mockResolvedValue({ createdBy: 'user-actor' }) },
      identityProjection: {
        findUnique: jest.fn().mockResolvedValue({
          subjectId: 'user-x', email: 'x@y.com',
          firstName: 'X', lastName: 'Y', isActive: true,
        }),
      },
    };

    const ctx = { ...makeContext(), prisma };
    const result = await execute({ userId: 'user-x' }, ctx);

    expect(result.isActive).toBe(false);
    expect(setIamIdentityActive).toHaveBeenCalledWith({ userId: 'user-x', tenantId: 'tenant-aaa', isActive: false });
    expect(prisma.identityProjection.findUnique).toHaveBeenCalled();
  });

  it('blocks self-deactivation (key owner)', async () => {
    const prisma = {
      apiKey: { findUnique: jest.fn().mockResolvedValue({ createdBy: 'user-actor' }) },
      identityProjection: { findUnique: jest.fn() },
    };

    const ctx = { ...makeContext(), prisma };
    // userId === createdBy → should throw ForbiddenError
    await expect(execute({ userId: 'user-actor' }, ctx))
      .rejects.toThrow(/cannot deactivate/i);
    expect(setIamIdentityActive).not.toHaveBeenCalled();
  });

  it('returns idempotent message if already inactive', async () => {
    const prisma = {
      apiKey: { findUnique: jest.fn().mockResolvedValue({ createdBy: 'user-actor' }) },
      identityProjection: {
        findUnique: jest.fn().mockResolvedValue({
          subjectId: 'user-x', email: 'x@y.com',
          firstName: 'X', lastName: 'Y', isActive: false,
        }),
      },
    };

    const ctx = { ...makeContext(), prisma };
    const result = await execute({ userId: 'user-x' }, ctx);

    expect(result.isActive).toBe(false);
    expect(setIamIdentityActive).not.toHaveBeenCalled();
  });
});

// ─── updateUser ────────────────────────────────────────────────────────────────

describe('updateUser mutation', () => {
  let execute, schema;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await import('../../src/engine/mutations/updateUser.mutation.js');
    execute = mod.execute;
    schema = mod.schema;
  });

  it('updates firstName and lastName', async () => {
    const prisma = {
      identityProjection: {
        findUnique: jest.fn().mockResolvedValue({
          subjectId: 'user-x', firstName: 'Old', lastName: 'Name', email: 'x@y.com', phone: null, projectedAt: new Date(),
        }),
        update: jest.fn(),
      },
      department: { findFirst: jest.fn() },
    };

    const ctx = { ...makeContext(), prisma };
    const result = await execute(
      { userId: 'user-x', firstName: 'New' },
      ctx,
    );

    expect(result.updatedFields).toContain('firstName');
    expect(updateIamIdentity).toHaveBeenCalledWith({ userId: 'user-x', tenantId: 'tenant-aaa', fields: { firstName: 'New' } });
    expect(prisma.identityProjection.update).not.toHaveBeenCalled();
  });

  it('rejects schema when only userId is provided', () => {
    const result = schema.safeParse({ userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    expect(result.success).toBe(false);
  });

  it('throws ValidationError for unknown departmentCode', async () => {
    const prisma = {
      identityProjection: {
        findUnique: jest.fn().mockResolvedValue({
          subjectId: 'user-x', firstName: 'A', lastName: 'B', email: 'x@y.com', phone: null, projectedAt: new Date(),
        }),
        update: jest.fn(),
      },
      department: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const ctx = { ...makeContext(), prisma };
    await expect(execute(
      { userId: 'user-x', departmentCode: 'GHOST-DEPT' },
      ctx,
    )).rejects.toThrow(/not found/i);
    expect(prisma.identityProjection.update).not.toHaveBeenCalled();
  });
});
