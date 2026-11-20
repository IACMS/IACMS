/**
 * Audit consumer handles audit.log Kafka events and persists them to the AuditLog table.
 * Drops malformed payloads without crashing the consumer loop.
 */

import prisma from '../config/database.js';
import Logger from '../../../../shared/common/logger.js';
import { validateAuditKafkaPayload } from '../utils/event-validator.js';

const logger = new Logger('audit-service');

export async function handleAuditLog(data) {
  const check = validateAuditKafkaPayload(data);
  if (check !== true) {
    logger.warn('Ignoring malformed audit event', { reason: check, data });
    return;
  }

  const {
    tenantId,
    relatedTenantId,
    entityType,
    entityId,
    action,
    userId,
    oldValues,
    newValues,
    metadata,
    ipAddress,
    userAgent,
  } = data || {};

  try {
    await prisma.auditLog.create({
      data: {
        tenantId,
        relatedTenantId: relatedTenantId || null,
        entityType,
        entityId,
        action,
        userId: userId || null,
        oldValues: oldValues ?? null,
        newValues: newValues ?? null,
        metadata: metadata || {},
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      },
    });

    logger.info('Audit log persisted', { action, entityType, entityId });
  } catch (error) {
    logger.error('Failed to persist audit log', { action, entityType, error: error.message });
  }
}
