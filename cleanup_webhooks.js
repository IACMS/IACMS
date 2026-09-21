import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup() {
  const WEBHOOK_URL = 'https://webhook.site/dbd80d49-8b72-40dd-9a82-c96eea14dd7a';
  
  try {
    const result = await prisma.webhook.deleteMany({
      where: { url: WEBHOOK_URL }
    });
    console.log(`🧹 Cleaned up ${result.count} duplicate webhooks from the database!`);
  } catch (err) {
    console.error('Error cleaning up:', err);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();
