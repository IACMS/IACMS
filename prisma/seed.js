/**
 * IACMS Database Seed Script
 * Creates initial data for testing:
 * - 1 test tenant (TEST-ORG)
 * - 3 system roles: Admin, Case Manager, Viewer
 * - Core permissions for cases, workflows, users
 * - 3 test users (one per role)
 * - 1 default workflow
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fixed UUIDs for consistency
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_USER_ID = '22222222-2222-2222-2222-222222222222';
const CASE_MANAGER_USER_ID = '33333333-3333-3333-3333-333333333333';
const VIEWER_USER_ID = '44444444-4444-4444-4444-444444444444';
const ADMIN_ROLE_ID = '55555555-5555-5555-5555-555555555555';
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
];

// Role permissions mapping
const rolePermissions = {
  admin: permissions.map(p => `${p.resource}:${p.action}`), // All permissions
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
  const adminRole = await prisma.role.upsert({
    where: { id: ADMIN_ROLE_ID },
    update: {},
    create: {
      id: ADMIN_ROLE_ID,
      tenantId: null, // System-wide role
      name: 'admin',
      description: 'Full system administrator with all permissions',
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
  console.log(`✅ Created roles: admin, case_manager, viewer\n`);

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

  await assignPermissionsToRole(ADMIN_ROLE_ID, rolePermissions.admin);
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
    where: { userId_roleId: { userId: ADMIN_USER_ID, roleId: ADMIN_ROLE_ID } },
    update: {},
    create: {
      userId: ADMIN_USER_ID,
      roleId: ADMIN_ROLE_ID,
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

  // 7. Published workflow matching shared/contracts/__fixtures__/workflow-full.example.json
  console.log('Creating published workflow standard-case…');
  await prisma.workflowTransition.deleteMany({ where: { workflowId: WORKFLOW_ID } }).catch(() => {});
  await prisma.workflowStep.deleteMany({ where: { workflowId: WORKFLOW_ID } }).catch(() => {});
  await prisma.workflow.deleteMany({ where: { id: WORKFLOW_ID } }).catch(() => {});

  const wfFixture = JSON.parse(
    readFileSync(
      path.join(__dirname, '..', 'shared', 'contracts', '__fixtures__', 'workflow-full.example.json'),
      'utf8',
    ),
  );

  await prisma.workflow.create({
    data: {
      id: WORKFLOW_ID,
      tenantId: TENANT_ID,
      key: wfFixture.key,
      name: 'Standard Case Flow',
      description: 'Seed workflow (Draft → Review → Approval → Closed)',
      version: wfFixture.version,
      status: 'PUBLISHED',
      publishedAt: new Date(wfFixture.publishedAt),
      definition: wfFixture,
      isActive: true,
      isDefault: true,
      createdBy: ADMIN_USER_ID,
      steps: {
        create: wfFixture.steps.map(s => ({
          id: s.id,
          key: s.key,
          name: s.name,
          description: s.description,
          isInitial: s.isInitial,
          isFinal: s.isFinal,
          position: s.position,
          allowedRoleIds: s.allowedRoleIds ?? [],
        })),
      },
    },
  });

  await prisma.workflowTransition.createMany({
    data: wfFixture.transitions.map(t => ({
      id: t.id,
      workflowId: WORKFLOW_ID,
      name: t.name,
      description: t.description,
      fromStepId: t.fromStepId,
      toStepId: t.toStepId,
      allowedRoleIds: t.allowedRoleIds ?? [],
      requiresComment: t.requiresComment ?? false,
      requiresAttachment: false,
    })),
  });

  console.log(`✅ Workflow ${wfFixture.key} v${wfFixture.version} seeded (PUBLISHED)\n`);

  // Summary
  console.log('═'.repeat(50));
  console.log('🎉 Database seeded successfully!\n');
  console.log('Test Credentials:');
  console.log('─'.repeat(50));
  console.log('Tenant Code: TEST-ORG\n');
  console.log('Admin User:');
  console.log('  Email: admin@test-org.com');
  console.log('  Password: password123');
  console.log('  Role: admin (all permissions)\n');
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
