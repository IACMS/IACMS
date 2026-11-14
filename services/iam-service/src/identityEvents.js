import crypto from 'node:crypto';
import { Kafka, logLevel } from 'kafkajs';
import prisma from './config/database.js';
import Logger from '#iam/iamLogger.js';
import { legacyOrganizationSystem } from './legacyOrganizationSystem.js';

const logger = new Logger('iam-identity-events');
const legacyTopic = process.env.IAM_IDENTITY_EVENTS_TOPIC || 'iam.identity.events.v1';
const topicPrefix = process.env.IAM_IDENTITY_EVENTS_TOPIC_PREFIX || 'iam.identity.events';
const kafka = new Kafka({
  clientId: 'iam-identity-outbox',
  brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map((value) => value.trim()).filter(Boolean),
  logLevel: logLevel.WARN,
});
const producer = kafka.producer();
let publishing = false;
let connected = false;

function topicForSystem(externalSystem) {
  const legacySystem = legacyOrganizationSystem();
  if (!externalSystem || externalSystem === legacySystem) return legacyTopic;
  const topicSystem = String(externalSystem).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!topicSystem) throw new Error('Invalid externalSystem for identity event routing');
  return `${topicPrefix}.${topicSystem}.v1`;
}

/** Queue one credential-free identity event for each mapped consumer project. */
export async function enqueueIdentitySnapshot(subjectId, eventType = 'upsert', db = prisma) {
  if (process.env.IAM_IDENTITY_OUTBOX_ENABLED !== 'true') return null;
  if (!subjectId) return null;
  const user = await db.user.findUnique({
    where: { id: subjectId },
    select: {
      id: true, tenantId: true, email: true, username: true, phone: true,
      firstName: true, lastName: true, isActive: true, updatedAt: true,
      organizationMemberships: {
        select: {
          status: true,
          organization: { select: { id: true, externalSystem: true, externalId: true, isActive: true } },
        },
      },
    },
  });
  if (!user) return null;

  const destinations = new Map();
  const legacySystem = legacyOrganizationSystem();
  if (user.tenantId && legacySystem) {
    destinations.set(`${legacySystem}:${user.tenantId}`, {
      externalSystem: legacySystem,
      externalId: user.tenantId,
      organizationId: null,
      tenantId: user.tenantId,
      isActive: user.isActive,
    });
  }
  for (const membership of user.organizationMemberships || []) {
    const organization = membership.organization;
    if (!organization?.externalSystem || !organization.externalId) continue;
    if (organization.externalSystem !== legacySystem) continue;
    destinations.set(`${organization.externalSystem}:${organization.externalId}`, {
      externalSystem: organization.externalSystem,
      externalId: organization.externalId,
      organizationId: organization.id,
      tenantId: organization.externalId,
      isActive: user.isActive && membership.status === 'active' && organization.isActive,
    });
  }

  if (!destinations.size) return null;

  return Promise.all([...destinations.values()].map((destination) => db.identityEventOutbox.create({
    data: {
      eventId: crypto.randomUUID(),
      subjectId: user.id,
      eventType,
      payload: {
        subjectId: user.id,
        ...destination,
        email: user.email,
        username: user.username,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: destination.isActive,
        sourceUpdatedAt: user.updatedAt.toISOString(),
      },
    },
  })));
}

/** Publish queued project identity events in sequence and mark after Kafka acks. */
export async function publishPendingIdentityEvents() {
  if (publishing) return;
  publishing = true;
  try {
    if (!connected) {
      await producer.connect();
      connected = true;
    }
    const rows = await prisma.identityEventOutbox.findMany({
      where: { publishedAt: null },
      orderBy: { sequence: 'asc' },
      take: 50,
    });
    for (const row of rows) {
      const event = {
        eventId: row.eventId,
        sequence: row.sequence.toString(),
        type: row.eventType,
        subjectId: row.subjectId,
        occurredAt: row.createdAt.toISOString(),
        identity: row.payload,
      };
      const eventTopic = topicForSystem(row.payload?.externalSystem);
      try {
        await producer.send({
          topic: eventTopic,
          messages: [{
            key: row.subjectId,
            value: JSON.stringify({ type: eventTopic, data: event, timestamp: event.occurredAt, serviceId: 'iam-service' }),
          }],
        });
        await prisma.identityEventOutbox.update({
          where: { eventId: row.eventId },
          data: { publishedAt: new Date(), attempts: { increment: 1 }, lastError: null },
        });
      } catch (error) {
        await prisma.identityEventOutbox.update({
          where: { eventId: row.eventId },
          data: { attempts: { increment: 1 }, lastError: String(error.message).slice(0, 2000) },
        }).catch(() => {});
        logger.warn('Identity event publish failed; event remains queued', { eventId: row.eventId, error: error.message });
        break;
      }
    }
  } catch (error) {
    logger.warn('Identity outbox delivery unavailable; queued events will retry', { error: error.message });
    if (connected) {
      await producer.disconnect().catch(() => {});
      connected = false;
    }
  } finally {
    publishing = false;
  }
}

export function startIdentityEventPublisher() {
  if (process.env.IAM_IDENTITY_OUTBOX_ENABLED !== 'true') return async () => {};
  const interval = setInterval(() => { publishPendingIdentityEvents(); }, Number(process.env.IAM_IDENTITY_OUTBOX_POLL_MS || 2000));
  interval.unref?.();
  publishPendingIdentityEvents();
  return async () => {
    clearInterval(interval);
    if (connected) await producer.disconnect().catch(() => {});
    connected = false;
  };
}

export const identityEventsTopic = legacyTopic;
