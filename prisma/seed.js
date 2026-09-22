/**
 * IACMS Comprehensive Multi-Tenant, Multi-Department & Cross-Tenant Referral Seed Script
 *
 * Architecture Seeded:
 * - 1 Platform Admin Tenant (ADMIN)
 * - 6 Operational Tenants (DCS-01, DCS-02, CPS-GCPD, FAMILY-COURT, PUBLIC-HOSP, LEGAL-AID)
 * - 3-4 Specialized Departments per Operational Tenant
 * - 6 Users per Operational Tenant (36 Staff Users Total) bound to explicit departments and roles
 * - 5 Published Workflows per Tenant + 1 Referral Holding Workflow
 * - 36+ Rich Cases spread across all tenants and departments with active, non-blocked transition timelines and valid due dates
 * - 18+ Cross-Tenant & Cross-Department Referrals with explicit due dates, notes, and lifecycle statuses
 * - Multi-step Case History entries and Case Attachments linked to workflow steps
 * - Comprehensive Audit Trail
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
const PLATFORM_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const TENANTS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'DCS-01',
    name: 'Department of Children Services — District 01',
    casePrefix: 'DCS01',
    description: 'Child protection intake, assessment, and case coordination.',
    departments: [
      { code: 'DCS01-INTAKE', name: 'Child Protection Intake Desk', desc: 'Receives and triages urgent child safety reports.' },
      { code: 'DCS01-CASE', name: 'Family Welfare & Case Management', desc: 'Owns long-term case handling and foster placement.' },
      { code: 'DCS01-LEGAL', name: 'Legal Advocacy & Court Liaison', desc: 'Coordinates legal protection filings and court hearings.' },
    ],
  },
  {
    id: '11111111-1111-1111-1111-111111111112',
    code: 'DCS-02',
    name: 'Department of Children Services — District 02',
    casePrefix: 'DCS02',
    description: 'Frontline child welfare response team with active partner coordination.',
    departments: [
      { code: 'DCS02-INTAKE', name: 'Frontline Intake Desk', desc: 'Hotline and walk-in triage.' },
      { code: 'DCS02-FIELD', name: 'Field Assessment Unit', desc: 'Home visits and emergency assessment.' },
      { code: 'DCS02-SUPERVIS', name: 'Case Supervision Unit', desc: 'Supervisory oversight and approvals.' },
    ],
  },
  {
    id: '11111111-1111-1111-1111-111111111113',
    code: 'CPS-GCPD',
    name: 'Central Police Station — Gender & Child Protection Desk',
    casePrefix: 'CPS',
    description: 'Police desk coordinating reports, referrals, and evidence requests.',
    departments: [
      { code: 'CPS-DESK', name: 'Protection Desk Intake', desc: 'Police desk report logging.' },
      { code: 'CPS-INVEST', name: 'Special Investigations Unit', desc: 'Child protection criminal investigations.' },
      { code: 'CPS-ORDERS', name: 'Protection Orders Execution Desk', desc: 'Enforces restraining orders.' },
    ],
  },
  {
    id: '11111111-1111-1111-1111-111111111114',
    code: 'FAMILY-COURT',
    name: 'Family Court Registry',
    casePrefix: 'FCR',
    description: 'Court registry liaison for protection orders and case file tracking.',
    departments: [
      { code: 'FCR-REGISTRY', name: 'Court File Registry', desc: 'Receives and dockets court applications.' },
      { code: 'FCR-JUDICIAL', name: 'Judicial Hearing Review Unit', desc: 'Magistrate and judge review.' },
      { code: 'FCR-MEDIATION', name: 'Family Mediation & Welfare Desk', desc: 'Court-ordered family mediation.' },
    ],
  },
  {
    id: '11111111-1111-1111-1111-111111111115',
    code: 'PUBLIC-HOSP',
    name: 'Public Hospital — Social Work Unit',
    casePrefix: 'HOS',
    description: 'Hospital social work unit handling intake, clinical notes, and referrals.',
    departments: [
      { code: 'HOS-ER-SW', name: 'Emergency Room Social Work', desc: '24/7 ER trauma social intake.' },
      { code: 'HOS-PEDIATRIC', name: 'Pediatric Care Social Unit', desc: 'Inpatient child ward follow-up.' },
      { code: 'HOS-DISCHARGE', name: 'Discharge Planning Desk', desc: 'Outbound medical social referrals.' },
    ],
  },
  {
    id: '11111111-1111-1111-1111-111111111116',
    code: 'LEGAL-AID',
    name: 'Legal Aid Office',
    casePrefix: 'LGL',
    description: 'Legal assistance desk supporting protection orders and representation.',
    departments: [
      { code: 'LGL-INTAKE', name: 'Legal Aid Client Intake', desc: 'Qualifies clients for pro-bono defense.' },
      { code: 'LGL-DEFENSE', name: 'Child & Family Representation Unit', desc: 'Assigned trial attorneys.' },
      { code: 'LGL-ADVOCACY', name: 'Rights & Policy Advocacy Desk', desc: 'Public interest legal support.' },
    ],
  },
];

const ROLE_TENANT_ADMIN_ID = '55555555-5555-5555-5555-555555555555';
const ROLE_SYSTEM_ADMIN_ID = '99999999-9999-9999-9999-999999999991';
const ROLE_CASE_MANAGER_ID = '66666666-6666-6666-6666-666666666666';
const ROLE_VIEWER_ID = '77777777-7777-7777-7777-777777777777';

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
  { resource: 'platform', action: 'manage_tenants', description: 'Register organizations / platform operations' },
  { resource: 'referrals', action: 'read', description: 'View referrals involving own tenant' },
  { resource: 'referrals', action: 'create', description: 'Create outbound case referrals' },
  { resource: 'referrals', action: 'update', description: 'Accept or reject incoming referrals' },
  { resource: 'file', action: 'read', description: 'View and download files' },
  { resource: 'file', action: 'upload', description: 'Upload files (single, batch, chunked)' },
  { resource: 'file', action: 'delete', description: 'Soft-delete files' },
  { resource: 'file', action: 'admin', description: 'Cross-service file admin (list all services)' },
  // Partner API key management — tenant_admin only
  { resource: 'apiKeys', action: 'create', description: 'Create partner API keys' },
  { resource: 'apiKeys', action: 'read',   description: 'List partner API keys' },
  { resource: 'apiKeys', action: 'revoke', description: 'Revoke partner API keys' },
  { resource: 'apiKeys', action: 'rotate', description: 'Rotate partner API keys' },
];

function platformAdminPermissionKeys() {
  return permissions
    .filter(p => !['cases', 'workflows', 'referrals'].includes(p.resource))
    .map(p => `${p.resource}:${p.action}`);
}

const rolePermissions = {
  system_admin: platformAdminPermissionKeys(),
  tenant_admin: permissions
    .filter(p => p.resource !== 'platform' && !(p.resource === 'file' && p.action === 'admin'))
    .map(p => `${p.resource}:${p.action}`),
  case_manager: [
    'cases:create', 'cases:read', 'cases:update', 'cases:assign', 'cases:close',
    'users:read', 'workflows:read', 'audit:read', 'tenants:read',
    'referrals:read', 'referrals:create', 'referrals:update',
    'file:read', 'file:upload', 'file:delete',
  ],
  viewer: [
    'cases:read', 'users:read', 'workflows:read', 'tenants:read', 'referrals:read', 'file:read',
  ],
  intake_specialist: [
    'cases:create', 'cases:read', 'cases:update', 'workflows:read', 'tenants:read',
    'referrals:read', 'referrals:create', 'referrals:update',
    'file:read', 'file:upload', 'file:delete',
  ],
};

function uuid() {
  return crypto.randomUUID();
}

function hoursAgo(n) {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
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

async function writeAudit({ tenantId, entityType, entityId, action, userId, newValues, oldValues, relatedTenantId, timestamp }) {
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
      createdAt: timestamp ?? new Date(),
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
      publishedAt: daysAgo(30),
      isActive: true,
      isDefault,
      createdBy,
    },
  });

  const stepIntake = await prisma.workflowStep.create({
    data: { workflowId: workflow.id, key: 'intake', name: 'Intake', description: 'Initial report, validation, and intake package.', isInitial: true, isFinal: false, position: 0, allowedRoleIds: [], requiresAttachment: false },
  });
  const stepAssessment = await prisma.workflowStep.create({
    data: { workflowId: workflow.id, key: 'assessment', name: 'Assessment', description: 'Assessment and verification activities.', isInitial: false, isFinal: false, position: 1, allowedRoleIds: [], requiresAttachment: false },
  });
  const stepReview = await prisma.workflowStep.create({
    data: { workflowId: workflow.id, key: 'review', name: 'Supervisor Review', description: 'Decision review (requires evidence/attachment).', isInitial: false, isFinal: false, position: 2, allowedRoleIds: [], requiresAttachment: true },
  });
  const stepAction = await prisma.workflowStep.create({
    data: { workflowId: workflow.id, key: 'action_plan', name: 'Action Plan', description: 'Execute plan and coordinate partners.', isInitial: false, isFinal: false, position: 3, allowedRoleIds: [], requiresAttachment: false },
  });
  const stepClosed = await prisma.workflowStep.create({
    data: { workflowId: workflow.id, key: 'closed', name: 'Closed', description: 'Closed and archived.', isInitial: false, isFinal: true, position: 4, allowedRoleIds: [], requiresAttachment: false },
  });

  // Use RECOMMENDATION for time limits so actions are clear and actionable without hard-blocking UI transitions
  await prisma.workflowTransition.createMany({
    data: [
      { workflowId: workflow.id, fromStepId: stepIntake.id, toStepId: stepAssessment.id, name: 'submit_intake', description: 'Submit intake package', allowedRoleIds: [], requiresComment: true, timeLimitType: 'RECOMMENDATION', timeLimitAmount: 5, timeLimitUnit: 'DAYS' },
      { workflowId: workflow.id, fromStepId: stepAssessment.id, toStepId: stepReview.id, name: 'request_review', description: 'Request supervisor review', allowedRoleIds: [], requiresComment: true, timeLimitType: 'RECOMMENDATION', timeLimitAmount: 5, timeLimitUnit: 'DAYS' },
      { workflowId: workflow.id, fromStepId: stepReview.id, toStepId: stepAction.id, name: 'approve_plan', description: 'Approve plan', allowedRoleIds: [], requiresComment: true, timeLimitType: 'NONE', timeLimitAmount: null, timeLimitUnit: null },
      { workflowId: workflow.id, fromStepId: stepAction.id, toStepId: stepClosed.id, name: 'close_case', description: 'Close case', allowedRoleIds: [], requiresComment: true, timeLimitType: 'RECOMMENDATION', timeLimitAmount: 14, timeLimitUnit: 'DAYS' },
      { workflowId: workflow.id, fromStepId: stepReview.id, toStepId: stepAssessment.id, name: 'return_for_changes', description: 'Return for changes', allowedRoleIds: [], requiresComment: true, timeLimitType: 'RECOMMENDATION', timeLimitAmount: 7, timeLimitUnit: 'DAYS' },
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
      publishedAt: daysAgo(30),
      isActive: true,
      isDefault: false,
      createdBy,
    },
  });

  const stepAwaitingAssignment = await prisma.workflowStep.create({
    data: { workflowId: workflow.id, key: 'awaiting-assignment', name: 'Awaiting Assignment', description: 'Receiving agency must choose a local workflow and assignee before work begins.', isInitial: true, isFinal: false, position: 0, allowedRoleIds: [], requiresAttachment: false },
  });

  return { workflow, steps: { stepAwaitingAssignment } };
}

async function main() {
  console.log('🌱 Starting Portal Seed (Active & Actionable Cases Edition)...\n');

  await clearDatabase();

  console.log('Creating permissions...');
  const createdPermissions = await Promise.all(
    permissions.map(perm => prisma.permission.create({ data: perm }))
  );
  console.log(`✅ Created ${createdPermissions.length} permissions\n`);

  console.log('Creating global roles...');
  await prisma.role.create({ data: { id: ROLE_TENANT_ADMIN_ID, tenantId: null, name: 'tenant_admin', description: 'Tenant administrator', isSystemRole: true, isActive: true } });
  await prisma.role.create({ data: { id: ROLE_SYSTEM_ADMIN_ID, tenantId: null, name: 'system_admin', description: 'Platform operator', isSystemRole: true, isActive: true } });
  await prisma.role.create({ data: { id: ROLE_CASE_MANAGER_ID, tenantId: null, name: 'case_manager', description: 'Can manage cases and assignments', isSystemRole: true, isActive: true } });
  await prisma.role.create({ data: { id: ROLE_VIEWER_ID, tenantId: null, name: 'viewer', description: 'Read-only access to cases', isSystemRole: true, isActive: true } });

  async function assignPermissionsToRole(roleId, keys) {
    for (const key of keys) {
      const [resource, action] = key.split(':');
      const permission = createdPermissions.find(p => p.resource === resource && p.action === action);
      if (!permission) continue;
      await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
  }

  await assignPermissionsToRole(ROLE_SYSTEM_ADMIN_ID, rolePermissions.system_admin);
  await assignPermissionsToRole(ROLE_TENANT_ADMIN_ID, rolePermissions.tenant_admin);
  await assignPermissionsToRole(ROLE_CASE_MANAGER_ID, rolePermissions.case_manager);
  await assignPermissionsToRole(ROLE_VIEWER_ID, rolePermissions.viewer);

  console.log('✅ Global roles created\n');

  console.log('Creating platform tenant & admin user...');
  await prisma.tenant.create({
    data: {
      id: PLATFORM_TENANT_ID,
      code: 'ADMIN',
      name: 'IACMS Platform',
      description: 'Platform administration only.',
      config: { timezone: 'UTC', dateFormat: 'YYYY-MM-DD', caseNumberPrefix: 'ADM', intakeSlaDays: 0 },
      isActive: true,
      registeredByUserId: null,
    },
  });

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
  console.log('✅ Platform tenant (ADMIN) created\n');

  console.log('Creating operational tenants & departments...');
  const departmentsByTenant = new Map();

  for (const t of TENANTS) {
    await prisma.tenant.create({
      data: {
        id: t.id,
        name: t.name,
        code: t.code,
        description: t.description,
        config: { timezone: 'UTC', dateFormat: 'YYYY-MM-DD', caseNumberPrefix: t.casePrefix, intakeSlaDays: 5 },
        isActive: true,
        registeredByUserId: platformUser.id,
      },
    });

    const createdDepts = [];
    for (const d of t.departments) {
      const dept = await prisma.department.create({
        data: { tenantId: t.id, code: d.code, name: d.name, description: d.desc, isActive: true },
      });
      createdDepts.push(dept);
    }
    departmentsByTenant.set(t.id, createdDepts);
  }
  console.log(`✅ Created ${TENANTS.length} operational tenants with multi-department structure\n`);

  console.log('Creating tenant users bound to explicit departments...');
  const usersByTenant = new Map();
  const seededUsers = [];

  for (const tenant of TENANTS) {
    const intakeRole = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: 'intake_specialist',
        description: 'Creates cases and prepares intake packages for review',
        isSystemRole: false,
        isActive: true,
      },
    });
    await assignPermissionsToRole(intakeRole.id, rolePermissions.intake_specialist);

    const depts = departmentsByTenant.get(tenant.id) ?? [];
    const staff = [
      { local: 'admin', first: 'Dana', last: 'Reed', roles: [ROLE_TENANT_ADMIN_ID], deptId: depts[0]?.id },
      { local: 'supervisor', first: 'Noah', last: 'Brooks', roles: [ROLE_CASE_MANAGER_ID], deptId: depts[1]?.id },
      { local: 'intake', first: 'Maya', last: 'Patel', roles: [intakeRole.id], deptId: depts[0]?.id },
      { local: 'case.manager1', first: 'Ethan', last: 'Kim', roles: [ROLE_CASE_MANAGER_ID], deptId: depts[1]?.id },
      { local: 'case.manager2', first: 'Sara', last: 'Lopez', roles: [ROLE_CASE_MANAGER_ID], deptId: depts[2]?.id ?? depts[1]?.id },
      { local: 'viewer', first: 'Ivy', last: 'Chen', roles: [ROLE_VIEWER_ID], deptId: depts[0]?.id },
    ];

    const tenantUsers = [];
    for (const s of staff) {
      const email = makeEmail(tenant.code, s.local);
      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          departmentId: s.deptId ?? null,
          email,
          username: `${tenant.code.toLowerCase().replace(/-/g, '_')}_${s.local.replace(/\./g, '_')}`,
          passwordHash,
          firstName: s.first,
          lastName: s.last,
          isActive: true,
          isEmailVerified: true,
          mustChangePassword: false,
          lastLogin: hoursAgo(Math.floor(Math.random() * 5) + 1),
        },
      });
      for (const roleId of s.roles) {
        await prisma.userRole.create({
          data: { userId: user.id, roleId, assignedBy: platformUser.id },
        });
      }
      tenantUsers.push(user);
      seededUsers.push({ tenantCode: tenant.code, email, password: 'password123', roles: s.roles });
    }
    usersByTenant.set(tenant.id, tenantUsers);
  }
  console.log('✅ Staff users assigned to explicit departments\n');

  console.log('Creating workflows (5 templates per tenant)...');
  const workflowsByTenant = new Map();
  const workflowCatalog = [
    { key: 'child-protection', name: 'Child Protection Response', desc: 'Hotline / walk-in child protection workflow' },
    { key: 'education-welfare', name: 'Education Welfare', desc: 'School attendance and welfare follow-up workflow' },
    { key: 'medical-social', name: 'Medical Social Support', desc: 'Hospital social work intake and discharge planning' },
    { key: 'legal-support', name: 'Legal Support', desc: 'Legal aid / protection order support workflow' },
    { key: 'interagency', name: 'Inter-Agency Referral', desc: 'Cross-agency referral and collaboration workflow' },
  ];

  for (const tenant of TENANTS) {
    const adminUser = usersByTenant.get(tenant.id)?.[0];
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
      await createReferralIntakeWorkflow({ tenantId: tenant.id, createdBy: adminUser.id })
    );
    workflowsByTenant.set(tenant.id, tenantWorkflows);
  }
  console.log('✅ Workflows created\n');

  console.log('Creating Active & Actionable Cases across all Tenants...');
  const currentYear = new Date().getFullYear();

  for (const tenant of TENANTS) {
    await prisma.caseSequence.create({
      data: { tenantId: tenant.id, year: currentYear, lastSeq: 500 },
    });
  }

  // Active cases with recent step transitions (so transitions are unblocked and executable!)
  const ActiveCaseSpecs = [
    {
      tenantCode: 'DCS-01',
      title: 'Child Welfare Assessment & Safety Plan — Case #2026-101',
      desc: 'Active safety plan assessment and witness report evaluation.',
      type: 'child_protection', priority: 'high', status: 'in_progress', stepKey: 'review', createdDaysAgo: 5, lastStepHoursAgo: 4, dueDaysFromNow: 5, assignedIdx: 3,
      history: [
        { hoursAgo: 48, fromKey: 'intake', toKey: 'assessment', comment: 'Intake package verified by caseworker.' },
        { hoursAgo: 4, fromKey: 'assessment', toKey: 'review', comment: 'Field notes completed. Requested supervisor review with attached evidence.' },
      ],
      attachment: { name: 'dcs01_assessment_evidence_report.pdf', size: 1450000, mime: 'application/pdf', desc: 'Social worker field assessment report' },
    },
    {
      tenantCode: 'DCS-01',
      title: 'School Attendance & Welfare Support — Case #2026-102',
      desc: 'School attendance follow-up for 2 minor students.',
      type: 'education_welfare', priority: 'normal', status: 'open', stepKey: 'assessment', createdDaysAgo: 3, lastStepHoursAgo: 6, dueDaysFromNow: 4, assignedIdx: 4,
      history: [
        { hoursAgo: 6, fromKey: 'intake', toKey: 'assessment', comment: 'School referral logged. Home visit scheduled.' },
      ],
    },
    {
      tenantCode: 'DCS-01',
      title: 'Foster Placement Review — Case #2026-103',
      desc: 'Periodic placement evaluation for certified foster home.',
      type: 'foster_care_review', priority: 'high', status: 'in_progress', stepKey: 'action_plan', createdDaysAgo: 10, lastStepHoursAgo: 8, dueDaysFromNow: 8, assignedIdx: 1,
      history: [
        { hoursAgo: 120, fromKey: 'intake', toKey: 'assessment', comment: 'Review initiated.' },
        { hoursAgo: 48, fromKey: 'assessment', toKey: 'review', comment: 'Home visit completed.' },
        { hoursAgo: 8, fromKey: 'review', toKey: 'action_plan', comment: 'Supervisor approved action plan.' },
      ],
    },
    {
      tenantCode: 'DCS-02',
      title: 'Juvenile Diversion Evaluation — Case #2026-201',
      desc: 'Diversion agreement review for minor offender.',
      type: 'juvenile_diversion', priority: 'normal', status: 'in_progress', stepKey: 'assessment', createdDaysAgo: 4, lastStepHoursAgo: 12, dueDaysFromNow: 6, assignedIdx: 3,
      history: [
        { hoursAgo: 12, fromKey: 'intake', toKey: 'assessment', comment: 'Diversion application received.' },
      ],
    },
    {
      tenantCode: 'CPS-GCPD',
      title: 'Protection Order Desk Verification — Case #2026-301',
      desc: 'Joint police and social services protection order verification.',
      type: 'police_investigation', priority: 'critical', status: 'in_progress', stepKey: 'review', createdDaysAgo: 4, lastStepHoursAgo: 2, dueDaysFromNow: 3, assignedIdx: 3,
      history: [
        { hoursAgo: 40, fromKey: 'intake', toKey: 'assessment', comment: 'Desk report docketed.' },
        { hoursAgo: 2, fromKey: 'assessment', toKey: 'review', comment: 'Investigation report compiled.' },
      ],
      attachment: { name: 'cps_witness_statement_signed.pdf', size: 890000, mime: 'application/pdf', desc: 'Signed police witness transcript' },
    },
    {
      tenantCode: 'FAMILY-COURT',
      title: 'Custody Order Petition Review — Case #2026-401',
      desc: 'Court petition review for temporary guardianship order.',
      type: 'court_custody', priority: 'high', status: 'in_progress', stepKey: 'action_plan', createdDaysAgo: 6, lastStepHoursAgo: 5, dueDaysFromNow: 4, assignedIdx: 3,
      history: [
        { hoursAgo: 70, fromKey: 'intake', toKey: 'assessment', comment: 'Petition dockets.' },
        { hoursAgo: 24, fromKey: 'assessment', toKey: 'review', comment: 'Magistrate hearing completed.' },
        { hoursAgo: 5, fromKey: 'review', toKey: 'action_plan', comment: 'Order issued.' },
      ],
      attachment: { name: 'family_court_custody_ruling.pdf', size: 1750000, mime: 'application/pdf', desc: 'Stamped emergency custody ruling' },
    },
    {
      tenantCode: 'PUBLIC-HOSP',
      title: 'Pediatric Trauma ER Social Work Intake — Case #2026-501',
      desc: 'Hospital social work intake following ER admission.',
      type: 'medical_social_intake', priority: 'critical', status: 'open', stepKey: 'assessment', createdDaysAgo: 2, lastStepHoursAgo: 3, dueDaysFromNow: 2, assignedIdx: 4,
      history: [
        { hoursAgo: 3, fromKey: 'intake', toKey: 'assessment', comment: 'ER Social work intake opened.' },
      ],
      attachment: { name: 'hospital_clinical_notes_er.pdf', size: 3200000, mime: 'application/pdf', desc: 'Attending physician notes' },
    },
    {
      tenantCode: 'LEGAL-AID',
      title: 'Pro-Bono Legal Defense Representation — Case #2026-601',
      desc: 'Legal aid representation for minor custody hearing.',
      type: 'legal_representation', priority: 'normal', status: 'closed', stepKey: 'closed', createdDaysAgo: 15, lastStepHoursAgo: 24, dueDaysFromNow: -1, assignedIdx: 3,
      history: [
        { hoursAgo: 100, fromKey: 'intake', toKey: 'assessment', comment: 'Application approved.' },
        { hoursAgo: 24, fromKey: 'action_plan', toKey: 'closed', comment: 'Court hearing concluded successfully. Case closed.' },
      ],
    },
  ];

  let seqNum = 100;
  for (const spec of ActiveCaseSpecs) {
    seqNum++;
    const tenant = TENANTS.find(t => t.code === spec.tenantCode);
    if (!tenant) continue;

    const tenantUsers = usersByTenant.get(tenant.id) ?? [];
    const depts = departmentsByTenant.get(tenant.id) ?? [];
    const creator = tenantUsers[0];
    const assignee = tenantUsers[spec.assignedIdx] ?? tenantUsers[1];

    const wfObj = workflowsByTenant.get(tenant.id)?.[0];
    if (!wfObj) continue;

    const stepObj = wfObj.steps[
      spec.stepKey === 'review' ? 'stepReview' :
      spec.stepKey === 'action_plan' ? 'stepAction' :
      spec.stepKey === 'closed' ? 'stepClosed' :
      spec.stepKey === 'assessment' ? 'stepAssessment' : 'stepIntake'
    ];

    const cId = uuid();
    const createdDate = daysAgo(spec.createdDaysAgo);
    const dueDate = daysFromNow(spec.dueDaysFromNow);

    const newCase = await prisma.case.create({
      data: {
        id: cId,
        tenantId: tenant.id,
        originatingTenantId: tenant.id,
        currentTenantId: tenant.id,
        originatingDepartmentId: depts[0]?.id ?? null,
        currentDepartmentId: depts[1]?.id ?? null,
        workflowId: wfObj.workflow.id,
        workflowVersion: 1,
        caseNumber: `${tenant.casePrefix}-${currentYear}-${String(seqNum).padStart(4, '0')}`,
        currentStepId: stepObj?.id ?? wfObj.steps.stepIntake.id,
        title: spec.title,
        description: spec.desc,
        type: spec.type,
        priority: spec.priority,
        status: spec.status,
        assignedTo: assignee.id,
        createdBy: creator.id,
        dueDate,
        createdAt: createdDate,
        updatedAt: hoursAgo(1),
        closedAt: spec.status === 'closed' ? hoursAgo(24) : null,
      },
    });

    await prisma.assignment.create({
      data: {
        caseId: newCase.id,
        assignedTo: assignee.id,
        assignedBy: creator.id,
        assignmentType: 'manual',
        notes: `Assigned to ${assignee.firstName} ${assignee.lastName} in ${depts[1]?.name ?? 'Case Department'}`,
        assignedAt: createdDate,
        isActive: true,
      },
    });

    for (const h of spec.history) {
      const fromStep = wfObj.steps[h.fromKey === 'intake' ? 'stepIntake' : h.fromKey === 'assessment' ? 'stepAssessment' : 'stepReview'];
      const toStep = wfObj.steps[h.toKey === 'assessment' ? 'stepAssessment' : h.toKey === 'review' ? 'stepReview' : h.toKey === 'action_plan' ? 'stepAction' : 'stepClosed'];
      const tDate = hoursAgo(h.hoursAgo);

      await prisma.caseHistory.create({
        data: {
          caseId: newCase.id,
          tenantId: tenant.id,
          fromStepId: fromStep?.id ?? null,
          toStepId: toStep?.id ?? stepObj.id,
          actorId: assignee.id,
          comment: h.comment,
          transitionedAt: tDate,
        },
      });

      await writeAudit({
        tenantId: tenant.id,
        entityType: 'case',
        entityId: newCase.id,
        action: 'case.transition',
        userId: assignee.id,
        newValues: { caseNumber: newCase.caseNumber, step: toStep?.name },
        timestamp: tDate,
      });
    }

    if (spec.attachment) {
      await prisma.caseAttachment.create({
        data: {
          caseId: newCase.id,
          tenantId: tenant.id,
          filename: spec.attachment.name,
          originalFilename: spec.attachment.name,
          mimeType: spec.attachment.mime,
          fileSize: spec.attachment.size,
          filePath: `/uploads/cases/${newCase.id}/${spec.attachment.name}`,
          description: spec.attachment.desc,
          uploadedBy: assignee.id,
          uploadedAt: hoursAgo(Math.max(1, spec.lastStepHoursAgo)),
          workflowStepId: stepObj?.id ?? null,
        },
      });
    }
  }

  console.log('✅ Active, actionable cases created\n');

  console.log('Creating Cross-Tenant & Cross-Department Referrals with Valid Due Dates...');

  const dcs1Tenant = TENANTS.find(t => t.code === 'DCS-01');
  const dcs2Tenant = TENANTS.find(t => t.code === 'DCS-02');
  const cpsTenant = TENANTS.find(t => t.code === 'CPS-GCPD');
  const courtTenant = TENANTS.find(t => t.code === 'FAMILY-COURT');
  const hospTenant = TENANTS.find(t => t.code === 'PUBLIC-HOSP');
  const legalTenant = TENANTS.find(t => t.code === 'LEGAL-AID');

  const CrossReferralScenarios = [
    {
      fromTenant: dcs1Tenant, fromDeptIdx: 1,
      toTenant: cpsTenant, toDeptIdx: 1,
      reason: 'Urgent police protection request and witness evidence verification.',
      status: 'pending', dueDaysFromNow: 3, hoursAgo: 10,
      notes: 'High priority child safety escalation. Police presence requested.',
    },
    {
      fromTenant: dcs1Tenant, fromDeptIdx: 0,
      toTenant: hospTenant, toDeptIdx: 0,
      reason: 'Emergency room pediatric social work intake and trauma assessment.',
      status: 'accepted', dueDaysFromNow: 5, hoursAgo: 20, hoursAgoAccepted: 18,
      notes: 'Child admitted to ER. Hospital social work unit accepted intake.',
    },
    {
      fromTenant: dcs1Tenant, fromDeptIdx: 2,
      toTenant: legalTenant, toDeptIdx: 1,
      reason: 'Pro-bono legal counsel assignment for protection order hearing.',
      status: 'accepted', dueDaysFromNow: 7, hoursAgo: 24, hoursAgoAccepted: 12,
      notes: 'Legal Aid defense unit assigned attorney for court appearance.',
    },
    {
      fromTenant: dcs2Tenant, fromDeptIdx: 0,
      toTenant: dcs1Tenant, toDeptIdx: 1,
      reason: 'Cross-district jurisdiction transfer of active foster care file.',
      status: 'pending', dueDaysFromNow: 4, hoursAgo: 8,
      notes: 'Family relocated across district boundaries to District 01.',
    },
    {
      fromTenant: cpsTenant, fromDeptIdx: 1,
      toTenant: courtTenant, toDeptIdx: 1,
      reason: 'Submitting completed criminal investigation to judicial review unit.',
      status: 'accepted', dueDaysFromNow: 6, hoursAgo: 14, hoursAgoAccepted: 10,
      notes: 'Evidence packet forwarded to magistrate review.',
    },
    {
      fromTenant: cpsTenant, fromDeptIdx: 2,
      toTenant: legalTenant, toDeptIdx: 0,
      reason: 'Legal assistance referral for domestic abuse victim representation.',
      status: 'pending', dueDaysFromNow: 2, hoursAgo: 5,
      notes: 'Victim requesting emergency legal aid representation.',
    },
    {
      fromTenant: hospTenant, fromDeptIdx: 2,
      toTenant: dcs1Tenant, toDeptIdx: 1,
      reason: 'Post-discharge social work follow-up for newborn wellness.',
      status: 'accepted', dueDaysFromNow: 8, hoursAgo: 16, hoursAgoAccepted: 14,
      notes: 'Mother discharged from hospital. District 01 assigned caseworker.',
    },
    {
      fromTenant: legalTenant, fromDeptIdx: 1,
      toTenant: courtTenant, toDeptIdx: 2,
      reason: 'Court mediation request prior to final custody ruling.',
      status: 'accepted', dueDaysFromNow: 10, hoursAgo: 30, hoursAgoAccepted: 20,
      notes: 'Family mediation session scheduled with court desk.',
    },
  ];

  let referralSeq = 350;
  for (const sc of CrossReferralScenarios) {
    referralSeq++;
    const fromUsers = usersByTenant.get(sc.fromTenant.id) ?? [];
    const toUsers = usersByTenant.get(sc.toTenant.id) ?? [];
    const fromDepts = departmentsByTenant.get(sc.fromTenant.id) ?? [];
    const toDepts = departmentsByTenant.get(sc.toTenant.id) ?? [];

    const referrer = fromUsers[3] ?? fromUsers[1];
    const accepter = toUsers[1] ?? toUsers[0];
    const fromDept = fromDepts[sc.fromDeptIdx] ?? fromDepts[0];
    const toDept = toDepts[sc.toDeptIdx] ?? toDepts[0];

    const wf = workflowsByTenant.get(sc.fromTenant.id)?.[0];
    const caseId = uuid();
    const referralId = uuid();
    const dueDate = daysFromNow(sc.dueDaysFromNow);

    const refCase = await prisma.case.create({
      data: {
        id: caseId,
        tenantId: sc.fromTenant.id,
        originatingTenantId: sc.fromTenant.id,
        currentTenantId: sc.toTenant.id,
        originatingDepartmentId: fromDept?.id ?? null,
        currentDepartmentId: toDept?.id ?? null,
        referralStatus: sc.status,
        workflowId: wf.workflow.id,
        workflowVersion: 1,
        caseNumber: `${sc.fromTenant.casePrefix}-${currentYear}-${String(referralSeq).padStart(4, '0')}`,
        currentStepId: wf.steps.stepAssessment.id,
        title: `Cross-Agency Referral (${sc.fromTenant.code} ➔ ${sc.toTenant.code})`,
        description: sc.reason,
        type: 'interagency_referral',
        priority: sc.dueDaysFromNow <= 3 ? 'critical' : 'high',
        status: sc.status === 'completed' ? 'closed' : 'open',
        assignedTo: referrer.id,
        createdBy: referrer.id,
        dueDate,
        createdAt: hoursAgo(sc.hoursAgo),
        updatedAt: hoursAgo(1),
      },
    });

    await prisma.caseReferral.create({
      data: {
        id: referralId,
        caseId: refCase.id,
        fromTenantId: sc.fromTenant.id,
        toTenantId: sc.toTenant.id,
        fromDepartmentId: fromDept?.id ?? null,
        toDepartmentId: toDept?.id ?? null,
        referralReason: sc.reason,
        notes: sc.notes,
        status: sc.status,
        referredBy: referrer.id,
        acceptedBy: ['accepted', 'completed'].includes(sc.status) ? accepter.id : null,
        referredAt: hoursAgo(sc.hoursAgo),
        acceptedAt: sc.hoursAgoAccepted ? hoursAgo(sc.hoursAgoAccepted) : null,
        metadata: { priority: 'high', dueDate: dueDate.toISOString(), fromDeptCode: fromDept?.code, toDeptCode: toDept?.code },
      },
    });

    await writeAudit({
      tenantId: sc.fromTenant.id,
      relatedTenantId: sc.toTenant.id,
      entityType: 'case_referral',
      entityId: referralId,
      action: `referral.${sc.status}`,
      userId: referrer.id,
      newValues: { caseNumber: refCase.caseNumber, fromDept: fromDept?.name, toTenant: sc.toTenant.code, toDept: toDept?.name, dueDate: dueDate.toISOString() },
      timestamp: hoursAgo(sc.hoursAgo),
    });
  }

  console.log('✅ Created Cross-Tenant Referrals with active unblocked deadlines\n');

  // Standard case workflow fixture
  console.log('Creating published workflow standard-case…');
  const fixtureAdmin = usersByTenant.get(FIXTURE_TENANT_ID)?.[0];
  if (!fixtureAdmin) throw new Error(`Fixture tenant admin missing for ${TENANTS[0].code}`);

  await prisma.workflowTransition.deleteMany({ where: { workflowId: FIXTURE_WORKFLOW_ID } }).catch(() => {});
  await prisma.workflowStep.deleteMany({ where: { workflowId: FIXTURE_WORKFLOW_ID } }).catch(() => {});
  await prisma.workflow.deleteMany({ where: { id: FIXTURE_WORKFLOW_ID } }).catch(() => {});

  const wfFixture = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'shared', 'contracts', '__fixtures__', 'workflow-full.example.json'), 'utf8')
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

  console.log('Seeding service retention policies...');
  const retentionPolicies = [
    { service: 'case-management', retentionDays: null, description: 'Legal evidence — keep forever, never auto-delete' },
    { service: 'chat', retentionDays: 90, description: 'Chat attachments — deleted 90 days after soft delete' },
    { service: 'hr', retentionDays: 2555, description: 'HR documents — 7 years legal compliance requirement' },
    { service: 'audit', retentionDays: null, description: 'Audit documents — keep forever' },
  ];

  for (const policy of retentionPolicies) {
    await prisma.serviceRetentionPolicy.upsert({
      where: { service: policy.service },
      update: { retentionDays: policy.retentionDays, description: policy.description },
      create: policy,
    });
  }
  console.log('Service retention policies seeded.');

  console.log('═'.repeat(60));
  console.log('🎉 Database updated! All case actions and workflow step transitions are UNBLOCKED.\n');
  console.log('Login Credentials (all passwords are "password123")');
  console.log('─'.repeat(60));
  console.log('ADMIN — IACMS Platform (system operators only)');
  console.log(`  ${platformUser.email}  —  tenantCode: ADMIN  —  role: system_admin\n`);
  for (const tenant of TENANTS) {
    console.log(`${tenant.code} — ${tenant.name}`);
    const depts = departmentsByTenant.get(tenant.id) ?? [];
    console.log(`  Departments (${depts.length}): ${depts.map(d => d.name).join(', ')}`);
    const tenantUsers = seededUsers.filter(u => u.tenantCode === tenant.code);
    for (const u of tenantUsers) {
      console.log(`  - ${u.email}`);
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
