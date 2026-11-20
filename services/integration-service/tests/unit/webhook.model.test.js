/**
 * Unit tests — Webhook model list filters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: { webhook: { findMany } },
}));

vi.mock('../../../../shared/utils/eventBus.js', () => ({
  default: class {
    publish = vi.fn();
  },
}));

import { getWebhooks } from '../../src/controllers/webhook.controller.js';

describe('Webhook model — getWebhooks', () => {
  beforeEach(() => findMany.mockReset());

  it('filters by tenantId and isActive', async () => {
    findMany.mockResolvedValue([]);
    const res = { json: vi.fn() };
    await getWebhooks(
      { query: { tenantId: 't1', isActive: 'true' } },
      res,
      vi.fn(),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', isActive: true },
      }),
    );
  });
});
