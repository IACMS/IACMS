import { Client } from 'minio';
import config from './index.js';

let minioClient = null;

export function getMinioClient() {
  if (!minioClient) {
    minioClient = new Client({
      endPoint: config.storage.minio.endPoint,
      port: config.storage.minio.port,
      useSSL: config.storage.minio.useSSL,
      accessKey: config.storage.minio.accessKey,
      secretKey: config.storage.minio.secretKey,
    });
  }
  return minioClient;
}

export async function ensureBucketExists() {
  const client = getMinioClient();
  const bucket = config.storage.minio.bucket;
  try {
    const exists = await client.bucketExists(bucket);
    if (!exists) {
      await client.makeBucket(bucket);
      console.log(`File Service: MinIO bucket '${bucket}' created`);
    } else {
      console.log(`File Service: MinIO bucket '${bucket}' already exists`);
    }
  } catch (err) {
    console.error(`File Service: Failed to ensure MinIO bucket '${bucket}':`, err.message);
    throw err;
  }
}
