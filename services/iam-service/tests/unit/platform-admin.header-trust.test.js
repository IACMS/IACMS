import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.INTERNAL_SERVICE_TOKEN = 'expected-secret-token-12345';

vi.mock('../../src/config/database.js', () => ({
  default: {
    role: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { assertPlatformAdmin as assertOrgAdmin } from '../../src/controllers/iam-organizations.controller.js';
import { assertPlatformAdmin as assertClientAdmin } from '../../src/controllers/oauth-clients.controller.js';

describe('IAM platform admin header trust tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_SERVICE_TOKEN = 'expected-secret-token-12345';
  });

  afterEach(() => {
    process.env.INTERNAL_SERVICE_TOKEN = 'iacms-internal-service-token-dev';
  });

  it('rejects raw x-user-permissions header when internal service token is missing', async () => {
    const req = {
      headers: {
        'x-user-permissions': 'platform:manage_tenants',
      },
    };

    await expect(assertOrgAdmin(req)).rejects.toThrow();
    await expect(assertClientAdmin(req)).rejects.toThrow();
  });

  it('rejects raw x-user-permissions header when internal service token is invalid', async () => {
    const req = {
      headers: {
        'x-user-permissions': 'platform:manage_tenants',
        'x-internal-service-token': 'wrong-token',
      },
    };

    await expect(assertOrgAdmin(req)).rejects.toThrow();
    await expect(assertClientAdmin(req)).rejects.toThrow();
  });

  it('accepts x-user-permissions header when valid internal service token is provided', async () => {
    const req = {
      headers: {
        'x-user-permissions': 'platform:manage_tenants',
        'x-internal-service-token': 'expected-secret-token-12345',
      },
    };

    await expect(assertOrgAdmin(req)).resolves.toBeUndefined();
    await expect(assertClientAdmin(req)).resolves.toBeUndefined();
  });
});
