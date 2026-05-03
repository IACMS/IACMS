/**
 * IACMS Database Seed Script
 * Creates initial data for testing:
 * - 4 agencies (tenants): TEST-ORG, PARTNER-AGENCY, COASTAL-HHS, MIDSTATE-DSS — each with a workflow + cases
 * - 3 system roles: Admin, Case Manager, Viewer
 * - Core permissions for cases, workflows, users
 * - Test users per agency (admins/managers where needed)
 * - One pending referral (TEST-ORG → PARTNER-AGENCY) on a TEST-ORG case
 *
 * Env: merges `IACMS/.env` into the process (shell wins). If `DATABASE_URL` is unset,
 * it is built from `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load key=value pairs from repo root `.env` when keys are not already set (no dotenv dependency). */
function loadEnvFromRootFile() {
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFromRootFile();

/** Match service defaults when `.env` only sets DB_* keys. */
function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const name = process.env.DB_NAME || 'iacms';
  const user = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || 'postgres';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}?schema=public`;
}

ensureDatabaseUrl();

const prisma = new PrismaClient();

// Fixed UUIDs for consistency
const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_USER_ID = '22222222-2222-2222-2222-222222222222';
const CASE_MANAGER_USER_ID = '33333333-3333-3333-3333-333333333333';
const VIEWER_USER_ID = '44444444-4444-4444-4444-444444444444';
const ADMIN_ROLE_ID = '55555555-5555-5555-5555-555555555555';
const CASE_MANAGER_ROLE_ID = '66666666-6666-6666-6666-666666666666';
const VIEWER_ROLE_ID = '77777777-7777-7777-7777-777777777777';
const WORKFLOW_ID = '88888888-8888-8888-8888-888888888888';

/** Second agency for inter-tenant referral testing and GET /tenants/validate/:code */
const TENANT_PARTNER_ID = 'a0000001-0001-4001-8001-000000000001';
const PARTNER_ADMIN_USER_ID = 'a0000001-0001-4001-8001-000000000002';
const WORKFLOW_PARTNER_ID = 'a0000001-0001-4001-8001-000000000003';

const CASE_SEED_1 = 'a0000001-0001-4001-8001-000000000011';
const CASE_SEED_2 = 'a0000001-0001-4001-8001-000000000012';
const CASE_SEED_3 = 'a0000001-0001-4001-8001-000000000013';
const CASE_SEED_4 = 'a0000001-0001-4001-8001-000000000014';
const CASE_PARTNER_1 = 'a0000001-0001-4001-8001-000000000015';
const CASE_PARTNER_2 = 'a0000001-0001-4001-8001-000000000016';
const CASE_PARTNER_3 = 'a0000001-0001-4001-8001-000000000017';
const REFERRAL_SEED_1 = 'a0000001-0001-4001-8001-000000000020';

/** Additional demo agencies (each gets workflow + manager user + cases) */
const TENANT_COASTAL_ID = 'b0000002-0001-4001-8001-000000000001';
const USER_COASTAL_MANAGER_ID = 'b0000002-0001-4001-8001-000000000002';
const WORKFLOW_COASTAL_ID = 'b0000002-0001-4001-8001-000000000003';
const CASE_COASTAL_1 = 'b0000002-0001-4001-8001-000000000011';
const CASE_COASTAL_2 = 'b0000002-0001-4001-8001-000000000012';
const CASE_COASTAL_3 = 'b0000002-0001-4001-8001-000000000013';

const TENANT_MIDSTATE_ID = 'c0000002-0001-4001-8001-000000000001';
const USER_MIDSTATE_MANAGER_ID = 'c0000002-0001-4001-8001-000000000002';
const WORKFLOW_MIDSTATE_ID = 'c0000002-0001-4001-8001-000000000003';
const CASE_MIDSTATE_1 = 'c0000002-0001-4001-8001-000000000011';
const CASE_MIDSTATE_2 = 'c0000002-0001-4001-8001-000000000012';
const CASE_MIDSTATE_3 = 'c0000002-0001-4001-8001-000000000013';

const DEFAULT_WORKFLOW_DEFINITION = {
  states: ['open', 'in_progress', 'under_review', 'resolved', 'closed'],
  initialState: 'open',
  transitions: [
    { from: 'open', to: 'in_progress', name: 'Start Work' },
    { from: 'in_progress', to: 'under_review', name: 'Submit for Review' },
    { from: 'under_review', to: 'in_progress', name: 'Return for Changes' },
    { from: 'under_review', to: 'resolved', name: 'Approve' },
    { from: 'resolved', to: 'closed', name: 'Close Case' },
    { from: 'in_progress', to: 'closed', name: 'Cancel Case' },
  ],
};

/**
 * Idempotent case upsert by `caseNumber` (globally unique).
 * @param {object} data
 */
async function upsertCase(data) {
  const { caseNumber, ...rest } = data;
  await prisma.case.upsert({
    where: { caseNumber },
    update: {
      title: rest.title,
      description: rest.description ?? null,
      type: rest.type,
      priority: rest.priority,
      status: rest.status,
      workflowId: rest.workflowId ?? null,
      assignedTo: rest.assignedTo ?? null,
      tenantId: rest.tenantId,
      createdBy: rest.createdBy,
    },
    create: data,
  });
}

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

  const seedAgencies = [
    {
      id: TENANT_ID,
      name: 'Test Organization',
      code: 'TEST-ORG',
      description: 'Primary demo agency — housing, referrals, and admin UI',
      caseNumberPrefix: 'TEST',
    },
    {
      id: TENANT_PARTNER_ID,
      name: 'Partner Agency (Demo)',
      code: 'PARTNER-AGENCY',
      description: 'Partner agency for referrals and validate-tenant flows',
      caseNumberPrefix: 'PARTNER',
    },
    {
      id: TENANT_COASTAL_ID,
      name: 'Coastal Health & Human Services',
      code: 'COASTAL-HHS',
      description: 'Seeded agency — behavioral health and community programs',
      caseNumberPrefix: 'COASTAL',
    },
    {
      id: TENANT_MIDSTATE_ID,
      name: 'Midstate Department of Social Services',
      code: 'MIDSTATE-DSS',
      description: 'Seeded agency — child welfare and family preservation',
      caseNumberPrefix: 'MIDSTATE',
    },
  ];

  console.log('Creating agencies (tenants)...');
  for (const a of seedAgencies) {
    const row = await prisma.tenant.upsert({
      where: { id: a.id },
      update: { name: a.name, description: a.description, config: { timezone: 'UTC', dateFormat: 'YYYY-MM-DD', caseNumberPrefix: a.caseNumberPrefix } },
      create: {
        id: a.id,
        name: a.name,
        code: a.code,
        description: a.description,
        config: {
          timezone: 'UTC',
          dateFormat: 'YYYY-MM-DD',
          caseNumberPrefix: a.caseNumberPrefix,
        },
        isActive: true,
      },
    });
    console.log(`  ✅ ${row.name} (${row.code})`);
  }
  console.log('');

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

  const partnerAdminUser = await prisma.user.upsert({
    where: { id: PARTNER_ADMIN_USER_ID },
    update: {},
    create: {
      id: PARTNER_ADMIN_USER_ID,
      tenantId: TENANT_PARTNER_ID,
      email: 'admin@partner-agency.gov',
      username: 'partner-admin',
      passwordHash,
      firstName: 'Partner',
      lastName: 'Administrator',
      isActive: true,
      isEmailVerified: true,
    },
  });

  const coastalManager = await prisma.user.upsert({
    where: { id: USER_COASTAL_MANAGER_ID },
    update: {},
    create: {
      id: USER_COASTAL_MANAGER_ID,
      tenantId: TENANT_COASTAL_ID,
      email: 'manager@coastal-hhs.demo',
      username: 'coastal-manager',
      passwordHash,
      firstName: 'Jordan',
      lastName: 'Ellis',
      isActive: true,
      isEmailVerified: true,
    },
  });

  const midstateManager = await prisma.user.upsert({
    where: { id: USER_MIDSTATE_MANAGER_ID },
    update: {},
    create: {
      id: USER_MIDSTATE_MANAGER_ID,
      tenantId: TENANT_MIDSTATE_ID,
      email: 'manager@midstate-dss.demo',
      username: 'midstate-manager',
      passwordHash,
      firstName: 'Sam',
      lastName: 'Rivera',
      isActive: true,
      isEmailVerified: true,
    },
  });
  console.log(
    `✅ Created users: admin, manager, viewer on TEST-ORG; partner admin; managers on COASTAL-HHS & MIDSTATE-DSS\n`,
  );

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

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: PARTNER_ADMIN_USER_ID, roleId: CASE_MANAGER_ROLE_ID } },
    update: {},
    create: {
      userId: PARTNER_ADMIN_USER_ID,
      roleId: CASE_MANAGER_ROLE_ID,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: USER_COASTAL_MANAGER_ID, roleId: CASE_MANAGER_ROLE_ID } },
    update: {},
    create: {
      userId: USER_COASTAL_MANAGER_ID,
      roleId: CASE_MANAGER_ROLE_ID,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: USER_MIDSTATE_MANAGER_ID, roleId: CASE_MANAGER_ROLE_ID } },
    update: {},
    create: {
      userId: USER_MIDSTATE_MANAGER_ID,
      roleId: CASE_MANAGER_ROLE_ID,
    },
  });
  console.log(`✅ Roles assigned (partner + coastal + midstate managers = case_manager)\n`);

  // 7. Create default workflow
  console.log('Creating default workflow...');
  const workflow = await prisma.workflow.upsert({
    where: { id: WORKFLOW_ID },
    update: {},
    create: {
      id: WORKFLOW_ID,
      tenantId: TENANT_ID,
      name: 'Standard Case Workflow',
      description: 'Default workflow for case management',
      definition: DEFAULT_WORKFLOW_DEFINITION,
      version: 1,
      isActive: true,
      isDefault: true,
      createdBy: ADMIN_USER_ID,
    },
  });
  console.log(`✅ Default workflow created: ${workflow.name}\n`);

  console.log('Creating partner tenant workflow...');
  const workflowPartner = await prisma.workflow.upsert({
    where: { id: WORKFLOW_PARTNER_ID },
    update: {},
    create: {
      id: WORKFLOW_PARTNER_ID,
      tenantId: TENANT_PARTNER_ID,
      name: 'Partner Standard Workflow',
      description: 'Demo workflow for PARTNER-AGENCY',
      definition: DEFAULT_WORKFLOW_DEFINITION,
      version: 1,
      isActive: true,
      isDefault: true,
      createdBy: PARTNER_ADMIN_USER_ID,
    },
  });
  console.log(`✅ Partner workflow: ${workflowPartner.name}\n`);

  console.log('Creating COASTAL-HHS & MIDSTATE-DSS workflows...');
  const workflowCoastal = await prisma.workflow.upsert({
    where: { id: WORKFLOW_COASTAL_ID },
    update: {},
    create: {
      id: WORKFLOW_COASTAL_ID,
      tenantId: TENANT_COASTAL_ID,
      name: 'Coastal Standard Workflow',
      description: 'Default workflow for Coastal HHS',
      definition: DEFAULT_WORKFLOW_DEFINITION,
      version: 1,
      isActive: true,
      isDefault: true,
      createdBy: USER_COASTAL_MANAGER_ID,
    },
  });
  const workflowMidstate = await prisma.workflow.upsert({
    where: { id: WORKFLOW_MIDSTATE_ID },
    update: {},
    create: {
      id: WORKFLOW_MIDSTATE_ID,
      tenantId: TENANT_MIDSTATE_ID,
      name: 'Midstate Standard Workflow',
      description: 'Default workflow for Midstate DSS',
      definition: DEFAULT_WORKFLOW_DEFINITION,
      version: 1,
      isActive: true,
      isDefault: true,
      createdBy: USER_MIDSTATE_MANAGER_ID,
    },
  });
  console.log(`✅ ${workflowCoastal.name}; ${workflowMidstate.name}\n`);

  console.log('Creating sample cases (TEST-ORG)...');
  await upsertCase({
    id: CASE_SEED_1,
    tenantId: TENANT_ID,
    caseNumber: 'SEED-2024-001',
    title: 'Housing eligibility review — Smith',
    description: 'Initial intake; documents pending from county office.',
    type: 'referral',
    priority: 'high',
    status: 'open',
    workflowId: WORKFLOW_ID,
    assignedTo: CASE_MANAGER_USER_ID,
    createdBy: ADMIN_USER_ID,
  });
  await upsertCase({
    id: CASE_SEED_2,
    tenantId: TENANT_ID,
    caseNumber: 'SEED-2024-002',
    title: 'Inter-agency data request #8821',
    description: 'Medical history release coordination.',
    type: 'internal',
    priority: 'normal',
    status: 'in_progress',
    workflowId: WORKFLOW_ID,
    assignedTo: CASE_MANAGER_USER_ID,
    createdBy: CASE_MANAGER_USER_ID,
  });
  await upsertCase({
    id: CASE_SEED_3,
    tenantId: TENANT_ID,
    caseNumber: 'SEED-2024-003',
    title: 'SLA escalation — Case 48102',
    description: 'Due within 48h; supervisor review required.',
    type: 'enforcement',
    priority: 'urgent',
    status: 'under_review',
    workflowId: WORKFLOW_ID,
    assignedTo: ADMIN_USER_ID,
    createdBy: ADMIN_USER_ID,
  });
  await upsertCase({
    id: CASE_SEED_4,
    tenantId: TENANT_ID,
    caseNumber: 'SEED-2024-004',
    title: 'Routine compliance checklist',
    description: 'Unassigned demo row for filters and assignment UI.',
    type: 'internal',
    priority: 'low',
    status: 'open',
    workflowId: WORKFLOW_ID,
    assignedTo: null,
    createdBy: CASE_MANAGER_USER_ID,
  });
  console.log('✅ 4 cases on TEST-ORG\n');

  console.log('Creating cases for PARTNER-AGENCY (3)...');
  await upsertCase({
    id: CASE_PARTNER_1,
    tenantId: TENANT_PARTNER_ID,
    caseNumber: 'PARTNER-2024-001',
    title: 'Partner agency inbound matter',
    description: 'Local case owned by PARTNER-AGENCY for multi-tenant checks.',
    type: 'internal',
    priority: 'normal',
    status: 'open',
    workflowId: WORKFLOW_PARTNER_ID,
    assignedTo: PARTNER_ADMIN_USER_ID,
    createdBy: PARTNER_ADMIN_USER_ID,
  });
  await upsertCase({
    id: CASE_PARTNER_2,
    tenantId: TENANT_PARTNER_ID,
    caseNumber: 'PARTNER-2024-002',
    title: 'Cross-county data sharing request',
    description: 'Pending partner review; redacted client identifiers.',
    type: 'referral',
    priority: 'high',
    status: 'in_progress',
    workflowId: WORKFLOW_PARTNER_ID,
    assignedTo: PARTNER_ADMIN_USER_ID,
    createdBy: PARTNER_ADMIN_USER_ID,
  });
  await upsertCase({
    id: CASE_PARTNER_3,
    tenantId: TENANT_PARTNER_ID,
    caseNumber: 'PARTNER-2024-003',
    title: 'Quarterly compliance audit follow-up',
    description: 'Documentation due to state liaison.',
    type: 'internal',
    priority: 'normal',
    status: 'under_review',
    workflowId: WORKFLOW_PARTNER_ID,
    assignedTo: null,
    createdBy: PARTNER_ADMIN_USER_ID,
  });
  console.log('✅ 3 cases on PARTNER-AGENCY\n');

  console.log('Creating cases for COASTAL-HHS (3)...');
  await upsertCase({
    id: CASE_COASTAL_1,
    tenantId: TENANT_COASTAL_ID,
    caseNumber: 'COASTAL-2024-001',
    title: 'Behavioral health intake — adolescent program',
    description: 'Initial screening; guardian consent on file.',
    type: 'referral',
    priority: 'high',
    status: 'open',
    workflowId: WORKFLOW_COASTAL_ID,
    assignedTo: USER_COASTAL_MANAGER_ID,
    createdBy: USER_COASTAL_MANAGER_ID,
  });
  await upsertCase({
    id: CASE_COASTAL_2,
    tenantId: TENANT_COASTAL_ID,
    caseNumber: 'COASTAL-2024-002',
    title: 'Community outreach — housing navigation',
    description: 'Follow-up from regional task force.',
    type: 'internal',
    priority: 'normal',
    status: 'in_progress',
    workflowId: WORKFLOW_COASTAL_ID,
    assignedTo: USER_COASTAL_MANAGER_ID,
    createdBy: USER_COASTAL_MANAGER_ID,
  });
  await upsertCase({
    id: CASE_COASTAL_3,
    tenantId: TENANT_COASTAL_ID,
    caseNumber: 'COASTAL-2024-003',
    title: 'Grant reporting — Q3 expenditures',
    description: 'Unassigned backlog item for filters.',
    type: 'internal',
    priority: 'low',
    status: 'open',
    workflowId: WORKFLOW_COASTAL_ID,
    assignedTo: null,
    createdBy: USER_COASTAL_MANAGER_ID,
  });
  console.log('✅ 3 cases on COASTAL-HHS\n');

  console.log('Creating cases for MIDSTATE-DSS (3)...');
  await upsertCase({
    id: CASE_MIDSTATE_1,
    tenantId: TENANT_MIDSTATE_ID,
    caseNumber: 'MIDSTATE-2024-001',
    title: 'Kinship placement support',
    description: 'Home study scheduled; background checks in progress.',
    type: 'internal',
    priority: 'urgent',
    status: 'under_review',
    workflowId: WORKFLOW_MIDSTATE_ID,
    assignedTo: USER_MIDSTATE_MANAGER_ID,
    createdBy: USER_MIDSTATE_MANAGER_ID,
  });
  await upsertCase({
    id: CASE_MIDSTATE_2,
    tenantId: TENANT_MIDSTATE_ID,
    caseNumber: 'MIDSTATE-2024-002',
    title: 'Family preservation services plan',
    description: '90-day review milestone.',
    type: 'internal',
    priority: 'normal',
    status: 'in_progress',
    workflowId: WORKFLOW_MIDSTATE_ID,
    assignedTo: USER_MIDSTATE_MANAGER_ID,
    createdBy: USER_MIDSTATE_MANAGER_ID,
  });
  await upsertCase({
    id: CASE_MIDSTATE_3,
    tenantId: TENANT_MIDSTATE_ID,
    caseNumber: 'MIDSTATE-2024-003',
    title: 'Interstate compact referral packet',
    description: 'Outgoing referral prep — no assignee yet.',
    type: 'referral',
    priority: 'high',
    status: 'open',
    workflowId: WORKFLOW_MIDSTATE_ID,
    assignedTo: null,
    createdBy: USER_MIDSTATE_MANAGER_ID,
  });
  console.log('✅ 3 cases on MIDSTATE-DSS\n');

  console.log('Creating sample pending referral (TEST-ORG → PARTNER-AGENCY)...');
  await prisma.caseReferral.upsert({
    where: { id: REFERRAL_SEED_1 },
    update: {
      status: 'pending',
      referralReason: 'Seed: cross-agency coordination demo',
    },
    create: {
      id: REFERRAL_SEED_1,
      caseId: CASE_SEED_1,
      fromTenantId: TENANT_ID,
      toTenantId: TENANT_PARTNER_ID,
      referralReason: 'Seed: cross-agency coordination demo',
      status: 'pending',
      referredBy: ADMIN_USER_ID,
    },
  });
  console.log('✅ Referral linked to SEED-2024-001\n');

  // Summary
  console.log('═'.repeat(50));
  console.log('🎉 Database seeded successfully!\n');
  console.log('Test Credentials:');
  console.log('─'.repeat(50));
  console.log('Agencies (tenant codes): TEST-ORG · PARTNER-AGENCY · COASTAL-HHS · MIDSTATE-DSS\n');
  console.log('Admin User (TEST-ORG):');
  console.log('  Email: admin@test-org.com');
  console.log('  Password: password123');
  console.log('  ROLE: admin (all permissions)\n');
  console.log('Case Manager User (TEST-ORG):');
  console.log('  Email: manager@test-org.com');
  console.log('  Password: password123');
  console.log('  Role: case_manager\n');
  console.log('Viewer User (TEST-ORG):');
  console.log('  Email: viewer@test-org.com');
  console.log('  Password: password123');
  console.log('  Role: viewer (read-only)\n');
  console.log('Partner admin (PARTNER-AGENCY):');
  console.log('  Email: admin@partner-agency.gov');
  console.log('  Password: password123');
  console.log('  Role: case_manager\n');
  console.log('Coastal manager (COASTAL-HHS):');
  console.log('  Email: manager@coastal-hhs.demo');
  console.log('  Password: password123');
  console.log('  Role: case_manager\n');
  console.log('Midstate manager (MIDSTATE-DSS):');
  console.log('  Email: manager@midstate-dss.demo');
  console.log('  Password: password123');
  console.log('  Role: case_manager\n');
  console.log('Cases by agency:');
  console.log('  TEST-ORG:     SEED-2024-001 … 004');
  console.log('  PARTNER:      PARTNER-2024-001 … 003');
  console.log('  COASTAL-HHS:  COASTAL-2024-001 … 003');
  console.log('  MIDSTATE-DSS: MIDSTATE-2024-001 … 003');
  console.log('Sample referral (pending TEST-ORG → PARTNER): id', REFERRAL_SEED_1);
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
