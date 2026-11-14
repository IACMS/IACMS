import EventBus from '../../../../shared/utils/eventBus.js';
import prisma from '../config/database.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('iam-identity-projection');

const topic = process.env.IAM_IDENTITY_EVENTS_TOPIC || 'iam.identity.events.v1';
const consumerExternalSystem = process.env.IACMS_EXTERNAL_SYSTEM_ID || 'iacms';
const groupId = process.env.IACMS_IDENTITY_PROJECTION_GROUP || 'iacms-identity-projection-v1';
let eventBus;
let reconciliationTimer;
let reconciling = false;

export async function projectIdentity(event) {
  if (!event?.eventId || !event?.subjectId || !event?.identity) {
    throw new Error('Malformed IAM identity event');
  }
  const identity = event.identity;
  if (identity.subjectId !== event.subjectId || !event.sequence) {
    throw new Error('IAM identity event is missing its subject or sequence');
  }
  if (identity.externalSystem && identity.externalSystem !== consumerExternalSystem) return;
  // Global IAM identities without an IACMS organization membership have no
  // IACMS-local projection yet. Membership-specific projection events will
  // carry the mapped tenant ID once that membership is provisioned.
  if (!identity.tenantId) return;

  const sourceVersion = BigInt(event.sequence);
  const key = { subjectId_tenantId: { subjectId: identity.subjectId, tenantId: identity.tenantId } };
  const current = await prisma.identityProjection.findUnique({ where: key });
  if (current && current.sourceVersion >= sourceVersion) return;

  const data = {
    email: identity.email,
    username: identity.username,
    phone: identity.phone ?? null,
    firstName: identity.firstName,
    lastName: identity.lastName,
    isActive: identity.isActive,
    sourceVersion,
    sourceUpdatedAt: identity.sourceUpdatedAt ? new Date(identity.sourceUpdatedAt) : null,
    deletedAt: event.type === 'deleted' ? new Date(event.occurredAt) : null,
    projectedAt: new Date(),
  };
  await prisma.identityProjection.upsert({
    where: key,
    create: {
      subjectId: identity.subjectId,
      tenantId: identity.tenantId,
      ...data,
    },
    update: data,
  });
}

export async function projectSnapshot(identity) {
  if (!identity?.subjectId || !identity?.tenantId) throw new Error('Malformed IAM identity snapshot');
  const key = { subjectId_tenantId: { subjectId: identity.subjectId, tenantId: identity.tenantId } };
  const current = await prisma.identityProjection.findUnique({ where: key });
  const sourceUpdatedAt = identity.sourceUpdatedAt ? new Date(identity.sourceUpdatedAt) : null;
  if (current?.sourceUpdatedAt && sourceUpdatedAt && current.sourceUpdatedAt >= sourceUpdatedAt) return;
  const sourceVersion = current?.sourceVersion ?? 0n;
  const data = {
    email: identity.email,
    username: identity.username,
    phone: identity.phone ?? null,
    firstName: identity.firstName,
    lastName: identity.lastName,
    isActive: identity.isActive,
    sourceVersion,
    sourceUpdatedAt,
    deletedAt: null,
    projectedAt: new Date(),
  };
  await prisma.identityProjection.upsert({
    where: key,
    create: { subjectId: identity.subjectId, tenantId: identity.tenantId, ...data },
    update: data,
  });
}

export async function reconcileIdentityProjection() {
  if (reconciling) return;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  const iamBaseUrl = (process.env.IAM_SERVICE_URL || process.env.AUTH_SERVICE_URL || 'http://localhost:3001').replace(/\/$/, '');
  if (!internalToken) throw new Error('INTERNAL_SERVICE_TOKEN is required for identity reconciliation');
  reconciling = true;
  try {
    let cursor = null;
    do {
      const url = new URL(`${iamBaseUrl}/internal/identities/snapshot`);
      url.searchParams.set('limit', '500');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await fetch(url, {
        headers: { 'x-internal-service-token': internalToken, accept: 'application/json' },
        signal: AbortSignal.timeout(Number(process.env.IAM_API_TIMEOUT_MS || 5000)),
      });
      if (!response.ok) throw new Error(`IAM snapshot returned HTTP ${response.status}`);
      const page = await response.json();
      for (const identity of page.users || []) await projectSnapshot(identity);
      cursor = page.nextCursor || null;
    } while (cursor);
  } finally {
    reconciling = false;
  }
}

export async function startIdentityProjectionConsumer() {
  if (process.env.IACMS_IDENTITY_PROJECTION_CONSUMER_ENABLED !== 'true') return;
  eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', groupId);
  await eventBus.subscribe(topic, projectIdentity);
  void reconcileIdentityProjection().catch((error) => logger.warn('Initial IAM identity reconciliation failed', { error: error.message }));
  reconciliationTimer = setInterval(() => {
    reconcileIdentityProjection().catch((error) => logger.warn('IAM identity reconciliation failed', { error: error.message }));
  }, Number(process.env.IACMS_IDENTITY_RECONCILE_INTERVAL_MS || 300000));
  reconciliationTimer.unref?.();
  logger.info('IAM identity projection consumer enabled', { topic, groupId });
}

export async function stopIdentityProjectionConsumer() {
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  reconciliationTimer = null;
  if (eventBus) await eventBus.close();
  eventBus = null;
}
