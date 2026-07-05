/**
 * Unit tests — CaseAttachment model validation.
 */
import { describe, it, expect, vi } from 'vitest';
import { ValidationError } from '../../../../shared/common/errors.js';
import { getAttachments } from '../../src/controllers/attachment.controller.js';

vi.mock('../../src/config/database.js', () => ({
  default: {
    caseAttachment: { findMany: vi.fn() },
    case: { findFirst: vi.fn() },
    userRole: { findMany: vi.fn().mockResolvedValue([{ roleId: 'r1' }]) },
    workflowStep: { findFirst: vi.fn() },
  },
}));

vi.mock('../../src/security/caseAccessPolicy.js', () => ({
  assertCaseReadable: vi.fn().mockResolvedValue({ id: 'c1' }),
}));

describe('CaseAttachment model — getAttachments', () => {
  it('requires x-tenant-id header', async () => {
    const next = vi.fn();
    await getAttachments({ headers: {}, params: { caseId: 'c1' } }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
  });
});
