import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testWebhook() {
  const WEBHOOK_URL = 'https://webhook.site/dbd80d49-8b72-40dd-9a82-c96eea14dd7a';
  
  try {
    console.log('1. Fetching a Tenant...');
    const tenant = await prisma.tenant.findFirst();
    
    if (!tenant) {
      throw new Error('No tenant found in the database. Please ensure you have seeded your database.');
    }
    console.log(`   Found Tenant: ${tenant.id} (${tenant.name})`);

    console.log('\n2. Registering the Webhook in the database...');
    const webhook = await prisma.webhook.create({
      data: {
        tenantId: tenant.id,
        name: 'Webhook.site Test Receiver - All Events',
        url: WEBHOOK_URL,
        secret: 'test_secret_signature_key',
        // Subscribing to all three supported events
        events: ['case.created', 'case.status_changed', 'referral.created'], 
        isActive: true,
      }
    });
    console.log(`   Webhook created successfully! ID: ${webhook.id}`);

    console.log('\n3. Triggering test events in AuditOutbox...');

    // Event 1: case.created (Triggered by 'createCase' action)
    const event1 = await prisma.auditOutbox.create({
      data: {
        tenantId: tenant.id,
        published: true, 
        webhookDispatched: false,
        payload: {
          source: 'partner_api',
          action: 'createCase',
          requestId: `req-case-${Date.now()}`,
          timestamp: new Date().toISOString(),
          data: { caseNumber: 'CASE-TEST-001', title: 'Webhook Test Case', status: 'open' }
        }
      }
    });
    console.log(`   ✅ Triggered 'case.created' (Outbox ID: ${event1.id})`);

    // Event 2: case.status_changed (Triggered by 'executeTransition' action)
    const event2 = await prisma.auditOutbox.create({
      data: {
        tenantId: tenant.id,
        published: true, 
        webhookDispatched: false,
        payload: {
          source: 'partner_api',
          action: 'executeTransition',
          requestId: `req-status-${Date.now()}`,
          timestamp: new Date().toISOString(),
          data: { caseNumber: 'CASE-TEST-001', oldStatus: 'open', newStatus: 'in_progress' }
        }
      }
    });
    console.log(`   ✅ Triggered 'case.status_changed' (Outbox ID: ${event2.id})`);

    // Event 3: referral.created (Triggered by 'createReferral' action)
    const event3 = await prisma.auditOutbox.create({
      data: {
        tenantId: tenant.id,
        published: true, 
        webhookDispatched: false,
        payload: {
          source: 'partner_api',
          action: 'createReferral',
          requestId: `req-ref-${Date.now()}`,
          timestamp: new Date().toISOString(),
          data: { caseNumber: 'CASE-TEST-001', referredTo: 'Department B', reason: 'Needs specialized review' }
        }
      }
    });
    console.log(`   ✅ Triggered 'referral.created' (Outbox ID: ${event3.id})`);

    console.log('\n🎉 Done! The Webhook Dispatcher should pick all 3 of these up within 6 seconds.');
    console.log(`   Check your dashboard at: ${WEBHOOK_URL} to see the payloads arrive.`);
    
  } catch (error) {
    console.error('❌ Error during setup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testWebhook();
