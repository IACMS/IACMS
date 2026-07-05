/**
 * Unit tests — Case access policy (Case + UserRole models).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { userRoleFindMany, workflowStepFindFirst } = vi.hoisted(() => ({
  userRoleFindMany: vi.fn(),
  workflowStepFindFirst: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: {
    userRole: { findMany: userRoleFindMany },
    workflowStep: { findFirst: workflowStepFindFirst },
    case: { findFirst: vi.fn() },
  },
}));

import {
  userHasTenantWideCaseAccess,
  REGISTRAR_EDITABLE_STEP_KEYS,
  assertRegistrarMetadataEditAllowed,
} from '../../src/security/caseAccessPolicy.js';

describe('Case access — userHasTenantWideCaseAccess', () => {
  beforeEach(() => userRoleFindMany.mockReset());

  it('returns true when user has active tenant_admin role', async () => {
    userRoleFindMany.mockResolvedValue([{ roleId: 'r1' }]);
    const prisma = { userRole: { findMany: userRoleFindMany } };
    expect(await userHasTenantWideCaseAccess(prisma, 'u1')).toBe(true);
    expect(userRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { name: 'tenant_admin', isActive: true },
        }),
      }),
    );
  });

  it('returns false when user has no tenant_admin role', async () => {
    userRoleFindMany.mockResolvedValue([]);
    const prisma = { userRole: { findMany: userRoleFindMany } };
    expect(await userHasTenantWideCaseAccess(prisma, 'u1')).toBe(false);
  });
});

describe('Case metadata edit — assertRegistrarMetadataEditAllowed', () => {
  beforeEach(() => {
    userRoleFindMany.mockReset();
    workflowStepFindFirst.mockReset();
  });

  it('allows tenant admin regardless of step', async () => {
    userRoleFindMany.mockResolvedValue([{ roleId: 'r1' }]);
    const prisma = {
      userRole: { findMany: userRoleFindMany },
      workflowStep: { findFirst: workflowStepFindFirst },
    };
    await expect(
      assertRegistrarMetadataEditAllowed(
        prisma,
        { headers: { 'x-user-id': 'admin' } },
        { currentStepId: 'step-1' },
      ),
    ).resolves.toBeUndefined();
  });

  it('allows registrar on intake step only', async () => {
    userRoleFindMany.mockResolvedValue([]);
    workflowStepFindFirst.mockResolvedValue({ key: 'intake' });
    const prisma = {
      userRole: { findMany: userRoleFindMany },
      workflowStep: { findFirst: workflowStepFindFirst },
    };
    await expect(
      assertRegistrarMetadataEditAllowed(
        prisma,
        { headers: { 'x-user-id': 'registrar' } },
        { currentStepId: 'step-intake' },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('REGISTRAR_EDITABLE_STEP_KEYS regression', () => {
  it('includes intake and draft only', () => {
    expect(REGISTRAR_EDITABLE_STEP_KEYS.has('intake')).toBe(true);
    expect(REGISTRAR_EDITABLE_STEP_KEYS.has('draft')).toBe(true);
    expect(REGISTRAR_EDITABLE_STEP_KEYS.has('closed')).toBe(false);
  });
});
