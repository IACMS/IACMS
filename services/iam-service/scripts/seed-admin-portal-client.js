/**
 * seed-admin-portal-client.js
 * Seeds the Admin Console OAuth client ('iam_admin_portal'),
 * the 'iam-admin' and 'system_admin' system roles, and creates/configures both:
 * 1. Superadmin (platform.admin@iacms.gov.example / password123)
 * 2. Tenant Admin (admin@dcs-01.gov.example / password123)
 */

import '../src/env.js';
import prisma from '../src/config/database.js';
import bcrypt from 'bcryptjs';
import Logger from '#iam/iamLogger.js';

const logger = new Logger('seed-admin-portal-client');

export async function seedAdminPortalClient() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed scripts cannot run in production environments.');
  }

  logger.info('Starting seed for Admin Portal OAuth client and seed credentials...');

  // 1. Ensure 'iam-admin' role exists
  let iamAdminRole = await prisma.role.findFirst({
    where: {
      OR: [
        { slug: 'iam-admin' },
        { name: 'iam-admin' },
      ],
    },
  });

  if (!iamAdminRole) {
    iamAdminRole = await prisma.role.create({
      data: {
        name: 'IAM Administrator',
        slug: 'iam-admin',
        description: 'Central IAM Administration Console Superadmin',
        isSystemRole: true,
        isActive: true,
      },
    });
    logger.info('Created iam-admin role', { id: iamAdminRole.id });
  } else if (iamAdminRole.slug !== 'iam-admin') {
    iamAdminRole = await prisma.role.update({
      where: { id: iamAdminRole.id },
      data: { slug: 'iam-admin' },
    });
    logger.info('Updated role slug to iam-admin', { id: iamAdminRole.id });
  }

  // 2. Ensure system_admin role exists with slug 'system-admin'
  let systemAdminRole = await prisma.role.findFirst({
    where: {
      OR: [
        { name: 'system_admin' },
        { slug: 'system-admin' },
      ],
    },
  });

  if (!systemAdminRole) {
    systemAdminRole = await prisma.role.create({
      data: {
        name: 'system_admin',
        slug: 'system-admin',
        description: 'Platform Super Administrator',
        isSystemRole: true,
        isActive: true,
      },
    });
    logger.info('Created system_admin role', { id: systemAdminRole.id });
  } else if (systemAdminRole.slug !== 'system-admin') {
    systemAdminRole = await prisma.role.update({
      where: { id: systemAdminRole.id },
      data: { slug: 'system-admin' },
    });
    logger.info('Updated system_admin role slug to system-admin');
  }

  // 3. Ensure tenant_admin role exists with slug 'tenant-admin'
  let tenantAdminRole = await prisma.role.findFirst({
    where: {
      OR: [
        { name: 'tenant_admin' },
        { slug: 'tenant-admin' },
      ],
    },
  });

  if (!tenantAdminRole) {
    tenantAdminRole = await prisma.role.create({
      data: {
        name: 'tenant_admin',
        slug: 'tenant-admin',
        description: 'Tenant Administrator',
        isSystemRole: true,
        isActive: true,
      },
    });
    logger.info('Created tenant_admin role', { id: tenantAdminRole.id });
  } else if (tenantAdminRole.slug !== 'tenant-admin') {
    tenantAdminRole = await prisma.role.update({
      where: { id: tenantAdminRole.id },
      data: { slug: 'tenant-admin' },
    });
  }

  // 4. Register or update the Admin Console public OAuth client
  const adminAudience = process.env.IAM_ADMIN_AUDIENCE || 'http://localhost:3001/admin-api';
  const redirectUris = [
    'http://localhost:5174/auth/callback',
    'http://127.0.0.1:5174/auth/callback',
    'http://localhost:5173/auth/callback',
    'http://127.0.0.1:5173/auth/callback',
    'http://localhost:3000/auth/callback',
  ];

  const adminClient = await prisma.oAuthClient.upsert({
    where: { clientId: 'iam_admin_portal' },
    create: {
      clientId: 'iam_admin_portal',
      name: 'IAM Administration Console',
      redirectUris,
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      scope: 'openid profile email iam:admin',
      tokenEndpointAuthMethod: 'none',
      targetAudience: adminAudience,
      isActive: true,
    },
    update: {
      name: 'IAM Administration Console',
      redirectUris,
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      scope: 'openid profile email iam:admin',
      tokenEndpointAuthMethod: 'none',
      targetAudience: adminAudience,
      isActive: true,
    },
  });
  logger.info('Upserted iam_admin_portal OAuthClient', { id: adminClient.id });

  // 4b. Register IACMS Case Management as an external OAuth2 client application
  const iacmsClient = await prisma.oAuthClient.upsert({
    where: { clientId: 'iacms_case_management' },
    create: {
      clientId: 'iacms_case_management',
      name: 'IACMS Case Management System',
      redirectUris: [
        'http://localhost:3000/auth/callback',
        'https://iacms.example.gov/auth/callback',
      ],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      scope: 'openid profile email cases:read cases:write files:upload',
      tokenEndpointAuthMethod: 'client_secret_basic',
      isActive: true,
    },
    update: {
      name: 'IACMS Case Management System',
      redirectUris: [
        'http://localhost:3000/auth/callback',
        'https://iacms.example.gov/auth/callback',
      ],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      scope: 'openid profile email cases:read cases:write files:upload',
      tokenEndpointAuthMethod: 'client_secret_basic',
      isActive: true,
    },
  });
  logger.info('Upserted iacms_case_management OAuthClient', { id: iacmsClient.id });

  // 5. Seed Superadmin User (platform.admin@iacms.gov.example)
  let adminTenant = await prisma.tenant.findUnique({ where: { code: 'ADMIN' } });
  if (!adminTenant) {
    adminTenant = await prisma.tenant.create({
      data: {
        code: 'ADMIN',
        name: 'Platform Administration',
        description: 'Platform administration tenant',
        isActive: true,
      },
    });
  }

  const seedAdminPassword = process.env.SEED_ADMIN_PASSWORD || process.env.SEED_DEFAULT_PASSWORD || 'password123';
  const seedTenantPassword = process.env.SEED_TENANT_ADMIN_PASSWORD || seedAdminPassword;
  const adminPasswordHash = await bcrypt.hash(seedAdminPassword, 10);
  const tenantPasswordHash = await bcrypt.hash(seedTenantPassword, 10);

  let adminUser = await prisma.user.findFirst({
    where: { email: 'platform.admin@iacms.gov.example' },
  });

  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        tenantId: adminTenant.id,
        email: 'platform.admin@iacms.gov.example',
        username: 'platform.admin',
        passwordHash: adminPasswordHash,
        firstName: 'Platform',
        lastName: 'Admin',
        isEmailVerified: true,
        isActive: true,
        mustChangePassword: true,
      },
    });
    logger.info('Created Superadmin user: platform.admin@iacms.gov.example');
  } else {
    // Never reset an existing admin's password
    logger.info('Superadmin user already exists; preserving existing password and credentials');
    await prisma.user.update({
      where: { id: adminUser.id },
      data: { isActive: true },
    });
  }

  // Ensure system_admin role is attached to Superadmin
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: systemAdminRole.id,
      },
    },
    create: {
      userId: adminUser.id,
      roleId: systemAdminRole.id,
    },
    update: {},
  });

  // Assign the iam-admin role for iam_admin_portal to the platform admin user
  await prisma.userApplicationRole.upsert({
    where: {
      userId_oauthClientId_roleId: {
        userId: adminUser.id,
        oauthClientId: adminClient.id,
        roleId: iamAdminRole.id,
      },
    },
    create: {
      userId: adminUser.id,
      oauthClientId: adminClient.id,
      roleId: iamAdminRole.id,
    },
    update: {
      assignedAt: new Date(),
      expiresAt: null,
    },
  });

  // 6. Seed Tenant Admin User (admin@dcs-01.gov.example / password123)
  let dcsTenant = await prisma.tenant.findUnique({ where: { code: 'DCS-01' } });
  if (!dcsTenant) {
    dcsTenant = await prisma.tenant.create({
      data: {
        code: 'DCS-01',
        name: 'Department of Children Services — District 01',
        description: 'Child protection intake, assessment, and case coordination.',
        isActive: true,
      },
    });
  }

  let dcsUser = await prisma.user.findFirst({
    where: { email: 'admin@dcs-01.gov.example' },
  });

  if (!dcsUser) {
    dcsUser = await prisma.user.create({
      data: {
        tenantId: dcsTenant.id,
        email: 'admin@dcs-01.gov.example',
        username: 'dcs01_admin',
        passwordHash: tenantPasswordHash,
        firstName: 'Dana',
        lastName: 'Reed',
        isEmailVerified: true,
        isActive: true,
        mustChangePassword: true,
      },
    });
    logger.info('Created Tenant Admin user: admin@dcs-01.gov.example');
  } else {
    // Never reset an existing tenant admin's password
    logger.info('Tenant Admin user already exists; preserving existing password and credentials');
    await prisma.user.update({
      where: { id: dcsUser.id },
      data: { isActive: true },
    });
  }

  // Ensure tenant_admin role is attached to Tenant Admin
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: dcsUser.id,
        roleId: tenantAdminRole.id,
      },
    },
    create: {
      userId: dcsUser.id,
      roleId: tenantAdminRole.id,
    },
    update: {},
  });

  logger.info('================================================================');
  logger.info('Admin portal seed completed successfully!');
  logger.info('Seed Credentials:');
  logger.info('  1. Superadmin (ADMIN):       platform.admin@iacms.gov.example / password123');
  logger.info('  2. Tenant Admin (DCS-01):    admin@dcs-01.gov.example / password123');
  logger.info('================================================================');
}

if (process.argv[1]?.endsWith('seed-admin-portal-client.js')) {
  seedAdminPortalClient()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
