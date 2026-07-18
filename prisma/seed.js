/**
 * IACMS Database Seed Script (Portal-scale)
 *
 * Requirements from user:
 * - Remove old seeded data (cases, workflows, etc.)
 * - Seed one platform tenant (code ADMIN) plus 6 operational tenants
 * - Seed about 5 workflows per operational tenant
 * - Seed around 6 employees/users per operational tenant (not under ADMIN)
 * - Seed at least 3 cross-tenant referrals
 *
 * This script clears ALL data in the public schema tables used by the app.
 * Use ONLY in local/dev databases.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SYSTEM_USER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

/** Platform operators live here only — never seed cases/workflows/staff loops for this id. */
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000001';

// Operational tenants only (portal demo orgs — not platform ADMIN)
const TENANTS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'DCS-01',
    name: 'Department of Children Services — District 01',
    casePrefix: 'DCS01',
    description: 'Child protection intake, assessment, and case coordination.',
  },
  {
    id: '11111111-1111-1111-1111-111111111112',
    code: 'DCS-02',
    name: 'Department of Children Services — District 02',
    casePrefix: 'DCS02',
    description: 'Frontline child welfare response team with active partner coordination.',
  },
  {
    id: '11111111-1111-1111-1111-111111111113',
    code: 'CPS-GCPD',
    name: 'Central Police Station — Gender & Child Protection Desk',
    casePrefix: 'CPS',
    description: 'Police desk coordinating reports, referrals, and evidence requests.',
  },
  {
    id: '11111111-1111-1111-1111-111111111114',
    code: 'FAMILY-COURT',
    name: 'Family Court Registry',
    casePrefix: 'FCR',
    description: 'Court registry liaison for protection orders and case file tracking.',
  },
  {
    id: '11111111-1111-1111-1111-111111111115',
    code: 'PUBLIC-HOSP',
    name: 'Public Hospital — Social Work Unit',
    casePrefix: 'HOS',
    description: 'Hospital social work unit handling intake, clinical notes, and referrals.',
  },
  {
    id: '11111111-1111-1111-1111-111111111116',
    code: 'LEGAL-AID',
    name: 'Legal Aid Office',
    casePrefix: 'LGL',
    description: 'Legal assistance desk supporting protection orders and representation.',
  },
];

const ROLE_TENANT_ADMIN_ID = '55555555-5555-5555-5555-555555555555';
const ROLE_SYSTEM_ADMIN_ID = '99999999-9999-9999-9999-999999999991';
const ROLE_CASE_MANAGER_ID = '66666666-6666-6666-6666-666666666666';
const ROLE_VIEWER_ID = '77777777-7777-7777-7777-777777777777';

/** Matches shared/contracts/__fixtures__/workflow-full.example.json */
const FIXTURE_WORKFLOW_ID = '88888888-8888-8888-8888-888888888888';
const FIXTURE_TENANT_ID = TENANTS[0].id;

const permissions = [
  { resource: 'cases', action: 'create', description: 'Create new cases' },
  { resource: 'cases', action: 'read', description: 'View cases' },
  { resource: 'cases', action: 'update', description: 'Update cases' },
  { resource: 'cases', action: 'delete', description: 'Delete cases' },
  { resource: 'cases', action: 'assign', description: 'Assign cases to users' },
  { resource: 'cases', action: 'close', description: 'Close cases' },
  { resource: 'users', action: 'create', description: 'Create users' },
  { resource: 'users', action: 'read', description: 'View users' },
  { resource: 'users', action: 'update', description: 'Update users' },
  { resource: 'users', action: 'delete', description: 'Delete users' },
  { resource: 'roles', action: 'create', description: 'Create roles' },
  { resource: 'roles', action: 'read', description: 'View roles' },
  { resource: 'roles', action: 'update', description: 'Update roles' },
  { resource: 'roles', action: 'delete', description: 'Delete roles' },
  { resource: 'roles', action: 'assign', description: 'Assign roles to users' },
  { resource: 'workflows', action: 'create', description: 'Create workflows' },
  { resource: 'workflows', action: 'read', description: 'View workflows' },
  { resource: 'workflows', action: 'update', description: 'Update workflows' },
  { resource: 'workflows', action: 'delete', description: 'Delete workflows' },
  { resource: 'audit', action: 'read', description: 'View audit logs' },
  { resource: 'tenants', action: 'read', description: 'View tenants' },
  { resource: 'tenants', action: 'update', description: 'Update tenant settings' },
  {
    resource: 'platform',
    action: 'manage_tenants',
    description: 'Register organizations / platform operations',
  },
  { resource: 'referrals', action: 'read', description: 'View referrals involving own tenant' },
  { resource: 'referrals', action: 'create', description: 'Create outbound case referrals' },
  { resource: 'referrals', action: 'update', description: 'Accept or reject incoming referrals' },
];

/** Platform operator: all permissions except tenant case/workflow/referral operational data. */
function platformAdminPermissionKeys() {
  return permissions
    .filter(p => !['cases', 'workflows', 'referrals'].includes(p.resource))
    .map(p => `${p.resource}:${p.action}`);
}

const rolePermissions = {
  system_admin: platformAdminPermissionKeys(),
  tenant_admin: permissions
    .filter(p => p.resource !== 'platform')
    .map(p => `${p.resource}:${p.action}`),
  case_manager: [
    'cases:create',
    'cases:read',
    'cases:update',
    'cases:assign',
    'cases:close',
    'users:read',
    'workflows:read',
    'audit:read',
    'tenants:read',
    'referrals:read',
    'referrals:create',
    'referrals:update',
  ],
  viewer: ['cases:read', 'users:read', 'workflows:read', 'tenants:read', 'referrals:read'],
  intake_specialist: [
    'cases:create',
    'cases:read',
    'cases:update',
    'workflows:read',
    'tenants:read',
    'referrals:read',
    'referrals:create',
    'referrals:update',
  ],
};

function uuid() {
  return crypto.randomUUID();
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function makeEmail(tenantCode, localPart) {
  return `${localPart}@${tenantCode.toLowerCase()}.gov.example`;
}

function seededDepartmentsForTenant(tenant) {
  return [
    {
      code: `${tenant.code}-INTAKE`,
      name: 'Intake Department',
      description: 'Receives and triages new work.',
    },
    {
      code: `${tenant.code}-CASE`,
      name: 'Case Management Department',
      description: 'Owns active case handling and assignments.',
    },
    {
      code: `${tenant.code}-LEGAL`,
      name: 'Legal and Escalations Department',
      description: 'Handles escalations, approvals, and legal coordination.',
    },
  ];
}

async function clearDatabase() {
  console.log('Clearing existing data (dev only)...');
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.caseAttachment.deleteMany(),
    prisma.caseHistory.deleteMany(),
    prisma.assignment.deleteMany(),
    prisma.caseReferral.deleteMany(),
    prisma.case.deleteMany(),
    prisma.workflowTransition.deleteMany(),
    prisma.workflowStep.deleteMany(),
    prisma.workflow.deleteMany(),
    prisma.webhook.deleteMany(),
    prisma.integration.deleteMany(),
    prisma.caseSequence.deleteMany(),
    prisma.userRole.deleteMany(),
    prisma.rolePermission.deleteMany(),
    prisma.user.deleteMany(),
    prisma.department.deleteMany(),
    prisma.role.deleteMany(),
    prisma.permission.deleteMany(),
    prisma.tenant.deleteMany(),
  ]);
  console.log('✅ Database cleared\n');
}

async function writeAudit({
  tenantId,
  entityType,
  entityId,
  action,
  userId,
  newValues,
  oldValues,
  relatedTenantId,
}) {
  await prisma.auditLog.create({
    data: {
      tenantId,
      relatedTenantId: relatedTenantId ?? null,
      entityType,
      entityId,
      action,
      userId: userId ?? null,
      oldValues: oldValues ?? undefined,
      newValues: newValues ?? undefined,
      metadata: { source: 'seed', requestId: uuid() },
      ipAddress: '10.1.20.55',
      userAgent: 'seed-script/portal (node)',
    },
  });
}

async function createWorkflow({ tenantId, createdBy, key, name, description, isDefault }) {
  const workflow = await prisma.workflow.create({
    data: {
      tenantId,
      key,
      name,
      description,
      definition: { seeded: true },
      version: 1,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      isActive: true,
      isDefault,
      createdBy,
    },
  });

  const stepIntake = await prisma.workflowStep.create({
    data: {
      workflowId: workflow.id,
      key: 'intake',
      name: 'Intake',
      description: 'Initial report, validation, and intake package.',
      isInitial: true,
      isFinal: false,
      position: 0,
      allowedRoleIds: [],
      requiresAttachment: false,
    },
  });
  const stepAssessment = await prisma.workflowStep.create({
    data: {
      workflowId: workflow.id,
      key: 'assessment',
      name: 'Assessment',
      description: 'Assessment and verification activities.',
      isInitial: false,
      isFinal: false,
      position: 1,
      allowedRoleIds: [],
      requiresAttachment: false,
    },
  });
  const stepReview = await prisma.workflowStep.create({
    data: {
      workflowId: workflow.id,
      key: 'review',
      name: 'Supervisor review',
      description: 'Decision review (requires evidence/attachment).',
      isInitial: false,
      isFinal: false,
      position: 2,
      allowedRoleIds: [],
      requiresAttachment: true,
    },
  });
  const stepAction = await prisma.workflowStep.create({
    data: {
      workflowId: workflow.id,
      key: 'action_plan',
      name: 'Action plan',
      description: 'Execute plan and coordinate partners.',
      isInitial: false,
      isFinal: false,
      position: 3,
      allowedRoleIds: [],
      requiresAttachment: false,
    },
  });
  const stepClosed = await prisma.workflowStep.create({
    data: {
      workflowId: workflow.id,
      key: 'closed',
      name: 'Closed',
      description: 'Closed and archived.',
      isInitial: false,
      isFinal: true,
      position: 4,
      allowedRoleIds: [],
      requiresAttachment: false,
    },
  });

  await prisma.workflowTransition.createMany({
    data: [
      {
        workflowId: workflow.id,
        fromStepId: stepIntake.id,
        toStepId: stepAssessment.id,
        name: 'submit_intake',
        description: 'Submit intake package',
        allowedRoleIds: [],
        requiresComment: true,
        timeLimitType: 'RECOMMENDATION',
        timeLimitAmount: 5,
        timeLimitUnit: 'DAYS',
      },
      {
        workflowId: workflow.id,
        fromStepId: stepAssessment.id,
        toStepId: stepReview.id,
        name: 'request_review',
        description: 'Request supervisor review',
        allowedRoleIds: [],
        requiresComment: true,
        timeLimitType: 'DEADLINE',
        timeLimitAmount: 72,
        timeLimitUnit: 'HOURS',
      },
      {
        workflowId: workflow.id,
        fromStepId: stepReview.id,
        toStepId: stepAction.id,
        name: 'approve_plan',
        description: 'Approve plan',
        allowedRoleIds: [],
        requiresComment: true,
        timeLimitType: 'NONE',
        timeLimitAmount: null,
        timeLimitUnit: null,
      },
      {
        workflowId: workflow.id,
        fromStepId: stepAction.id,
        toStepId: stepClosed.id,
        name: 'close_case',
        description: 'Close case',
        allowedRoleIds: [],
        requiresComment: true,
        timeLimitType: 'RECOMMENDATION',
        timeLimitAmount: 14,
        timeLimitUnit: 'DAYS',
      },
      {
        workflowId: workflow.id,
        fromStepId: stepReview.id,
        toStepId: stepAssessment.id,
        name: 'return_for_changes',
        description: 'Return for changes',
        allowedRoleIds: [],
        requiresComment: true,
        timeLimitType: 'DEADLINE',
        timeLimitAmount: 7,
        timeLimitUnit: 'DAYS',
      },
    ],
  });

  return { workflow, steps: { stepIntake, stepAssessment, stepReview, stepAction, stepClosed } };
}

async function createReferralIntakeWorkflow({ tenantId, createdBy }) {
  const workflow = await prisma.workflow.create({
    data: {
      tenantId,
      key: 'referral-intake',
      name: 'Referral Intake',
      description: 'Temporary holding workflow for inbound referrals awaiting local assignment.',
      definition: { seeded: true, referralIntake: true },
      version: 1,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      isActive: true,
      isDefault: false,
      createdBy,
    },
  });

  const stepAwaitingAssignment = await prisma.workflowStep.create({
    data: {
      workflowId: workflow.id,
      key: 'awaiting-assignment',
      name: 'Awaiting Assignment',
      description: 'Receiving agency must choose a local workflow and assignee before work begins.',
      isInitial: true,
      isFinal: false,
      position: 0,
      allowedRoleIds: [],
      requiresAttachment: false,
    },
  });

  return { workflow, steps: { stepAwaitingAssignment } };
}

async function main() {
  console.log('🌱 Starting portal seed...\n');

  await clearDatabase();

  console.log('Creating permissions...');
  const createdPermissions = await Promise.all(
    permissions.map(perm => prisma.permission.create({ data: perm }))
  );
  console.log(`✅ Created ${createdPermissions.length} permissions\n`);

  console.log('Creating global roles...');
  const tenantAdminRole = await prisma.role.create({
    data: {
      id: ROLE_TENANT_ADMIN_ID,
      tenantId: null,
      name: 'tenant_admin',
      description: 'Tenant administrator — workflows, roles, users within one organization',
      isSystemRole: true,
      isActive: true,
    },
  });
  const systemAdminRole = await prisma.role.create({
    data: {
      id: ROLE_SYSTEM_ADMIN_ID,
      tenantId: null,
      name: 'system_admin',
      description: 'Platform operator — may register tenants and assign system_admin',
      isSystemRole: true,
      isActive: true,
    },
  });
  const caseManagerRole = await prisma.role.create({
    data: {
      id: ROLE_CASE_MANAGER_ID,
      tenantId: null,
      name: 'case_manager',
      description: 'Can manage cases and assignments',
      isSystemRole: true,
      isActive: true,
    },
  });
  const viewerRole = await prisma.role.create({
    data: {
      id: ROLE_VIEWER_ID,
      tenantId: null,
      name: 'viewer',
      description: 'Read-only access to cases',
      isSystemRole: true,
      isActive: true,
    },
  });
  void tenantAdminRole;
  void systemAdminRole;
  void caseManagerRole;
  void viewerRole;

  // Helper: attach permissions to role
  async function assignPermissionsToRole(roleId, keys) {
    for (const key of keys) {
      const [resource, action] = key.split(':');
      const permission = createdPermissions.find(
        p => p.resource === resource && p.action === action
      );
      if (!permission) continue;
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
  }

  await assignPermissionsToRole(ROLE_SYSTEM_ADMIN_ID, rolePermissions.system_admin);
  await assignPermissionsToRole(ROLE_TENANT_ADMIN_ID, rolePermissions.tenant_admin);
  await assignPermissionsToRole(ROLE_CASE_MANAGER_ID, rolePermissions.case_manager);
  await assignPermissionsToRole(ROLE_VIEWER_ID, rolePermissions.viewer);

  console.log('✅ Global roles created and permissions assigned\n');

  console.log('Creating platform tenant...');
  await prisma.tenant.create({
    data: {
      id: PLATFORM_TENANT_ID,
      code: 'ADMIN',
      name: 'IACMS Platform',
      description:
        'Platform administration only — not a line-of-business tenant. Use separate operational tenants for cases and workflows.',
      config: {
        timezone: 'UTC',
        dateFormat: 'YYYY-MM-DD',
        caseNumberPrefix: 'ADM',
        intakeSlaDays: 0,
      },
      isActive: true,
      registeredByUserId: null,
    },
  });
  console.log('✅ Platform tenant (ADMIN) created\n');

  console.log('Creating operational tenants...');
  for (const t of TENANTS) {
    await prisma.tenant.create({
      data: {
        id: t.id,
        name: t.name,
        code: t.code,
        description: t.description,
        config: {
          timezone: 'UTC',
          dateFormat: 'YYYY-MM-DD',
          caseNumberPrefix: t.casePrefix,
          intakeSlaDays: 5,
        },
        isActive: true,
        registeredByUserId: null,
      },
    });
  }
  console.log(`✅ Created ${TENANTS.length} operational tenants\n`);

  console.log('Creating departments for each operational tenant...');
  const departmentsByTenant = new Map();
  for (const tenant of TENANTS) {
    const defs = seededDepartmentsForTenant(tenant);
    const created = [];
    for (const def of defs) {
      created.push(
        await prisma.department.create({
          data: {
            tenantId: tenant.id,
            code: def.code,
            name: def.name,
            description: def.description,
            isActive: true,
          },
        })
      );
    }
    departmentsByTenant.set(tenant.id, created);
  }
  console.log('✅ Departments created\n');

  console.log('Creating platform user...');
  const passwordHash = await bcrypt.hash('password123', 10);
  const platformUser = await prisma.user.create({
    data: {
      id: SYSTEM_USER_ID,
      tenantId: PLATFORM_TENANT_ID,
      email: 'platform.admin@iacms.gov.example',
      username: 'platform.admin',
      passwordHash,
      firstName: 'Platform',
      lastName: 'Administrator',
      isActive: true,
      isEmailVerified: true,
      mustChangePassword: false,
      lastLogin: daysAgo(1),
    },
  });
  await prisma.userRole.create({
    data: { userId: platformUser.id, roleId: ROLE_SYSTEM_ADMIN_ID, assignedBy: platformUser.id },
  });
  console.log('✅ Platform user created\n');

  console.log('Creating tenant staff (6 users per tenant)...');
  const seededUsers = [];
  const tenantIntakeRolesByTenant = new Map();

  for (const tenant of TENANTS) {
    // Registrar link
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { registeredByUserId: platformUser.id },
    });
    await writeAudit({
      tenantId: tenant.id,
      entityType: 'tenant',
      entityId: tenant.id,
      action: 'platform.register_tenant',
      userId: platformUser.id,
      newValues: { code: tenant.code, name: tenant.name },
    });

    // Tenant-specific role
    const intakeRole = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: 'intake_specialist',
        description: 'Creates cases and prepares intake packages for review',
        isSystemRole: false,
        isActive: true,
      },
    });
    tenantIntakeRolesByTenant.set(tenant.id, intakeRole.id);
    await assignPermissionsToRole(intakeRole.id, rolePermissions.intake_specialist);

    const staff = [
      { local: 'admin', first: 'Dana', last: 'Reed', roles: [ROLE_TENANT_ADMIN_ID], deptIdx: 2 },
      {
        local: 'supervisor',
        first: 'Noah',
        last: 'Brooks',
        roles: [ROLE_CASE_MANAGER_ID],
        deptIdx: 1,
      },
      { local: 'intake', first: 'Maya', last: 'Patel', roles: [intakeRole.id], deptIdx: 0 },
      {
        local: 'case.manager1',
        first: 'Ethan',
        last: 'Kim',
        roles: [ROLE_CASE_MANAGER_ID],
        deptIdx: 1,
      },
      {
        local: 'case.manager2',
        first: 'Sara',
        last: 'Lopez',
        roles: [ROLE_CASE_MANAGER_ID],
        deptIdx: 1,
      },
      { local: 'viewer', first: 'Ivy', last: 'Chen', roles: [ROLE_VIEWER_ID], deptIdx: 0 },
    ];

    const tenantDepartments = departmentsByTenant.get(tenant.id) ?? [];

    for (const s of staff) {
      const email = makeEmail(tenant.code, s.local);
      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          departmentId: tenantDepartments[s.deptIdx]?.id ?? null,
          email,
          username: s.local.replace(/\./g, '_'),
          passwordHash,
          firstName: s.first,
          lastName: s.last,
          isActive: true,
          isEmailVerified: true,
          mustChangePassword: false,
          lastLogin: daysAgo(2),
        },
      });
      for (const roleId of s.roles) {
        await prisma.userRole.create({
          data: { userId: user.id, roleId, assignedBy: platformUser.id },
        });
      }
      seededUsers.push({ tenantCode: tenant.code, email, password: 'password123', roles: s.roles });
    }
  }
  console.log('✅ Tenant staff created\n');

  console.log('Creating workflows (5 per tenant)...');
  const workflowsByTenant = new Map();
  const workflowCatalog = [
    {
      key: 'child-protection',
      name: 'Child Protection Response',
      desc: 'Hotline / walk-in child protection workflow',
    },
    {
      key: 'education-welfare',
      name: 'Education Welfare',
      desc: 'School attendance and welfare follow-up workflow',
    },
    {
      key: 'medical-social',
      name: 'Medical Social Support',
      desc: 'Hospital social work intake and discharge planning',
    },
    {
      key: 'legal-support',
      name: 'Legal Support',
      desc: 'Legal aid / protection order support workflow',
    },
    {
      key: 'interagency',
      name: 'Inter-Agency Referral',
      desc: 'Cross-agency referral and collaboration workflow',
    },
  ];

  for (const tenant of TENANTS) {
    const adminEmail = makeEmail(tenant.code, 'admin');
    const adminUser = await prisma.user.findFirst({
      where: { tenantId: tenant.id, email: adminEmail },
    });
    if (!adminUser) throw new Error(`Expected admin user missing for ${tenant.code}`);

    const tenantWorkflows = [];
    for (const wf of workflowCatalog) {
      const created = await createWorkflow({
        tenantId: tenant.id,
        createdBy: adminUser.id,
        key: wf.key,
        name: wf.name,
        description: wf.desc,
        isDefault: wf.key === 'child-protection',
      });
      tenantWorkflows.push(created);
    }
    tenantWorkflows.push(
      await createReferralIntakeWorkflow({
        tenantId: tenant.id,
        createdBy: adminUser.id,
      })
    );
    workflowsByTenant.set(tenant.id, tenantWorkflows);
  }
  console.log('✅ Workflows created\n');

  console.log('Creating cases + referrals (at least 3 referrals)...');
  const currentYear = new Date().getFullYear();

  // Seed case sequences for each tenant
  for (const tenant of TENANTS) {
    await prisma.caseSequence.create({
      data: { tenantId: tenant.id, year: currentYear, lastSeq: 100 },
    });
  }

  // Create 3 referral cases from DCS-01 to three partner tenants
  const fromTenant = TENANTS.find(t => t.code === 'DCS-01');
  if (!fromTenant) throw new Error('Missing DCS-01 tenant');
  const fromAdmin = await prisma.user.findFirst({
    where: { tenantId: fromTenant.id, email: makeEmail(fromTenant.code, 'admin') },
  });
  const fromManager = await prisma.user.findFirst({
    where: { tenantId: fromTenant.id, email: makeEmail(fromTenant.code, 'case.manager1') },
  });
  if (!fromAdmin || !fromManager) throw new Error('Missing expected users for DCS-01');
  const fromDefaultWorkflow = workflowsByTenant.get(fromTenant.id)?.find(w => w.workflow.isDefault);
  if (!fromDefaultWorkflow) throw new Error('Missing default workflow for DCS-01');
  const fromDepartments = departmentsByTenant.get(fromTenant.id) ?? [];
  const fromCaseDept = fromDepartments[1]?.id ?? null;

  const referralTargets = ['CPS-GCPD', 'PUBLIC-HOSP', 'LEGAL-AID'].map(code =>
    TENANTS.find(t => t.code === code)
  );
  if (referralTargets.some(t => !t)) throw new Error('Missing referral target tenant(s)');

  const referralSpecs = [
    {
      toTenant: referralTargets[0],
      title: 'Station desk referral — incident report verification',
      reason: 'Verify report reference and attach summary.',
      status: 'completed',
    },
    {
      toTenant: referralTargets[1],
      title: 'Hospital unit referral — medical social support intake',
      reason: 'Coordinate social work intake and provide discharge support plan.',
      status: 'accepted',
    },
    {
      toTenant: referralTargets[2],
      title: 'Legal aid referral — protection order support',
      reason: 'Provide legal support and guidance for protection order filing.',
      status: 'rejected',
    },
  ];

  for (let i = 0; i < referralSpecs.length; i++) {
    const spec = referralSpecs[i];
    const seq = 100 + i + 1;
    const caseId = uuid();
    const referralId = uuid();

    const c = await prisma.case.create({
      data: {
        id: caseId,
        tenantId: fromTenant.id,
        originatingTenantId: fromTenant.id,
        currentTenantId: spec.toTenant.id,
        originatingDepartmentId: fromCaseDept,
        currentDepartmentId: departmentsByTenant.get(spec.toTenant.id)?.[0]?.id ?? null,
        referralStatus: spec.status,
        workflowId: fromDefaultWorkflow.workflow.id,
        workflowVersion: 1,
        caseNumber: `${fromTenant.casePrefix}-${currentYear}-${String(seq).padStart(4, '0')}`,
        currentStepId: fromDefaultWorkflow.steps.stepAssessment.id,
        title: spec.title,
        description: 'Seeded referral case with cross-agency workflow and audit trail.',
        type: 'interagency_referral',
        priority: 'high',
        status: 'open',
        assignedTo: fromManager.id,
        createdBy: fromAdmin.id,
        metadata: { seeded: true, referral: { to: spec.toTenant.code } },
        dueDate: daysFromNow(7),
        createdAt: daysAgo(6),
      },
    });

    // Add minimal history
    const transitions = await prisma.workflowTransition.findMany({
      where: { workflowId: c.workflowId },
    });
    const tIntake = transitions.find(t => t.name === 'submit_intake');
    await prisma.caseHistory.create({
      data: {
        caseId: c.id,
        tenantId: c.tenantId,
        transitionId: tIntake?.id ?? null,
        fromStepId: fromDefaultWorkflow.steps.stepIntake.id,
        toStepId: fromDefaultWorkflow.steps.stepAssessment.id,
        actorId: fromAdmin.id,
        comment: 'Intake completed; initiating partner referral.',
        transitionedAt: daysAgo(5),
      },
    });

    // Create referral
    const accepter = await prisma.user.findFirst({
      where: { tenantId: spec.toTenant.id, email: makeEmail(spec.toTenant.code, 'supervisor') },
    });
    const rejecter = await prisma.user.findFirst({
      where: { tenantId: spec.toTenant.id, email: makeEmail(spec.toTenant.code, 'supervisor') },
    });

    const now = new Date();
    await prisma.caseReferral.create({
      data: {
        id: referralId,
        caseId: c.id,
        fromTenantId: fromTenant.id,
        toTenantId: spec.toTenant.id,
        fromDepartmentId: fromCaseDept,
        toDepartmentId: departmentsByTenant.get(spec.toTenant.id)?.[0]?.id ?? null,
        referralReason: spec.reason,
        notes: 'Seeded referral notes: includes consent and contact instructions.',
        status: spec.status,
        referredBy: fromManager.id,
        acceptedBy:
          spec.status === 'accepted' || spec.status === 'completed' ? (accepter?.id ?? null) : null,
        rejectedBy: spec.status === 'rejected' ? (rejecter?.id ?? null) : null,
        referredAt: daysAgo(5),
        acceptedAt: spec.status === 'accepted' || spec.status === 'completed' ? daysAgo(4) : null,
        rejectedAt: spec.status === 'rejected' ? daysAgo(4) : null,
        completedAt: spec.status === 'completed' ? now : null,
        metadata: { consent: true, seeded: true },
      },
    });

    await writeAudit({
      tenantId: fromTenant.id,
      relatedTenantId: spec.toTenant.id,
      entityType: 'case_referral',
      entityId: referralId,
      action: `referral.${spec.status}`,
      userId: fromManager.id,
      newValues: { caseId: c.id, toTenant: spec.toTenant.code, status: spec.status },
    });
  }

  console.log('✅ Cases and referrals created\n');

  // 7. Published workflow matching shared/contracts/__fixtures__/workflow-full.example.json
  console.log('Creating published workflow standard-case…');
  const fixtureAdmin = await prisma.user.findFirst({
    where: { tenantId: FIXTURE_TENANT_ID, email: makeEmail(TENANTS[0].code, 'admin') },
  });
  if (!fixtureAdmin) throw new Error(`Fixture tenant admin missing for ${TENANTS[0].code}`);

  await prisma.workflowTransition
    .deleteMany({ where: { workflowId: FIXTURE_WORKFLOW_ID } })
    .catch(() => {});
  await prisma.workflowStep
    .deleteMany({ where: { workflowId: FIXTURE_WORKFLOW_ID } })
    .catch(() => {});
  await prisma.workflow.deleteMany({ where: { id: FIXTURE_WORKFLOW_ID } }).catch(() => {});

  const wfFixture = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        '..',
        'shared',
        'contracts',
        '__fixtures__',
        'workflow-full.example.json'
      ),
      'utf8'
    )
  );

  await prisma.workflow.create({
    data: {
      id: FIXTURE_WORKFLOW_ID,
      tenantId: FIXTURE_TENANT_ID,
      key: wfFixture.key,
      name: 'Standard Case Flow',
      description: 'Seed workflow (Draft → Review → Approval → Closed)',
      version: wfFixture.version,
      status: 'PUBLISHED',
      publishedAt: new Date(wfFixture.publishedAt),
      definition: wfFixture,
      isActive: true,
      isDefault: true,
      createdBy: fixtureAdmin.id,
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
      workflowId: FIXTURE_WORKFLOW_ID,
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

  // ── File Management Service: retention policies ──────────────────────────
  console.log('Seeding service retention policies...');
  const retentionPolicies = [
    {
      service: 'case-management',
      retentionDays: null,
      description: 'Legal evidence — keep forever, never auto-delete',
    },
    {
      service: 'chat',
      retentionDays: 90,
      description: 'Chat attachments — deleted 90 days after soft delete',
    },
    {
      service: 'hr',
      retentionDays: 2555,
      description: 'HR documents — 7 years legal compliance requirement',
    },
    {
      service: 'audit',
      retentionDays: null,
      description: 'Audit documents — keep forever',
    },
  ];

  for (const policy of retentionPolicies) {
    await prisma.serviceRetentionPolicy.upsert({
      where: { service: policy.service },
      update: { retentionDays: policy.retentionDays, description: policy.description },
      create: policy,
    });
  }
  console.log('Service retention policies seeded.');

  // Summary
  console.log('═'.repeat(60));
  console.log('🎉 Portal database seeded successfully!\n');
  console.log('Login Credentials (all passwords are "password123")');
  console.log('─'.repeat(60));
  console.log('ADMIN — IACMS Platform (system operators only)');
  console.log(`  ${platformUser.email}  —  tenantCode: ADMIN  —  role: system_admin`);
  console.log('');
  for (const tenant of TENANTS) {
    console.log(`${tenant.code} — ${tenant.name}`);
    const tenantUsers = seededUsers.filter(u => u.tenantCode === tenant.code);
    for (const u of tenantUsers) {
      console.log(`  ${u.email}`);
    }
    console.log('');
  }
  console.log('═'.repeat(60));
}

main()
  .catch(e => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
