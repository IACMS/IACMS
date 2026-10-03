import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const redisPub = new Redis(redisUrl);
export const redisSub = new Redis(redisUrl);

redis.on('error', (err) => console.warn('[notification-service] Redis error:', err.message));
redisPub.on('error', (err) => console.warn('[notification-service] Redis Pub error:', err.message));
redisSub.on('error', (err) => console.warn('[notification-service] Redis Sub error:', err.message));
