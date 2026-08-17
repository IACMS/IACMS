import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const commonEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5434/iacms?schema=public',
  JWT_SECRET: process.env.JWT_SECRET || 'change-this-secret-key-in-production-use-openssl-rand-base64-32',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  KAFKA_BROKERS: process.env.KAFKA_BROKERS || 'localhost:9092',
  STORAGE_PROVIDER: 'minio',
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: '9000',
  MINIO_ACCESS_KEY: 'minioadmin',
  MINIO_SECRET_KEY: 'minioadmin',
  MINIO_BUCKET: 'iacms-files',
  MINIO_USE_SSL: 'false',
  WORKER_MODE: 'embedded',
  IAM_SERVICE_URL: 'http://localhost:3001',
  AUTH_SERVICE_URL: 'http://localhost:3001',
  RBAC_SERVICE_URL: 'http://localhost:3001',
  CASE_ENGINE_SERVICE_URL: 'http://localhost:3003',
  CASE_SERVICE_URL: 'http://localhost:3003',
  WORKFLOW_SERVICE_URL: 'http://localhost:3003',
  REFERRAL_SERVICE_URL: 'http://localhost:3003',
  AUDIT_SERVICE_URL: 'http://localhost:3006',
  INTEGRATION_SERVICE_URL: 'http://localhost:3007',
  NOTIFICATION_SERVICE_URL: 'http://localhost:3008',
  FILE_SERVICE_URL: 'http://localhost:3009',
};

const services = [
  { name: 'iam-service', dir: 'services/iam-service', port: 3001 },
  { name: 'case-engine-service', dir: 'services/case-engine-service', port: 3003 },
  { name: 'audit-service', dir: 'services/audit-service', port: 3006 },
  { name: 'integration-service', dir: 'services/integration-service', port: 3007 },
  { name: 'notification-service', dir: 'services/notification-service', port: 3008 },
  { name: 'file-service', dir: 'services/file-service', port: 3009 },
  { name: 'api-gateway', dir: 'services/api-gateway', port: 3000 },
];

const children = [];

for (const svc of services) {
  const svcPath = path.join(rootDir, svc.dir);
  const child = spawn('node', ['src/server.js'], {
    cwd: svcPath,
    env: { ...commonEnv, PORT: String(svc.port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => {
    process.stdout.write(`[${svc.name}] ${d}`);
  });

  child.stderr.on('data', (d) => {
    process.stderr.write(`[${svc.name} ERR] ${d}`);
  });

  child.on('exit', (code, sig) => {
    console.log(`[${svc.name}] exited with code ${code} signal ${sig}`);
  });

  children.push(child);
  console.log(`Started ${svc.name} on :${svc.port} (PID ${child.pid})`);
}

process.on('SIGINT', () => {
  console.log('Shutting down all microservices...');
  children.forEach((c) => c.kill('SIGTERM'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down all microservices...');
  children.forEach((c) => c.kill('SIGTERM'));
  process.exit(0);
});
