/**
 * Unit tests — tenant visibility helpers (Case model reads).
 */
import { describe, it, expect } from 'vitest';
import {
  readableCaseConditions,
  mutableCaseConditions,
  incomingReferralReadableCondition,
  writableCaseWhere,
} from '../../src/utils/tenant-scope.js';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('Case visibility — readableCaseConditions', () => {
  it('scopes to non-deleted cases visible to tenant', () => {
    const where = readableCaseConditions(TENANT);
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toHaveLength(4);
  });

  it('includes pending incoming referrals', () => {
    const incoming = incomingReferralReadableCondition(TENANT);
    expect(incoming.referrals.some.status).toBe('pending');
    expect(incoming.referrals.some.toTenantId).toBe(TENANT);
  });
});

describe('Case visibility — mutableCaseConditions', () => {
  it('allows mutation when currentTenantId matches', () => {
    const where = mutableCaseConditions(TENANT);
    expect(where.OR.some((c) => c.currentTenantId === TENANT)).toBe(true);
  });
});

describe('Case visibility — writableCaseWhere', () => {
  it('combines case id with mutable tenant scope', () => {
    const where = writableCaseWhere('case-1', TENANT);
    expect(where.id).toBe('case-1');
    expect(where.deletedAt).toBeNull();
  });
});
