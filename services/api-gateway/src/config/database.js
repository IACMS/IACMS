import { PrismaClient } from '../generated/prisma/index.js';
import logger from '../../../../shared/common/logger.js';

const prisma = new PrismaClient();

process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received: closing Prisma Client.');
  await prisma.$disconnect();
  process.exit(0);
});

export default prisma;
