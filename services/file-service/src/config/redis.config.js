import Redis from 'ioredis';
import config from './index.js';

let redisClient = null;

export function getRedisClient() {
  if (!redisClient) {
    redisClient = new Redis(config.redis.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
    });

    redisClient.on('error', (err) => {
      console.warn('File Service: Redis connection error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('File Service: Redis connected');
    });
  }
  return redisClient;
}

export async function closeRedisClient() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
