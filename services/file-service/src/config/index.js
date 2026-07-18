import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const config = {
  port: parseInt(process.env.PORT || '3009', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  workerMode: process.env.WORKER_MODE || 'embedded',

  storage: {
    provider: process.env.STORAGE_PROVIDER || 'local',
    minio: {
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
      bucket: process.env.MINIO_BUCKET || 'iacms-files',
    },
    local: {
      basePath: process.env.LOCAL_STORAGE_PATH || './uploads',
    },
  },

  upload: {
    maxSizeBytes: parseInt(process.env.MAX_UPLOAD_SIZE_MB || '1024', 10) * 1024 * 1024,
    blockedExtensions: (process.env.BLOCKED_EXTENSIONS || '.exe,.sh,.bat,.cmd,.ps1,.vbs,.scr,.pif,.com').split(','),
  },

  virusScan: {
    enabled: process.env.VIRUS_SCAN_ENABLED === 'true',
    host: process.env.CLAMAV_HOST || 'localhost',
    port: parseInt(process.env.CLAMAV_PORT || '3310', 10),
  },

  thumbnail: {
    enabled: process.env.THUMBNAIL_ENABLED !== 'false',
    sizes: (process.env.THUMBNAIL_SIZES || '100,250,500').split(',').map(Number),
  },

  compression: {
    image: {
      enabled: process.env.COMPRESSION_IMAGE_ENABLED !== 'false',
      format: process.env.COMPRESSION_IMAGE_FORMAT || 'webp',
      quality: parseInt(process.env.COMPRESSION_IMAGE_QUALITY || '80', 10),
    },
    video: {
      enabled: process.env.COMPRESSION_VIDEO_ENABLED === 'true',
    },
  },

  retention: {
    defaultSoftDeleteDays: parseInt(process.env.DEFAULT_SOFT_DELETE_DAYS || '30', 10),
  },

  chunk: {
    maxChunkSizeBytes: parseInt(process.env.MAX_CHUNK_SIZE_MB || '10', 10) * 1024 * 1024,
    ttlHours: parseInt(process.env.CHUNK_TTL_HOURS || '24', 10),
  },

  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    groupId: process.env.KAFKA_GROUP_ID || 'file-service',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'iacms-dev-secret-key-change-in-production',
    authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  },
};

export default config;
