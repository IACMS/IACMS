/**
 * Webhook Service
 *
 * Manages webhook subscription CRUD and payload signing for partner integrations.
 * Webhooks are scoped to a tenant. Delivery and retry logic lives in webhookDispatcher.js.
 *
 * HMAC signing: every delivered payload carries an `X-IACMS-Signature-256` header
 * computed as HMAC-SHA256(secret, raw JSON body). Partners verify this to confirm
 * the payload originated from this platform.
 */

import crypto from 'node:crypto';
import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';

/** All events a webhook can subscribe to. */
export const SUPPORTED_EVENTS = [
  'case.created',
  'case.status_changed',
  'case.closed',
  'referral.created',
  'referral.accepted',
  'referral.rejected',
  'referral.completed',
  'assignment.created',
  'assignment.removed',
];

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Create a new webhook subscription for a tenant.
 * A random 32-byte secret is generated and returned once — it is stored as-is
 * so partners can verify HMAC signatures. Treat it like a private key.
 */
export async function createWebhook(tenantId, { name, url, events, createdBy }) {
  validateEvents(events);
  validateUrl(url);

  const secret = crypto.randomBytes(32).toString('hex');

  const webhook = await prisma.webhook.create({
    data: {
      tenantId,
      name: name.trim(),
      url,
      secret,
      events,
      isActive: true,
      createdBy,
    },
    select: webhookSelectPublic,
  });

  return { webhook, secret };
}

/** List all webhooks for a tenant (secret is NOT returned in list). */
export async function listWebhooks(tenantId) {
  return prisma.webhook.findMany({
    where: { tenantId },
    select: webhookSelectPublic,
    orderBy: { createdAt: 'desc' },
  });
}

/** Get a single webhook. Returns null if not found or tenant mismatch. */
export async function getWebhook(id, tenantId) {
  return prisma.webhook.findFirst({
    where: { id, tenantId },
    select: webhookSelectPublic,
  });
}

/** Update a webhook's name, url, events, or active status. */
export async function updateWebhook(id, tenantId, updates) {
  const existing = await prisma.webhook.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('Webhook');

  if (updates.events) validateEvents(updates.events);
  if (updates.url) validateUrl(updates.url);

  return prisma.webhook.update({
    where: { id },
    data: {
      ...(updates.name    !== undefined && { name:     updates.name.trim() }),
      ...(updates.url     !== undefined && { url:      updates.url }),
      ...(updates.events  !== undefined && { events:   updates.events }),
      ...(updates.isActive !== undefined && { isActive: updates.isActive }),
    },
    select: webhookSelectPublic,
  });
}

/** Permanently delete a webhook subscription. */
export async function deleteWebhook(id, tenantId) {
  const existing = await prisma.webhook.findFirst({ where: { id, tenantId } });
  if (!existing) throw new NotFoundError('Webhook');
  await prisma.webhook.delete({ where: { id } });
}

// ── Signing ───────────────────────────────────────────────────────────────────

/**
 * Compute the HMAC-SHA256 signature for a webhook payload.
 * Format: `sha256=<hex digest>` — matches GitHub/Stripe convention.
 */
export function signPayload(secret, rawBody) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  return `sha256=${hmac.digest('hex')}`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Fields returned to API consumers — secret is excluded. */
const webhookSelectPublic = {
  id: true,
  name: true,
  url: true,
  events: true,
  isActive: true,
  retryCount: true,
  timeoutMs: true,
  createdAt: true,
  updatedAt: true,
};

function validateEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new ValidationError('At least one event type is required.');
  }
  const invalid = events.filter((e) => !SUPPORTED_EVENTS.includes(e));
  if (invalid.length > 0) {
    throw new ValidationError(
      `Unsupported event types: ${invalid.join(', ')}. Supported: ${SUPPORTED_EVENTS.join(', ')}`
    );
  }
}

function validateUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new ValidationError('Webhook URL must use http or https.');
    }
  } catch {
    throw new ValidationError('Webhook URL is not a valid URL.');
  }
}
