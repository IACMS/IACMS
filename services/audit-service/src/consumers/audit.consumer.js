/**
 * Audit Log Consumer
 *
 * Handles audit.log Kafka events and persists them to the AuditLog table.
 * Payload shape (produced by auth-service controllers):
 *   { tenantId, entityType, entityId, action, userId, metadata }
 */

import prisma from '../config/database.js';
import Logger from '../../../shared/common/logger.js';

const logger = new Logger('audit-service');

/**
 * Persist an audit event to the database.
 *
 * Unknown tenantId / userId references are tolerated — the audit-service uses
 * shadow Tenant/User models that only carry the PK, so any valid UUID that
 * exists in the shared DB will resolve the FK without issue. If a FK violation
 * occurs (e.g. tenant not yet replicated) we log a warning instead of crashing.
 */
export async function handleAuditLog(data) {
  const { tenantId, entityType, entityId, action, userId, metadata } = data || {};

  if (!tenantId || !entityType || !entityId || !action) {
    logger.warn('Ignoring malformed audit event', { data });
    return;
  }

  try {
    await prisma.auditLog.create({
      data: {
        tenantId,
        entityType,
        entityId,
        action,
        userId: userId || null,
        metadata: metadata || {},
      },
    });

    logger.info('Audit log persisted', { action, entityType, entityId });
  } catch (error) {
    logger.error('Failed to persist audit log', { action, entityType, error: error.message });
  }
}
