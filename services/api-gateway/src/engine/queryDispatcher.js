import prisma from '../config/database.js';
import { buildPrismaQuery } from './queryBuilder.js';
import { serializeResults } from './responseSerializer.js';
import { writeAuditRecord } from './auditWriter.js';
import { getAllowlist } from './allowlists/index.js';
import { InvalidQueryError } from '../../../../shared/common/errors.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('query-engine:dispatcher');

export async function executeQuery(query, context) {
  const { tenantId, apiKeyId, sourceIp, requestId } = context;
  const { entity, select, filter, sort, pagination } = query;
  const startTime = Date.now();

  const allowlist = getAllowlist(entity);

  // Virtual entities (like metrics) need special handling
  if (allowlist.isVirtual) {
    if (entity === 'metrics') {
      const { executeMetricsQuery } = await import('./metricsHandler.js');
      const result = await executeMetricsQuery(query, context);
      
      const executionTimeMs = Date.now() - startTime;
      logger.info('Virtual Query executed', { entity, tenantId, resultCount: 1, executionTimeMs, requestId });
      
      result.meta = { ...result.meta, executionTimeMs };
      return result;
    }
    throw new InvalidQueryError(`Entity "${entity}" is not yet available for querying`);
  }

  // Build Prisma query with tenant scoping
  const { prismaModel, args, countArgs } = buildPrismaQuery(query, tenantId);

  // Execute query and count in a transaction with audit
  const result = await prisma.$transaction(async (tx) => {
    const [data, total] = await Promise.all([
      tx[prismaModel].findMany(args),
      tx[prismaModel].count(countArgs),
    ]);

    // Write audit record within the same transaction
    await writeAuditRecord(tx, {
      tenantId, apiKeyId, operation: 'query', entity,
      action: null, select, filter, sourceIp, requestId,
      resultCount: data.length,
    });

    return { data, total };
  });

  const executionTimeMs = Date.now() - startTime;
  const limit = pagination?.limit ?? 20;
  const offset = pagination?.offset ?? 0;

  logger.info('Query executed', { entity, tenantId, resultCount: result.data.length, executionTimeMs, requestId });

  return {
    success: true,
    data: serializeResults(result.data, select),
    pagination: {
      total: result.total,
      limit,
      offset,
      hasMore: offset + limit < result.total,
    },
    meta: {
      executionTimeMs,
      requestId,
    },
  };
}
