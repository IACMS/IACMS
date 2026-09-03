/**
 * Webhook Dispatcher Worker
 *
 * Polls the AuditOutbox for partner_api mutation events and dispatches
 * them to all matching active webhooks for the corresponding tenant.
 *
 * Flow:
 *   1. Poll AuditOutbox for published partner_api records that haven't
 *      been webhook-dispatched yet.
 *   2. Map the mutation action → webhook event name.
 *   3. Load active webhooks for the tenant that subscribe to that event.
 *   4. Deliver signed HTTP POST to each webhook URL with retry logic.
 *
 * Delivery guarantees: at-least-once. The outbox record is marked dispatched
 * only after all webhooks for that event have been attempted (success or
 * exhausted retries). Transient failures retry up to the webhook's retryCount.
 *
 * This worker runs inside the api-gateway process alongside outboxPublisher.js
 * because the Webhook model lives in the shared Prisma schema and the gateway
 * is the system's single integration boundary.
 */

import prisma from '../config/database.js';
import { signPayload } from '../services/webhook.service.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('webhook-dispatcher');

const POLL_INTERVAL_MS = Number(process.env.WEBHOOK_POLL_INTERVAL_MS || 6000);
const DELIVERY_TIMEOUT_MS = 15_000;

/** Maps partner_api mutation actions to webhook event names. */
const ACTION_TO_EVENT = {
  createCase:        'case.created',
  executeTransition: 'case.status_changed',
  createReferral:    'referral.created',
};

let intervalId = null;

// ── Main poll loop ────────────────────────────────────────────────────────────

async function dispatchPendingWebhooks() {
  try {
    // Find outbox records from the partner_api that:
    //   - have been published to Kafka (i.e. processed by outboxPublisher)
    //   - haven't been dispatched to webhooks yet
    const records = await prisma.auditOutbox.findMany({
      where: {
        published: true,
        webhookDispatched: false,
        payload: { path: ['source'], equals: 'partner_api' },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    if (records.length === 0) return;

    for (const record of records) {
      await dispatchRecord(record);
    }
  } catch (err) {
    logger.error('Webhook dispatcher poll error', { error: err.message });
  }
}

async function dispatchRecord(record) {
  const payload = record.payload;
  const action = payload?.action;
  const tenantId = record.tenantId;
  const eventName = ACTION_TO_EVENT[action];

  if (!eventName) {
    // Unknown action — mark as dispatched so we don't keep retrying it
    await markDispatched(record.id);
    return;
  }

  // Load webhooks that subscribe to this event for this tenant
  const webhooks = await prisma.webhook.findMany({
    where: {
      tenantId,
      isActive: true,
      events: { array_contains: eventName },
    },
  });

  if (webhooks.length === 0) {
    await markDispatched(record.id);
    return;
  }

  // Build the delivery payload
  const deliveryBody = JSON.stringify({
    event: eventName,
    tenantId,
    requestId: payload.requestId,
    timestamp: payload.timestamp || new Date().toISOString(),
    data: payload.result?.data ?? payload.data ?? {},
  });

  // Deliver to all webhooks concurrently (each with its own retry)
  await Promise.allSettled(
    webhooks.map((wh) => deliverWithRetry(wh, deliveryBody, eventName))
  );

  await markDispatched(record.id);
}

// ── Delivery with retry ───────────────────────────────────────────────────────

async function deliverWithRetry(webhook, rawBody, eventName) {
  const maxAttempts = Math.max(1, webhook.retryCount ?? 3);
  const timeoutMs   = webhook.timeoutMs ?? DELIVERY_TIMEOUT_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await deliver(webhook, rawBody, timeoutMs);
      logger.info('Webhook delivered', {
        webhookId: webhook.id,
        event: eventName,
        attempt,
        url: webhook.url,
      });
      return; // success
    } catch (err) {
      const isLast = attempt === maxAttempts;
      logger.warn('Webhook delivery failed', {
        webhookId: webhook.id,
        event: eventName,
        attempt,
        maxAttempts,
        error: err.message,
        willRetry: !isLast,
      });
      if (!isLast) {
        // Exponential backoff: 1s, 2s, 4s…
        await sleep(1000 * Math.pow(2, attempt - 1));
      }
    }
  }
}

async function deliver(webhook, rawBody, timeoutMs) {
  const signature = signPayload(webhook.secret, rawBody);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IACMS-Signature-256': signature,
        'X-IACMS-Event': rawBody ? JSON.parse(rawBody).event : '',
        'User-Agent': 'IACMS-Webhook/1.0',
      },
      body: rawBody,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function markDispatched(outboxId) {
  await prisma.auditOutbox.update({
    where: { id: outboxId },
    data: { webhookDispatched: true, webhookDispatchedAt: new Date() },
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Lifecycle exports ─────────────────────────────────────────────────────────

export function startWebhookDispatcher() {
  intervalId = setInterval(dispatchPendingWebhooks, POLL_INTERVAL_MS);
  logger.info('Webhook dispatcher started', { pollIntervalMs: POLL_INTERVAL_MS });
}

export function stopWebhookDispatcher() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  logger.info('Webhook dispatcher stopped');
}
