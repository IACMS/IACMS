import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as jose from 'jose';

vi.mock('../../src/config/redis.config.js', () => ({
  getRedisClient: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
  })),
  closeRedisClient: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  default: {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    role: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    oAuthClient: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    oAuthProvider: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    iamOrganization: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    iamMembership: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    apiKey: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    userRole: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    userApplicationRole: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    permission: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback(prisma);
      }
      return callback;
    }),
  },
}));

import prisma from '../../src/config/database.js';
import { authenticateAdminRequest } from '../../src/middleware/admin-auth.middleware.js';
import {
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
} from '../../src/controllers/oauth-clients.controller.js';
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
} from '../../src/controllers/oauth-providers.controller.js';
import {
  listIamOrganizations,
  createIamOrganization,
  updateIamOrganization,
  addIamOrganizationMember,
} from '../../src/controllers/iam-organizations.controller.js';
import { getRoles, createRole } from '../../src/controllers/role.controller.js';
import { listApiKeys, revokeApiKey } from '../../src/controllers/api-keys.controller.js';

const ORG_A_ID = 'a0000000-0000-4000-8000-000000000001';
const ORG_B_ID = 'b0000000-0000-4000-8000-000000000002';
const TENANT_A_ID = 'a1111111-1111-4111-8111-111111111111';
const TENANT_B_ID = 'b2222222-2222-4222-8222-222222222222';

describe('Phase 2B Step 2: req.iamAdminScope & Multi-Organization Scoping / Isolation Tests', () => {
  let keyPair, testJwks;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';
    process.env.OIDC_ISSUER = 'http://localhost:3001';
    process.env.IAM_ADMIN_AUDIENCE = 'http://localhost:3001/admin-api';

    if (!keyPair) {
      keyPair = await jose.generateKeyPair('RS256', { extractable: true });
      const pub = await jose.exportJWK(keyPair.publicKey);
      testJwks = { keys: [{ ...pub, use: 'sig', alg: 'RS256', kid: 'admin-scope-test-key' }] };
    }
    process.env.OIDC_JWKS_JSON = JSON.stringify(testJwks);
  });

  async function makeOidcToken(claims = {}) {
    return new jose.SignJWT({
      iss: 'http://localhost:3001',
      aud: 'http://localhost:3001/admin-api',
      sub: claims.sub || 'user-admin-1',
      client_id: claims.client_id || 'iam_admin_portal',
      scope: claims.scope !== undefined ? claims.scope : 'openid profile roles iam:admin',
      roles: claims.roles || ['iam-admin'],
      iam_admin: claims.iam_admin !== undefined ? claims.iam_admin : true,
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'admin-scope-test-key' })
      .setExpirationTime('1h')
      .sign(keyPair.privateKey);
  }

  describe('1. Admin middleware sets req.iamAdminScope from database', () => {
    it('sets platform scope for system-admin / iam-admin', async () => {
      const token = await makeOidcToken({
        sub: 'user-platform-admin',
        roles: ['iam-admin'],
        iam_admin: true,
      });

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {};
      const next = vi.fn();

      prisma.oAuthClient.findFirst.mockResolvedValue({
        id: 'client-portal-id',
        clientId: 'iam_admin_portal',
        targetAudience: 'http://localhost:3001/admin-api',
        iamOrganizationId: null,
      });
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-platform-admin',
        isActive: true,
        tenantId: 'tenant-admin-id',
      });
      prisma.userApplicationRole.findMany.mockResolvedValue([
        { role: { slug: 'iam-admin', name: 'IAM Administrator' } },
      ]);

      await authenticateAdminRequest(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.iamAdminAuthorized).toBe(true);
      expect(req.iamAdminScope).toBeDefined();
      expect(req.iamAdminScope.type).toBe('platform');
    });

    it('sets organization scope for client admin (tenant-admin) bound to Org A', async () => {
      const token = await makeOidcToken({
        sub: 'user-client-admin-a',
        roles: ['tenant-admin'],
        iam_admin: true,
      });

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {};
      const next = vi.fn();

      prisma.oAuthClient.findFirst.mockResolvedValue({
        id: 'client-portal-id',
        clientId: 'iam_admin_portal',
        targetAudience: 'http://localhost:3001/admin-api',
        iamOrganizationId: null,
      });
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-client-admin-a',
        isActive: true,
        tenantId: 'tenant-a-id',
      });
      prisma.userApplicationRole.findMany.mockResolvedValue([
        { role: { slug: 'tenant-admin', name: 'tenant_admin' } },
      ]);
      prisma.iamMembership.findFirst.mockResolvedValue({
        id: 'membership-a-1',
        subjectId: 'user-client-admin-a',
        organizationId: ORG_A_ID,
        status: 'active',
        organization: { id: ORG_A_ID, isActive: true, externalId: TENANT_A_ID },
      });

      await authenticateAdminRequest(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.iamAdminAuthorized).toBe(true);
      expect(req.iamAdminScope).toEqual({
        type: 'organization',
        organizationId: ORG_A_ID,
        tenantId: TENANT_A_ID,
      });
    });

    it('rejects client admin if user has no active organization membership', async () => {
      const token = await makeOidcToken({
        sub: 'user-client-admin-unbound',
        roles: ['tenant-admin'],
        iam_admin: true,
      });

      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = {};
      const next = vi.fn();

      prisma.oAuthClient.findFirst.mockResolvedValue({
        id: 'client-portal-id',
        clientId: 'iam_admin_portal',
        targetAudience: 'http://localhost:3001/admin-api',
        iamOrganizationId: null,
      });
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-client-admin-unbound',
        isActive: true,
        tenantId: null,
      });
      prisma.userApplicationRole.findMany.mockResolvedValue([
        { role: { slug: 'tenant-admin', name: 'tenant_admin' } },
      ]);
      prisma.iamMembership.findFirst.mockResolvedValue(null);

      await authenticateAdminRequest(req, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err).toBeDefined();
      expect(err.statusCode).toBe(403);
    });
  });

  describe('2. Controller scoping: oauth-clients isolation', () => {
    let reqOrgA, res, next;

    beforeEach(() => {
      reqOrgA = {
        headers: {},
        params: {},
        query: {},
        body: {},
        iamAdminAuthorized: true,
        iamAdminScope: {
          type: 'organization',
          organizationId: ORG_A_ID,
          tenantId: TENANT_A_ID,
        },
      };
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      next = vi.fn();
    });

    it('listClients scopes query strictly to Org A', async () => {
      prisma.oAuthClient.findMany.mockResolvedValue([]);

      await listClients(reqOrgA, res, next);

      expect(prisma.oAuthClient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ iamOrganizationId: ORG_A_ID }, { tenantId: TENANT_A_ID }],
          }),
        })
      );
    });

    it('getClient for an Org B client returns 404/403 to Org A admin', async () => {
      reqOrgA.params.id = 'client-b-id';
      prisma.oAuthClient.findFirst.mockResolvedValue(null);
      prisma.oAuthClient.findUnique.mockResolvedValue({
        id: 'client-b-id',
        iamOrganizationId: ORG_B_ID,
        tenantId: TENANT_B_ID,
      });

      await getClient(reqOrgA, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect([403, 404]).toContain(err.statusCode);
    });

    it('createClient rejects client_credentials grant for client admin', async () => {
      reqOrgA.body = {
        name: 'M2M Integration',
        grantTypes: ['client_credentials'],
        targetAudience: 'http://localhost:3001/api',
      };

      await createClient(reqOrgA, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
    });

    it('createClient rejects iam:admin or api_key scopes for client admin', async () => {
      reqOrgA.body = {
        name: 'Portal Client',
        scope: 'openid profile iam:admin',
        targetAudience: 'http://localhost:3001/api',
      };

      await createClient(reqOrgA, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
    });

    it('createClient rejects non-HTTPS redirect URI in production or external', async () => {
      reqOrgA.body = {
        name: 'Portal App',
        redirectUris: ['http://external.example.com/callback'],
        targetAudience: 'http://localhost:3001/api',
      };

      await createClient(reqOrgA, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(400);
    });

    it('createClient forces Org A organizationId and tenantId', async () => {
      reqOrgA.body = {
        name: 'Department Portal',
        redirectUris: ['http://localhost:5173/auth/callback'],
        targetAudience: 'http://localhost:3001/api',
        iamOrganizationId: ORG_B_ID,
        tenantId: TENANT_B_ID,
      };
      prisma.iamOrganization.findUnique.mockResolvedValue({
        id: ORG_A_ID,
        isActive: true,
        externalSystem: 'iacms',
        externalId: TENANT_A_ID,
      });
      prisma.oAuthClient.findMany.mockResolvedValue([
        { targetAudience: 'http://localhost:3001/api' },
      ]);
      prisma.oAuthClient.create.mockImplementation(async ({ data }) => ({ id: 'c-new', ...data }));

      await createClient(reqOrgA, res, next);

      expect(prisma.oAuthClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            iamOrganizationId: ORG_A_ID,
            tenantId: TENANT_A_ID,
          }),
        })
      );
    });
  });

  describe('3. Controller scoping: oauth-providers read-only for client admin', () => {
    let reqOrgA, res, next;

    beforeEach(() => {
      reqOrgA = {
        headers: {},
        params: {},
        query: {},
        body: {},
        iamAdminAuthorized: true,
        iamAdminScope: {
          type: 'organization',
          organizationId: ORG_A_ID,
          tenantId: TENANT_A_ID,
        },
      };
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      next = vi.fn();
    });

    it('allows client admin to list providers (read-only)', async () => {
      prisma.oAuthProvider.findMany.mockResolvedValue([]);

      await listProviders(reqOrgA, res, next);

      expect(res.json).toHaveBeenCalled();
    });

    it('blocks client admin from createProvider with 403', async () => {
      reqOrgA.body = {
        provider: 'google',
        clientId: 'test-client',
        clientSecret: 'secret123',
      };

      await createProvider(reqOrgA, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
    });

    it('blocks client admin from updateProvider with 403', async () => {
      reqOrgA.params.id = 'provider-1';
      reqOrgA.body = { clientId: 'updated-client' };

      await updateProvider(reqOrgA, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
    });

    it('blocks client admin from deleteProvider with 403', async () => {
      reqOrgA.params.id = 'provider-1';

      await deleteProvider(reqOrgA, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
    });
  });

  describe('4. Controller scoping: iam-organizations isolation', () => {
    let reqOrgA, res, next;

    beforeEach(() => {
      reqOrgA = {
        headers: {},
        params: {},
        query: {},
        body: {},
        iamAdminAuthorized: true,
        iamAdminScope: {
          type: 'organization',
          organizationId: ORG_A_ID,
          tenantId: TENANT_A_ID,
        },
      };
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      next = vi.fn();
    });

    it('listIamOrganizations scopes to Org A only', async () => {
      prisma.iamOrganization.findMany.mockResolvedValue([]);

      await listIamOrganizations(reqOrgA, res, next);

      expect(prisma.iamOrganization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORG_A_ID },
        })
      );
    });

    it('createIamOrganization blocks client admin with 403', async () => {
      reqOrgA.body = { name: 'New Sub Agency', slug: 'new-sub-agency' };

      await createIamOrganization(reqOrgA, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
    });

    it('addIamOrganizationMember blocks client admin from managing Org B with 403', async () => {
      reqOrgA.params.organizationId = ORG_B_ID;
      reqOrgA.body = { subjectId: 'user-b-uuid', status: 'active' };

      await addIamOrganizationMember(reqOrgA, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
    });
  });

  describe('5. Controller scoping: role and api-key isolation', () => {
    let reqOrgA, res, next;

    beforeEach(() => {
      reqOrgA = {
        headers: {},
        params: {},
        query: {},
        body: {},
        iamAdminAuthorized: true,
        iamAdminScope: {
          type: 'organization',
          organizationId: ORG_A_ID,
          tenantId: TENANT_A_ID,
        },
      };
      res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      next = vi.fn();
    });

    it('getRoles scopes to Org A tenant and excludes platform permissions', async () => {
      prisma.role.findMany.mockResolvedValue([]);

      await getRoles(reqOrgA, res, next);

      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ tenantId: null }, { tenantId: TENANT_A_ID }],
          }),
        })
      );
    });

    it('createRole forces Org A tenantId and rejects isSystemRole', async () => {
      reqOrgA.body = {
        name: 'Case Worker',
        tenantId: TENANT_B_ID,
        isSystemRole: true,
      };
      prisma.role.findUnique.mockResolvedValue(null);
      prisma.role.create.mockImplementation(async ({ data }) => ({ id: 'role-new', ...data }));

      await createRole(reqOrgA, res, next);

      expect(prisma.role.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_A_ID,
            isSystemRole: false,
          }),
        })
      );
    });

    it('listApiKeys scopes strictly to Org A tenantId', async () => {
      prisma.apiKey.findMany.mockResolvedValue([]);

      await listApiKeys(reqOrgA, res, next);

      expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT_A_ID,
          }),
        })
      );
    });

    it('revokeApiKey on Org B key blocks Org A client admin with 403 or 404', async () => {
      reqOrgA.params.id = 'key-b-id';
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'key-b-id',
        tenantId: TENANT_B_ID,
      });

      await revokeApiKey(reqOrgA, res, next);

      expect(next).toHaveBeenCalled();
      const err = next.mock.calls[0][0];
      expect([403, 404]).toContain(err.statusCode);
    });
  });
});
