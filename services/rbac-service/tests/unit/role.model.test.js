/**
 * Unit tests — Role model query shaping (getRoles tenant filter).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: { role: { findMany } },
}));

import { getRoles } from '../../src/controllers/role.controller.js';

function mockRes() {
  const res = { body: null };
  res.json = vi.fn((body) => { res.body = body; return res; });
  return res;
}

describe('Role model — getRoles', () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it('returns global and tenant-scoped roles when tenantId is provided', async () => {
    const roles = [{ id: 'r1', name: 'tenant_admin' }];
    findMany.mockResolvedValue(roles);

    const req = { query: { tenantId: '11111111-1111-1111-1111-111111111111' } };
    const res = mockRes();
    await getRoles(req, res, vi.fn());

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ tenantId: null }, { tenantId: '11111111-1111-1111-1111-111111111111' }] },
      }),
    );
    expect(res.body.roles).toEqual(roles);
  });

  it('returns all roles when tenantId is omitted', async () => {
    findMany.mockResolvedValue([]);
    await getRoles({ query: {} }, mockRes(), vi.fn());
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
