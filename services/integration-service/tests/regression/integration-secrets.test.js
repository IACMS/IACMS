/**
 * Regression — Integration API must never leak apiKey/apiSecret (security contract).
 */
import { describe, it, expect, vi } from 'vitest';

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: { integration: { findUnique } },
}));

vi.mock('../../../../shared/utils/eventBus.js', () => ({
  default: class { publish = vi.fn(); },
}));

import { getIntegration } from '../../src/controllers/integration.controller.js';

describe('Integration secrets regression', () => {
  it('getIntegration never returns apiKey or apiSecret', async () => {
    findUnique.mockResolvedValue({
      id: 'i1',
      apiKey: 'leak',
      apiSecret: 'leak',
      name: 'X',
      type: 'api',
      config: {},
    });
    const res = { json: vi.fn() };
    await getIntegration({ params: { id: 'i1' } }, res, vi.fn());
    const payload = res.json.mock.calls[0][0].integration;
    expect(payload).not.toHaveProperty('apiKey');
    expect(payload).not.toHaveProperty('apiSecret');
  });
});
