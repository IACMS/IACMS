import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Phase 1: API Key Audit Monitor ---');
  
  // Get all published audit events from the last 24 hours
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const audits = await prisma.auditOutbox.findMany({
    where: {
      createdAt: { gte: yesterday }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (audits.length === 0) {
    console.log('No API requests found in the last 24 hours.');
    process.exit(0);
  }

  let totalRequests = 0;
  let errorCount = 0;
  const requestsPerKey = {};
  let crossTenantIncidents = 0;

  for (const audit of audits) {
    const payload = typeof audit.payload === 'string' ? JSON.parse(audit.payload) : audit.payload;
    
    // Check if it's an API Key request (has apiKeyId)
    if (!payload.apiKeyId) continue;
    
    totalRequests++;
    
    // Tally by key
    if (!requestsPerKey[payload.apiKeyId]) {
      requestsPerKey[payload.apiKeyId] = 0;
    }
    requestsPerKey[payload.apiKeyId]++;
    
    // Check for errors (assuming errors are logged with a status >= 400 in the payload)
    if (payload.status >= 400) {
      errorCount++;
    }
    
    // Cross-tenant verification (assuming the engine logs requested tenant id vs actual)
    if (payload.requestedTenantId && payload.requestedTenantId !== audit.tenantId) {
      crossTenantIncidents++;
    }
  }

  console.log(`Total API Key Requests (24h) : ${totalRequests}`);
  console.log(`Error Rate (4xx/5xx)         : ${errorCount} errors`);
  console.log(`Cross-Tenant Incidents       : ${crossTenantIncidents}`);
  
  console.log('\nUsage by API Key:');
  for (const [keyId, count] of Object.entries(requestsPerKey)) {
    console.log(`- Key ID ${keyId}: ${count} requests`);
  }
  
  if (crossTenantIncidents > 0) {
    console.error('\n🚨 ALARM: Cross-tenant data exposure attempt detected!');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
