/**
 * Unit tests — Assignment model validation.
 */
import { describe, it, expect, vi } from 'vitest';
import { ValidationError } from '../../../../shared/common/errors.js';
import { getAssignments } from '../../src/controllers/assignment.controller.js';

vi.mock('../../src/config/database.js', () => ({
  default: { assignment: { findMany: vi.fn() } },
}));

vi.mock('../../../../shared/utils/eventBus.js', () => ({
  default: class { publish = vi.fn(); },
  TOPICS: { AUDIT_LOG: 'audit.log' },
}));

describe('Assignment model — getAssignments', () => {
  it('requires x-tenant-id header', async () => {
    const next = vi.fn();
    await getAssignments({ headers: {}, query: {} }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});
