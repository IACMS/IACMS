/**
 * Unit tests — Integration model strips secrets from API responses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: { integration: { findUnique } },
}));

vi.mock('../../../../shared/utils/eventBus.js', () => ({
  default: class {
    publish = vi.fn();
  },
}));

import { getIntegration } from '../../src/controllers/integration.controller.js';

function mockRes() {
  const res = {};
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('Integration model — getIntegration', () => {
  beforeEach(() => findUnique.mockReset());

  it('strips apiKey and apiSecret from response', async () => {
    findUnique.mockResolvedValue({
      id: 'i1',
      name: 'CRM',
      type: 'salesforce',
      apiKey: 'secret-key',
      apiSecret: 'secret-val',
      config: {},
    });
    const res = mockRes();
    await getIntegration({ params: { id: 'i1' } }, res, vi.fn());

    const { integration } = res.json.mock.calls[0][0];
    expect(integration.apiKey).toBeUndefined();
    expect(integration.apiSecret).toBeUndefined();
    expect(integration.name).toBe('CRM');
  });
});
