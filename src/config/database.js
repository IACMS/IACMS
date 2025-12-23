import { PrismaClient } from '@prisma/client';
import config from './config.js';

// Construct DATABASE_URL if not set in env
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `postgresql://${config.database.user}:${config.database.password}@${config.database.host}:${config.database.port}/${config.database.name}?schema=public`;
}

// Create Prisma Client instance
const prisma = new PrismaClient({
  log: config.env === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Helper to set tenant context for RLS
export async function setTenantContext(tenantId, userId = null) {
  await prisma.$executeRaw`SET LOCAL app.current_tenant_id = ${tenantId}`;
  if (userId) {
    await prisma.$executeRaw`SET LOCAL app.current_user_id = ${userId}`;
  }
}

// Helper to set super admin context (bypasses RLS)
export async function setSuperAdminContext() {
  await prisma.$executeRaw`SET LOCAL app.is_super_admin = true`;
}

// Test database connection
prisma.$connect()
  .then(() => {
    console.log('Database connection established');
  })
  .catch(err => {
    console.error('Database connection failed:', err);
  });

export default prisma;
