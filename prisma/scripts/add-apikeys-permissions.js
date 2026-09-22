/**
 * One-off migration: insert the 4 apiKeys permissions and assign them
 * to the tenant_admin role.
 *
 * Safe to run on a live database — it skips rows that already exist.
 *
 * Usage:
 *   cd /home/e/code/IACMS/Current/IACMS
 *   node prisma/scripts/add-apikeys-permissions.js
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROLE_TENANT_ADMIN_ID = '55555555-5555-5555-5555-555555555555';

const NEW_PERMISSIONS = [
  { resource: 'apiKeys', action: 'create', description: 'Create partner API keys' },
  { resource: 'apiKeys', action: 'read',   description: 'List partner API keys' },
  { resource: 'apiKeys', action: 'revoke', description: 'Revoke partner API keys' },
  { resource: 'apiKeys', action: 'rotate', description: 'Rotate partner API keys' },
];

async function main() {
  console.log('🔑 Inserting apiKeys permissions...\n');

  for (const perm of NEW_PERMISSIONS) {
    // upsert — safe to re-run
    const permission = await prisma.permission.upsert({
      where: { resource_action: { resource: perm.resource, action: perm.action } },
      update: {},
      create: perm,
    });
    console.log(`  ✓ Permission: ${perm.resource}:${perm.action} (id: ${permission.id})`);

    // Assign to tenant_admin if not already assigned
    const existing = await prisma.rolePermission.findFirst({
      where: { roleId: ROLE_TENANT_ADMIN_ID, permissionId: permission.id },
    });

    if (!existing) {
      await prisma.rolePermission.create({
        data: { roleId: ROLE_TENANT_ADMIN_ID, permissionId: permission.id },
      });
      console.log(`    → Assigned to tenant_admin`);
    } else {
      console.log(`    → Already assigned to tenant_admin, skipped`);
    }
  }

  console.log('\n✅ Done. Flush the RBAC Redis cache to apply immediately:');
  console.log('   redis-cli -n 0 KEYS "rbac:perms:*" | xargs redis-cli DEL\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
