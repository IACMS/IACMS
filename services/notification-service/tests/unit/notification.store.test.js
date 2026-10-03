import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as store from '../../src/services/notification.store.js';

vi.mock('../../src/config/redis.js', () => {
  const map = new Map();
  const sets = new Map();
  const strings = new Map();

  return {
    redis: {
      lpush: vi.fn(async (key, val) => {
        const list = map.get(key) || [];
        list.unshift(val);
        map.set(key, list);
        return list.length;
      }),
      ltrim: vi.fn(async (key, start, end) => {
        const list = map.get(key) || [];
        map.set(key, list.slice(start, end + 1));
      }),
      incr: vi.fn(async (key) => {
        const current = parseInt(strings.get(key) || '0', 10) + 1;
        strings.set(key, String(current));
        return current;
      }),
      decr: vi.fn(async (key) => {
        const current = Math.max(0, parseInt(strings.get(key) || '0', 10) - 1);
        strings.set(key, String(current));
        return current;
      }),
      lrange: vi.fn(async (key, start, end) => {
        const list = map.get(key) || [];
        if (end === -1) return list.slice(start);
        return list.slice(start, end + 1);
      }),
      get: vi.fn(async (key) => strings.get(key) || null),
      set: vi.fn(async (key, val) => strings.set(key, String(val))),
      sadd: vi.fn(async (key, val) => {
        const s = sets.get(key) || new Set();
        s.add(val);
        sets.set(key, s);
        return 1;
      }),
      smembers: vi.fn(async (key) => Array.from(sets.get(key) || [])),
      pipeline: vi.fn(() => ({
        del: vi.fn(),
        rpush: vi.fn((key, ...vals) => map.set(key, vals)),
        decr: vi.fn(),
        set: vi.fn((key, val) => strings.set(key, String(val))),
        exec: vi.fn(async () => []),
      })),
      on: vi.fn(),
    },
    redisPub: {
      publish: vi.fn(async () => 1),
      on: vi.fn(),
    },
    redisSub: {
      on: vi.fn(),
    },
  };
});

vi.mock('../../src/config/webpush.js', () => ({
  default: {
    sendNotification: vi.fn(async () => ({ statusCode: 201 })),
  },
  VAPID_PUBLIC_KEY: 'test-public-key',
  VAPID_PRIVATE_KEY: 'test-private-key',
  VAPID_SUBJECT: 'mailto:test@test.com',
}));

describe('Notification Store', () => {
  const userId = 'user-abc-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and stores notification', async () => {
    const notif = await store.createNotification({
      recipientId: userId,
      type: 'CHAT_MESSAGE',
      title: 'Hello',
      body: 'World',
      data: { conversationId: 'c1' },
    });

    expect(notif).toBeDefined();
    expect(notif.recipientId).toBe(userId);
    expect(notif.title).toBe('Hello');
    expect(notif.body).toBe('World');
    expect(notif.isRead).toBe(false);
  });

  it('retrieves user notifications and unread count', async () => {
    const res = await store.getUserNotifications(userId);
    expect(res).toBeDefined();
    expect(Array.isArray(res.notifications)).toBe(true);
    expect(typeof res.unreadCount).toBe('number');
  });

  it('saves push subscription', async () => {
    const res = await store.savePushSubscription(userId, {
      endpoint: 'https://push.example.com/sub/1',
      keys: { p256dh: 'key1', auth: 'auth1' },
    });

    expect(res.success).toBe(true);
  });

  it('marks notification as read', async () => {
    const notif = await store.createNotification({
      recipientId: userId,
      type: 'CHAT_MESSAGE',
      title: 'Read Me',
      body: 'Content',
    });

    const res = await store.markAsRead(userId, notif.id);
    expect(res.success).toBe(true);
  });

  it('marks all notifications as read', async () => {
    const res = await store.markAllAsRead(userId);
    expect(res.success).toBe(true);
  });
});
