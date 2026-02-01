import { PrismaClient } from '@prisma/client';

// Construct DATABASE_URL if not set in env
if (!process.env.DATABASE_URL) {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    name: process.env.DB_NAME || 'iacms',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
  
  process.env.DATABASE_URL = `postgresql://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.name}?schema=public`;
}

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Test connection
prisma.$connect()
  .then(() => {
    console.log('Auth Service: Database connection established');
  })
  .catch(err => {
    console.error('Auth Service: Database connection failed:', err);
  });

export default prisma;

