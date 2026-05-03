/**
 * IACMS Database Seed Script
 * Creates initial data for testing:
 * - 1 test tenant (TEST-ORG) with registered-by registrar user
 * - Roles: system_admin (platform), tenant_admin (org owner), case_manager, viewer
 * - Permissions including platform:manage_tenants for system administrators only
 * - Test users + published workflow
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Fixed UUIDs for consistency
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_USER_ID = '22222222-2222-2222-2222-222222222222';
const SYSTEM_ADMIN_USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
const CASE_MANAGER_USER_ID = '33333333-3333-3333-3333-333333333333';
const VIEWER_USER_ID = '44444444-4444-4444-4444-444444444444';
const TENANT_ADMIN_ROLE_ID = '55555555-5555-5555-5555-555555555555';
const SYSTEM_ADMIN_ROLE_ID = '99999999-9999-9999-9999-999999999991';
const CASE_MANAGER_ROLE_ID = '66666666-6666-6666-6666-666666666666';
const VIEWER_ROLE_ID = '77777777-7777-7777-7777-777777777777';
const WORKFLOW_ID = '88888888-8888-8888-8888-888888888888';

// Permissions
const permissions = [
  // Cases
  { resource: 'cases', action: 'create', description: 'Create new cases' },
  { resource: 'cases', action: 'read', description: 'View cases' },
  { resource: 'cases', action: 'update', description: 'Update cases' },
  { resource: 'cases', action: 'delete', description: 'Delete cases' },
  { resource: 'cases', action: 'assign', description: 'Assign cases to users' },
  { resource: 'cases', action: 'close', description: 'Close cases' },
  // Users
  { resource: 'users', action: 'create', description: 'Create users' },
  { resource: 'users', action: 'read', description: 'View users' },
  { resource: 'users', action: 'update', description: 'Update users' },
  { resource: 'users', action: 'delete', description: 'Delete users' },
  // Roles
  { resource: 'roles', action: 'create', description: 'Create roles' },
  { resource: 'roles', action: 'read', description: 'View roles' },
  { resource: 'roles', action: 'update', description: 'Update roles' },
  { resource: 'roles', action: 'delete', description: 'Delete roles' },
  { resource: 'roles', action: 'assign', description: 'Assign roles to users' },
  // Workflows
  { resource: 'workflows', action: 'create', description: 'Create workflows' },
  { resource: 'workflows', action: 'read', description: 'View workflows' },
  { resource: 'workflows', action: 'update', description: 'Update workflows' },
  { resource: 'workflows', action: 'delete', description: 'Delete workflows' },
  // Audit
  { resource: 'audit', action: 'read', description: 'View audit logs' },
  // Tenants
  { resource: 'tenants', action: 'read', description: 'View tenants' },
  { resource: 'tenants', action: 'update', description: 'Update tenant settings' },
  // Platform (system administrators only)
  { resource: 'platform', action: 'manage_tenants', description: 'Register organizations / platform operations' },
];

const allPermissionKeys = permissions.map((p) => `${p.resource}:${p.action}`);
const tenantAdminPermissionKeys = permissions
  .filter((p) => p.resource !== 'platform')
  .map((p) => `${p.resource}:${p.action}`);

// Role permissions mapping
const rolePermissions = {
  system_admin: allPermissionKeys,
  tenant_admin: tenantAdminPermissionKeys,
  case_manager: [
    'cases:create', 'cases:read', 'cases:update', 'cases:assign', 'cases:close',
    'users:read',
    'workflows:read',
    'audit:read',
    'tenants:read',
  ],
  viewer: [
    'cases:read',
    'users:read',
    'workflows:read',
    'tenants:read',
  ],
};

async function main() {
  console.log('🌱 Starting database seed...\n');

  // 1. Create tenant
  console.log('Creating test tenant...');
  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: {},
    create: {
      id: TENANT_ID,
      name: 'Test Organization',
      code: 'TEST-ORG',
      description: 'Test organization for development',
      config: {
        timezone: 'UTC',
        dateFormat: 'YYYY-MM-DD',
        caseNumberPrefix: 'TEST',
      },
      isActive: true,
      registeredByUserId: null,
    },
  });
  console.log(`✅ Tenant created: ${tenant.name} (${tenant.code})\n`);

  // 2. Create permissions
  console.log('Creating permissions...');
  const createdPermissions = [];
  for (const perm of permissions) {
    const permission = await prisma.permission.upsert({
      where: {
        resource_action: { resource: perm.resource, action: perm.action },
      },
      update: {},
      create: perm,
    });
    createdPermissions.push(permission);
  }
  console.log(`✅ Created ${createdPermissions.length} permissions\n`);

  // 3. Create roles
  console.log('Creating roles...');
  const tenantAdminRole = await prisma.role.upsert({
    where: { id: TENANT_ADMIN_ROLE_ID },
    update: {
      name: 'tenant_admin',
      description: 'Tenant administrator — workflows, roles, users within one organization',
    },
    create: {
      id: TENANT_ADMIN_ROLE_ID,
      tenantId: null,
      name: 'tenant_admin',
      description: 'Tenant administrator — workflows, roles, users within one organization',
      isSystemRole: true,
      isActive: true,
    },
  });

  const systemAdminRole = await prisma.role.upsert({
    where: { id: SYSTEM_ADMIN_ROLE_ID },
    update: {},
    create: {
      id: SYSTEM_ADMIN_ROLE_ID,
      tenantId: null,
      name: 'system_admin',
      description: 'Platform operator — may register tenants and assign system_admin',
      isSystemRole: true,
      isActive: true,
    },
  });

  const caseManagerRole = await prisma.role.upsert({
    where: { id: CASE_MANAGER_ROLE_ID },
    update: {},
    create: {
      id: CASE_MANAGER_ROLE_ID,
      tenantId: null, // System-wide role
      name: 'case_manager',
      description: 'Can manage cases and assignments',
      isSystemRole: true,
      isActive: true,
    },
  });

  const viewerRole = await prisma.role.upsert({
    where: { id: VIEWER_ROLE_ID },
    update: {},
    create: {
      id: VIEWER_ROLE_ID,
      tenantId: null, // System-wide role
      name: 'viewer',
      description: 'Read-only access to cases',
      isSystemRole: true,
      isActive: true,
    },
  });
  console.log(`✅ Created roles: tenant_admin, system_admin, case_manager, viewer\n`);

  // 4. Assign permissions to roles
  console.log('Assigning permissions to roles...');
  
  // Helper function to assign permissions
  async function assignPermissionsToRole(roleId, permissionKeys) {
    for (const key of permissionKeys) {
      const [resource, action] = key.split(':');
      const permission = createdPermissions.find(p => p.resource === resource && p.action === action);
      if (permission) {
        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: { roleId, permissionId: permission.id },
          },
          update: {},
          create: {
            roleId,
            permissionId: permission.id,
          },
        });
      }
    }
  }

  await assignPermissionsToRole(TENANT_ADMIN_ROLE_ID, rolePermissions.tenant_admin);
  await assignPermissionsToRole(SYSTEM_ADMIN_ROLE_ID, rolePermissions.system_admin);
  await assignPermissionsToRole(CASE_MANAGER_ROLE_ID, rolePermissions.case_manager);
  await assignPermissionsToRole(VIEWER_ROLE_ID, rolePermissions.viewer);
  console.log(`✅ Permissions assigned to roles\n`);

  // 5. Create users
  console.log('Creating test users...');
  const passwordHash = await bcrypt.hash('password123', 10);

  const adminUser = await prisma.user.upsert({
    where: { id: ADMIN_USER_ID },
    update: {},
    create: {
      id: ADMIN_USER_ID,
      tenantId: TENANT_ID,
      email: 'admin@test-org.com',
      username: 'admin',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      isActive: true,
      isEmailVerified: true,
    },
  });

  const caseManagerUser = await prisma.user.upsert({
    where: { id: CASE_MANAGER_USER_ID },
    update: {},
    create: {
      id: CASE_MANAGER_USER_ID,
      tenantId: TENANT_ID,
      email: 'manager@test-org.com',
      username: 'manager',
      passwordHash,
      firstName: 'Case',
      lastName: 'Manager',
      isActive: true,
      isEmailVerified: true,
    },
  });

  const viewerUser = await prisma.user.upsert({
    where: { id: VIEWER_USER_ID },
    update: {},
    create: {
      id: VIEWER_USER_ID,
      tenantId: TENANT_ID,
      email: 'viewer@test-org.com',
      username: 'viewer',
      passwordHash,
      firstName: 'Viewer',
      lastName: 'User',
      isActive: true,
      isEmailVerified: true,
    },
  });
  console.log(`✅ Created users: admin, manager, viewer\n`);

  // 6. Assign roles to users
  console.log('Assigning roles to users...');
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: ADMIN_USER_ID, roleId: TENANT_ADMIN_ROLE_ID } },
    update: {},
    create: {
      userId: ADMIN_USER_ID,
      roleId: TENANT_ADMIN_ROLE_ID,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: CASE_MANAGER_USER_ID, roleId: CASE_MANAGER_ROLE_ID } },
    update: {},
    create: {
      userId: CASE_MANAGER_USER_ID,
      roleId: CASE_MANAGER_ROLE_ID,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: VIEWER_USER_ID, roleId: VIEWER_ROLE_ID } },
    update: {},
    create: {
      userId: VIEWER_USER_ID,
      roleId: VIEWER_ROLE_ID,
    },
  });
  console.log(`✅ Roles assigned to users\n`);

  console.log('Creating platform system administrator user...');
  const systemAdminUser = await prisma.user.upsert({
    where: { id: SYSTEM_ADMIN_USER_ID },
    update: {},
    create: {
      id: SYSTEM_ADMIN_USER_ID,
      tenantId: TENANT_ID,
      email: 'system@test-org.com',
      username: 'systemadmin',
      passwordHash,
      firstName: 'Platform',
      lastName: 'Administrator',
      isActive: true,
      isEmailVerified: true,
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: SYSTEM_ADMIN_USER_ID, roleId: SYSTEM_ADMIN_ROLE_ID } },
    update: {},
    create: {
      userId: SYSTEM_ADMIN_USER_ID,
      roleId: SYSTEM_ADMIN_ROLE_ID,
    },
  });
  console.log(`✅ System admin user: ${systemAdminUser.email}\n`);

  await prisma.tenant.update({
    where: { id: TENANT_ID },
    data: { registeredByUserId: ADMIN_USER_ID },
  });
  console.log('✅ Linked tenant registrar (registeredByUserId)\n');

  // 7. Published workflow with steps + transitions (dynamic engine shape)
  console.log('Creating default published workflow...');
  await prisma.workflowTransition.deleteMany({ where: { workflowId: WORKFLOW_ID } });
  await prisma.workflowStep.deleteMany({ where: { workflowId: WORKFLOW_ID } });

  await prisma.workflow.upsert({
    where: { id: WORKFLOW_ID },
    update: {
      tenantId: TENANT_ID,
      key: 'standard',
      name: 'Standard Case Workflow',
      description: 'Default workflow for case management',
      definition: {},
      version: 1,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      isActive: true,
      isDefault: true,
      createdBy: ADMIN_USER_ID,
    },
    create: {
      id: WORKFLOW_ID,
      tenantId: TENANT_ID,
      key: 'standard',
      name: 'Standard Case Workflow',
      description: 'Default workflow for case management',
      definition: {},
      version: 1,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      isActive: true,
      isDefault: true,
      createdBy: ADMIN_USER_ID,
    },
  });

  const stepDraft = await prisma.workflowStep.create({
    data: {
      workflowId: WORKFLOW_ID,
      key: 'draft',
      name: 'Draft',
      description: 'Initial intake',
      isInitial: true,
      isFinal: false,
      position: 0,
      allowedRoleIds: [],
    },
  });

  const stepReview = await prisma.workflowStep.create({
    data: {
      workflowId: WORKFLOW_ID,
      key: 'review',
      name: 'Under review',
      isInitial: false,
      isFinal: false,
      position: 1,
      allowedRoleIds: [],
    },
  });

  const stepClosed = await prisma.workflowStep.create({
    data: {
      workflowId: WORKFLOW_ID,
      key: 'closed',
      name: 'Closed',
      isInitial: false,
      isFinal: true,
      position: 2,
      allowedRoleIds: [],
    },
  });

  await prisma.workflowTransition.createMany({
    data: [
      {
        workflowId: WORKFLOW_ID,
        fromStepId: stepDraft.id,
        toStepId: stepReview.id,
        name: 'submit_review',
        description: 'Submit for review',
        allowedRoleIds: [],
        requiresComment: false,
      },
      {
        workflowId: WORKFLOW_ID,
        fromStepId: stepReview.id,
        toStepId: stepClosed.id,
        name: 'approve_close',
        description: 'Approve and close',
        allowedRoleIds: [],
        requiresComment: false,
      },
    ],
  });

  console.log('✅ Default workflow published with steps and transitions\n');

  // Summary
  console.log('═'.repeat(50));
  console.log('🎉 Database seeded successfully!\n');
  console.log('Test Credentials:');
  console.log('─'.repeat(50));
  console.log('Tenant Code: TEST-ORG\n');
  console.log('Tenant administrator (registrar / org admin):');
  console.log('  Email: admin@test-org.com');
  console.log('  Password: password123');
  console.log('  Role: tenant_admin (full permissions within TEST-ORG)\n');
  console.log('Platform system administrator (seed demo — assign system_admin sparingly):');
  console.log('  Email: system@test-org.com');
  console.log('  Password: password123');
  console.log('  Role: system_admin (includes platform:manage_tenants)\n');
  console.log('Case Manager User:');
  console.log('  Email: manager@test-org.com');
  console.log('  Password: password123');
  console.log('  Role: case_manager\n');
  console.log('Viewer User:');
  console.log('  Email: viewer@test-org.com');
  console.log('  Password: password123');
  console.log('  Role: viewer (read-only)\n');
  console.log('═'.repeat(50));
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
