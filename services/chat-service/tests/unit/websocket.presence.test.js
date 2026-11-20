import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setOnline,
  setOffline,
  isOnline,
  getBulkPresence,
  setActiveConversation,
  getActiveConversation,
} from '../../src/websocket/presence.js';
import { redis } from '../../src/config/redis.js';

vi.mock('../../src/config/redis.js', () => {
  return {
    redis: {
      setex: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
      exists: vi.fn(),
      get: vi.fn(),
      pipeline: vi.fn(),
    },
  };
});

describe('WebSocket Presence Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('setOnline: should set user presence key with TTL', async () => {
    await setOnline('user-1');
    expect(redis.setex).toHaveBeenCalledWith(
      'chat:presence:user-1',
      120,
      expect.any(String)
    );
  });

  it('setOffline: should delete user presence key', async () => {
    await setOffline('user-1');
    expect(redis.del).toHaveBeenCalledWith('chat:presence:user-1');
  });

  it('isOnline: should return true when key exists in redis', async () => {
    redis.exists.mockResolvedValueOnce(1);
    const online = await isOnline('user-1');
    expect(online).toBe(true);

    redis.exists.mockResolvedValueOnce(0);
    const offline = await isOnline('user-2');
    expect(offline).toBe(false);
  });

  it('getBulkPresence: should query pipeline and return presence Map', async () => {
    const mockPipeline = {
      exists: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValueOnce([
        [null, 1], // user-1 is online
        [null, 0], // user-2 is offline
      ]),
    };
    redis.pipeline.mockReturnValueOnce(mockPipeline);

    const presenceMap = await getBulkPresence(['user-1', 'user-2']);
    expect(presenceMap.get('user-1')).toBe(true);
    expect(presenceMap.get('user-2')).toBe(false);
  });

  it('setActiveConversation & getActiveConversation: should store and retrieve active room', async () => {
    await setActiveConversation('user-1', 'conv-100');
    expect(redis.setex).toHaveBeenCalledWith('chat:user_convos:user-1:active', 120, 'conv-100');

    await setActiveConversation('user-1', null);
    expect(redis.del).toHaveBeenCalledWith('chat:user_convos:user-1:active');

    redis.get.mockResolvedValueOnce('conv-100');
    const active = await getActiveConversation('user-1');
    expect(active).toBe('conv-100');
  });
});
