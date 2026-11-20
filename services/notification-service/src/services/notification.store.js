import { redis, redisPub } from '../config/redis.js';
import webpush from '../config/webpush.js';

const NOTIFICATIONS_PREFIX = 'notifications:';
const UNREAD_PREFIX = 'notifications:unread:';
const PUSH_SUBS_PREFIX = 'push:subs:';
const MAX_NOTIFICATIONS = 100;

export async function createNotification({ recipientId, type, title, body, data }) {
  if (!recipientId) throw new Error('recipientId is required');

  const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const notification = {
    id,
    recipientId,
    type: type || 'CHAT_MESSAGE',
    title: title || 'New Notification',
    body: body || '',
    data: data || {},
    isRead: false,
    createdAt: new Date().toISOString(),
  };

  try {
    const listKey = `${NOTIFICATIONS_PREFIX}${recipientId}`;
    const unreadKey = `${UNREAD_PREFIX}${recipientId}`;

    // 1. Store in Redis
    await redis.lpush(listKey, JSON.stringify(notification));
    await redis.ltrim(listKey, 0, MAX_NOTIFICATIONS - 1);
    await redis.incr(unreadKey);

    // 2. Publish to Redis Pub/Sub for real-time WebSocket delivery
    await redisPub.publish(
      'chat:pubsub',
      JSON.stringify({
        type: 'NOTIFICATION_CREATED',
        data: {
          recipientId,
          notificationId: notification.id,
          notificationType: notification.type,
          title: notification.title,
          body: notification.body,
          data: notification.data,
          createdAt: notification.createdAt,
        },
      })
    );

    // 3. Dispatch Web Push (Desktop Notifications) if subscriptions exist
    await dispatchWebPush(recipientId, notification);
  } catch (err) {
    console.error('[notification-store] Failed to save or dispatch notification:', err.message);
  }

  return notification;
}

export async function getUserNotifications(userId, { limit = 20, unreadOnly = false } = {}) {
  if (!userId) return { unreadCount: 0, notifications: [] };

  const listKey = `${NOTIFICATIONS_PREFIX}${userId}`;
  const unreadKey = `${UNREAD_PREFIX}${userId}`;

  try {
    const [rawItems, unreadStr] = await Promise.all([
      redis.lrange(listKey, 0, 99),
      redis.get(unreadKey),
    ]);

    let items = (rawItems || []).map((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    }).filter(Boolean);

    if (unreadOnly) {
      items = items.filter((n) => !n.isRead);
    }

    const unreadCount = Math.max(0, parseInt(unreadStr || '0', 10));

    return {
      unreadCount,
      notifications: items.slice(0, limit),
    };
  } catch (err) {
    console.error('[notification-store] Failed to read user notifications:', err.message);
    return { unreadCount: 0, notifications: [] };
  }
}

export async function markAsRead(userId, notificationId) {
  if (!userId || !notificationId) return { success: false };

  const listKey = `${NOTIFICATIONS_PREFIX}${userId}`;
  const unreadKey = `${UNREAD_PREFIX}${userId}`;

  try {
    const rawItems = await redis.lrange(listKey, 0, -1);
    let changed = false;

    const updated = (rawItems || []).map((s) => {
      try {
        const item = JSON.parse(s);
        if (item.id === notificationId && !item.isRead) {
          item.isRead = true;
          changed = true;
        }
        return JSON.stringify(item);
      } catch {
        return s;
      }
    });

    if (changed) {
      const pipeline = redis.pipeline();
      pipeline.del(listKey);
      if (updated.length > 0) {
        pipeline.rpush(listKey, ...updated);
      }
      pipeline.decr(unreadKey);
      await pipeline.exec();

      // Ensure unread doesn't drop below 0
      const currentUnread = await redis.get(unreadKey);
      if (parseInt(currentUnread || '0', 10) < 0) {
        await redis.set(unreadKey, '0');
      }
    }

    return { success: true };
  } catch (err) {
    console.error('[notification-store] Failed to mark notification as read:', err.message);
    return { success: false };
  }
}

export async function markAllAsRead(userId) {
  if (!userId) return { success: false };

  const listKey = `${NOTIFICATIONS_PREFIX}${userId}`;
  const unreadKey = `${UNREAD_PREFIX}${userId}`;

  try {
    const rawItems = await redis.lrange(listKey, 0, -1);
    const updated = (rawItems || []).map((s) => {
      try {
        const item = JSON.parse(s);
        item.isRead = true;
        return JSON.stringify(item);
      } catch {
        return s;
      }
    });

    const pipeline = redis.pipeline();
    pipeline.del(listKey);
    if (updated.length > 0) {
      pipeline.rpush(listKey, ...updated);
    }
    pipeline.set(unreadKey, '0');
    await pipeline.exec();

    return { success: true };
  } catch (err) {
    console.error('[notification-store] Failed to mark all as read:', err.message);
    return { success: false };
  }
}

export async function savePushSubscription(userId, subscription) {
  if (!userId || !subscription || !subscription.endpoint) return { success: false };

  const subsKey = `${PUSH_SUBS_PREFIX}${userId}`;
  try {
    await redis.sadd(subsKey, JSON.stringify(subscription));
    return { success: true };
  } catch (err) {
    console.error('[notification-store] Failed to save push subscription:', err.message);
    return { success: false };
  }
}

async function dispatchWebPush(recipientId, notification) {
  const subsKey = `${PUSH_SUBS_PREFIX}${recipientId}`;
  try {
    const rawSubs = await redis.smembers(subsKey);
    if (!rawSubs || rawSubs.length === 0) return;

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: {
        notificationId: notification.id,
        type: notification.type,
        url: notification.data?.conversationId
          ? `/chat?conv=${notification.data.conversationId}`
          : '/chat',
        ...notification.data,
      },
    });

    for (const raw of rawSubs) {
      try {
        const sub = JSON.parse(raw);
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription expired or unregistered by browser
          await redis.srem(subsKey, raw);
        } else {
          console.warn('[notification-store] WebPush delivery error:', err.message);
        }
      }
    }
  } catch (err) {
    console.warn('[notification-store] Error in dispatchWebPush:', err.message);
  }
}
