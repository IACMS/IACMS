import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Main redis client for generic operations (cache, presence)
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Pub/sub requires separate connections
export const redisPub = new Redis(redisUrl);
export const redisSub = new Redis(redisUrl);

redis.on('error', (err) => console.error('[chat-service] Redis error:', err));
redisPub.on('error', (err) => console.error('[chat-service] Redis Pub error:', err));
redisSub.on('error', (err) => console.error('[chat-service] Redis Sub error:', err));
