import express from 'express';
import * as store from '../services/notification.store.js';
import { VAPID_PUBLIC_KEY } from '../config/webpush.js';

const router = express.Router();

/**
 * GET /notifications
 * Retrieve notifications and unread count for the authenticated user.
 */
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'x-user-id header or userId query required' });
    }

    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const unreadOnly = req.query.unreadOnly === 'true';

    const result = await store.getUserNotifications(userId, { limit, unreadOnly });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /notifications or POST /notifications/internal
 * Create and dispatch a new in-app notification & web push.
 */
async function handleCreateNotification(req, res, next) {
  try {
    const { recipientId, type, title, body, data } = req.body || {};
    if (!recipientId) {
      return res.status(400).json({ error: 'recipientId is required' });
    }

    const notification = await store.createNotification({
      recipientId,
      type,
      title,
      body,
      data,
    });

    res.status(201).json(notification);
  } catch (err) {
    next(err);
  }
}

router.post('/', handleCreateNotification);
router.post('/internal', handleCreateNotification);

/**
 * PATCH /notifications/read-all
 * Mark all notifications as read for current user.
 */
router.patch('/read-all', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] || req.body?.userId;
    if (!userId) {
      return res.status(400).json({ error: 'x-user-id header required' });
    }

    await store.markAllAsRead(userId);
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /notifications/:id/read
 * Mark a single notification as read.
 */
router.patch('/:id/read', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] || req.body?.userId;
    const notificationId = req.params.id;
    if (!userId || !notificationId) {
      return res.status(400).json({ error: 'x-user-id and notification id required' });
    }

    await store.markAsRead(userId, notificationId);
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /notifications/vapid-public-key
 * Get VAPID public key for Web Push subscription setup.
 */
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

/**
 * POST /notifications/push-subscription
 * Register or update browser push subscription for desktop notifications.
 */
router.post('/push-subscription', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'] || req.body?.userId;
    const { subscription } = req.body || {};

    if (!userId) {
      return res.status(400).json({ error: 'x-user-id header required' });
    }
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'valid push subscription required' });
    }

    await store.savePushSubscription(userId, subscription);
    res.json({ success: true, message: 'Push subscription saved' });
  } catch (err) {
    next(err);
  }
});

export default router;
