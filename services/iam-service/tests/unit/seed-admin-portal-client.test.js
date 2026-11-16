import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config/database.js', () => ({
  default: {
    role: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    oAuthClient: {
      upsert: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userRole: {
      upsert: vi.fn(),
    },
    userApplicationRole: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockImplementation(async (pwd) => `hashed:${pwd}`),
    compare: vi.fn().mockResolvedValue(true),
  },
}));

import prisma from '../../src/config/database.js';
import bcrypt from 'bcryptjs';
import { seedAdminPortalClient } from '../../scripts/seed-admin-portal-client.js';

describe('seedAdminPortalClient', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.SEED_ADMIN_PASSWORD;

    prisma.role.findFirst.mockResolvedValue({ id: 'role-1', slug: 'iam-admin' });
    prisma.role.create.mockImplementation(async ({ data }) => ({ id: 'role-created', ...data }));
    prisma.role.update.mockImplementation(async ({ data }) => ({ id: 'role-updated', ...data }));
    prisma.oAuthClient.upsert.mockResolvedValue({ id: 'client-1', clientId: 'iam_admin_portal' });
    prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', code: 'ADMIN' });
    prisma.tenant.create.mockResolvedValue({ id: 'tenant-1', code: 'ADMIN' });
    prisma.userRole.upsert.mockResolvedValue({});
    prisma.userApplicationRole.upsert.mockResolvedValue({});
    prisma.user.create.mockImplementation(async ({ data }) => ({ id: 'user-created', ...data }));
    prisma.user.update.mockImplementation(async ({ data }) => ({ id: 'user-updated', ...data }));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('refuses to run in production', async () => {
    process.env.NODE_ENV = 'production';
    await expect(seedAdminPortalClient()).rejects.toThrow(/production/i);
  });

  it('reads password from env and sets mustChangePassword to true on creation', async () => {
    process.env.SEED_ADMIN_PASSWORD = 'SuperSecurePasswordFromEnv!123';
    prisma.user.findFirst.mockResolvedValue(null);

    await seedAdminPortalClient();

    expect(bcrypt.hash).toHaveBeenCalledWith('SuperSecurePasswordFromEnv!123', 10);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'platform.admin@iacms.gov.example',
          passwordHash: 'hashed:SuperSecurePasswordFromEnv!123',
          mustChangePassword: true,
        }),
      })
    );
  });

  it('never resets an existing admin password if user already exists', async () => {
    const existingAdmin = {
      id: 'existing-admin-id',
      email: 'platform.admin@iacms.gov.example',
      passwordHash: 'existing-secure-hash-preserved',
      mustChangePassword: false,
      isActive: true,
    };
    prisma.user.findFirst.mockImplementation(async ({ where }) => {
      if (where.email === 'platform.admin@iacms.gov.example') return existingAdmin;
      return null;
    });

    await seedAdminPortalClient();

    // Verify user.update was not called with passwordHash
    const adminUpdates = prisma.user.update.mock.calls.filter(
      (call) => call[0]?.where?.id === existingAdmin.id
    );
    for (const call of adminUpdates) {
      expect(call[0]?.data?.passwordHash).toBeUndefined();
    }
  });
});
