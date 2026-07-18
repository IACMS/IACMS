import { PrismaClient } from '../generated/prisma/client.js';
import config from './index.js';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/iacms?schema=public';
}

const prisma = new PrismaClient({
  log: config.nodeEnv === 'development' ? ['error', 'warn'] : ['error'],
});

prisma.$connect()
  .then(() => console.log('File Service: Database connection established'))
  .catch((err) => console.error('File Service: Database connection failed:', err.message));

export default prisma;
