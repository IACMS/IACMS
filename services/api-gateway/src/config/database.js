import { PrismaClient } from '../generated/prisma/index.js';
import logger from '../../../../shared/common/logger.js';

const prisma = new PrismaClient();

// The restricted Prisma Client that connects as partner_api
export const prismaPartner = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_PARTNER || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5434/iacms?schema=public',
    },
  },
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing Prisma Clients.');
  await Promise.all([
    prisma.$disconnect(),
    prismaPartner.$disconnect()
  ]);
  process.exit(0);
});

export default prisma;
