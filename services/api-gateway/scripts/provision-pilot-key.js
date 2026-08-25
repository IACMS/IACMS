import { PrismaClient } from '@prisma/client';
import { generateApiKey } from '../src/services/apiKey.service.js';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Phase 1: Pilot Partner Key Provisioning ---');
  
  // Find a tenant to use for the pilot (e.g. the first active tenant)
  const tenant = await prisma.tenant.findFirst({
    where: { isActive: true }
  });
  
  if (!tenant) {
    console.error('No active tenant found in the database. Please seed the database first.');
    process.exit(1);
  }

  // Find an admin user to attribute the key creation to
  const user = await prisma.user.findFirst({
    where: { tenantId: tenant.id }
  });

  if (!user) {
    console.error(`No user found for tenant ${tenant.name}.`);
    process.exit(1);
  }

  const name = 'Phase 1 Pilot Partner';
  const scopes = ['cases:read', 'referrals:read', 'workflows:read'];
  
  // Set expiration to 90 days from now
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  console.log(`Provisioning API Key for Tenant: ${tenant.name}`);
  console.log(`Scopes: ${scopes.join(', ')}`);
  console.log(`Expires At: ${expiresAt.toISOString()}`);
  
  try {
    const keyData = await generateApiKey(
      tenant.id,
      name,
      scopes,
      expiresAt,
      user.id
    );
    
    console.log('\n✅ Successfully provisioned API Key!');
    console.log('----------------------------------------------------');
    console.log(`Key Name   : ${keyData.name}`);
    console.log(`Key Prefix : ${keyData.keyPrefix}`);
    console.log(`Key ID     : ${keyData.keyId}`);
    console.log('----------------------------------------------------');
    console.log(`RAW KEY    : ${keyData.rawKey}`);
    console.log('----------------------------------------------------');
    console.log('⚠️  Store this RAW KEY securely. It will not be shown again.');
    
  } catch (error) {
    console.error('Failed to generate API Key:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
