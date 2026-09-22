/**
 * Webhook Routes
 *
 * REST endpoints for tenant admins to manage webhook subscriptions.
 * All routes require a human session (same guard as api-keys routes) —
 * API keys cannot manage webhooks.
 *
 * Routes:
 *   POST   /api/v1/webhooks           — create subscription
 *   GET    /api/v1/webhooks           — list subscriptions
 *   GET    /api/v1/webhooks/:id       — get single subscription
 *   PATCH  /api/v1/webhooks/:id       — update (name/url/events/isActive)
 *   DELETE /api/v1/webhooks/:id       — delete subscription
 *   GET    /api/v1/webhooks/events    — list supported event types
 */

import express from 'express';
import {
  createWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  SUPPORTED_EVENTS,
} from '../services/webhook.service.js';
import { ForbiddenError, NotFoundError } from '../../../../shared/common/errors.js';

const router = express.Router();

/** Middleware: block API-key callers — only human sessions may manage webhooks. */
function requireHumanSession(req, res, next) {
  if (req.apiKeyContext) {
    return next(new ForbiddenError('Webhook management requires a user session, not an API key.'));
  }
  if (!req.user) {
    return next(new ForbiddenError('Authentication required.'));
  }
  next();
}

// Apply session guard to all routes in this router
router.use(requireHumanSession);

// ── GET /events ───────────────────────────────────────────────────────────────
// Must be defined before /:id to avoid 'events' being treated as an ID param

router.get('/events', (_req, res) => {
  res.json({ events: SUPPORTED_EVENTS });
});

// ── POST / — create webhook ───────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { name, url, events } = req.body;
    const tenantId  = req.user.tenantId;
    const createdBy = req.user.id;

    const { webhook, secret } = await createWebhook(tenantId, { name, url, events, createdBy });

    // Secret is returned ONLY on creation — never again
    return res.status(201).json({
      webhook,
      secret,
      warning: 'Store this secret securely — it will not be shown again. Use it to verify X-IACMS-Signature-256 on incoming payloads.',
    });
  } catch (err) {
    next(err);
  }
});

// ── GET / — list webhooks ─────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const webhooks = await listWebhooks(req.user.tenantId);
    return res.json({ webhooks });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id — get single webhook ─────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const webhook = await getWebhook(req.params.id, req.user.tenantId);
    if (!webhook) return next(new NotFoundError('Webhook'));
    return res.json({ webhook });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /:id — update webhook ───────────────────────────────────────────────

router.patch('/:id', async (req, res, next) => {
  try {
    const { name, url, events, isActive } = req.body;
    const webhook = await updateWebhook(req.params.id, req.user.tenantId, {
      name, url, events, isActive,
    });
    return res.json({ webhook });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /:id — delete webhook ──────────────────────────────────────────────

router.delete('/:id', async (req, res, next) => {
  try {
    await deleteWebhook(req.params.id, req.user.tenantId);
    return res.json({ success: true, message: 'Webhook subscription deleted.' });
  } catch (err) {
    next(err);
  }
});

export default router;
