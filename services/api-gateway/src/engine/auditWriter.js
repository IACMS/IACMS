import Logger from '../../../../shared/common/logger.js';
const logger = new Logger('query-engine:audit');

export async function writeAuditRecord(tx, { tenantId, apiKeyId, operation, entity, action, select, filter, sourceIp, requestId, resultCount }) {
  try {
    await tx.auditOutbox.create({
      data: {
        tenantId,
        payload: {
          source: 'partner_api',
          apiKeyId,
          operation,
          entity: entity || null,
          action: action || null,
          select: select || null,
          filter: filter || null,
          resultCount: resultCount ?? null,
          sourceIp,
          requestId,
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (err) {
    // Audit write failure MUST break the request to enforce the transactional outbox pattern
    // and prevent silent gaps in the compliance trail.
    logger.error('Failed to write audit outbox record', { error: err.message, requestId });
    throw err;
  }
}
