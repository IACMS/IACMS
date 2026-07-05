/**
 * Unit tests — CaseReferral gateway identity middleware.
 */
import { describe, it, expect, vi } from 'vitest';
import { requireGatewayIdentity } from '../../src/middleware/requireGatewayIdentity.js';
import { UnauthorizedError } from '../../../../shared/common/errors.js';

describe('CaseReferral API — requireGatewayIdentity', () => {
  it('passes when x-tenant-id and x-user-id are present', () => {
    const next = vi.fn();
    requireGatewayIdentity(
      { headers: { 'x-tenant-id': 't1', 'x-user-id': 'u1' } },
      {},
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects missing identity headers', () => {
    const next = vi.fn();
    requireGatewayIdentity({ headers: {} }, {}, next);
    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
  });
});
