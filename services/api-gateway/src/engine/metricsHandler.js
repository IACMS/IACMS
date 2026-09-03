import prisma from '../config/database.js';
import { InvalidQueryError } from '../../../../shared/common/errors.js';
import { writeAuditRecord } from './auditWriter.js';
import { getAllowlist } from './allowlists/index.js';

export async function executeMetricsQuery(query, context) {
  const { tenantId, apiKeyId, sourceIp, requestId } = context;
  const { select } = query;
  
  const allowlist = getAllowlist('metrics');
  const selectedFields = select && select.length > 0 ? select : allowlist.selectableFields;

  // Validate fields against allowlist
  for (const field of selectedFields) {
    if (!allowlist.selectableFields.includes(field)) {
      throw new InvalidQueryError(`Field "${field}" is not selectable on metrics`);
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const data = {};
    const promises = [];
     
    if (selectedFields.includes('totalCases')) {
      promises.push(
        tx.case.count({ where: { tenantId, deletedAt: null } })
          .then(c => { data.totalCases = c; })
      );
    }
    
    if (selectedFields.includes('openCases')) {
      promises.push(
        tx.case.count({ where: { tenantId, status: 'open', deletedAt: null } })
          .then(c => { data.openCases = c; })
      );
    }
    
    if (selectedFields.includes('closedCases')) {
      promises.push(
        tx.case.count({ where: { tenantId, status: 'closed', deletedAt: null } })
          .then(c => { data.closedCases = c; })
      );
    }
    
    if (selectedFields.includes('overdueCount')) {
      promises.push(
        tx.case.count({ 
          where: { 
            tenantId, 
            status: 'open', 
            deletedAt: null, 
            dueDate: { lt: new Date() } 
          } 
        }).then(c => { data.overdueCount = c; })
      );
    }
    
    if (selectedFields.includes('avgResolutionDays')) {
      promises.push(
        tx.$queryRaw`
          SELECT AVG(EXTRACT(EPOCH FROM (closed_at - created_at))/86400) as "avgDays"
          FROM "Case" 
          WHERE tenant_id = ${tenantId}::uuid AND closed_at IS NOT NULL AND deleted_at IS NULL
        `.then(res => {
          data.avgResolutionDays = res[0]?.avgDays ? parseFloat(parseFloat(res[0].avgDays).toFixed(2)) : 0;
        })
      );
    }
     
    await Promise.all(promises);

    // Write audit record for this query
    await writeAuditRecord(tx, {
      tenantId, 
      apiKeyId, 
      operation: 'query', 
      entity: 'metrics',
      action: null, 
      select: selectedFields, 
      filter: null, 
      sourceIp, 
      requestId,
      resultCount: 1,
    });
     
    return data;
  });

  return {
    success: true,
    data: [result],
    pagination: {
      total: 1,
      limit: 1,
      offset: 0,
      hasMore: false,
    },
    // The executionTimeMs will be measured and added by queryDispatcher,
    // but we'll include requestId here for consistency.
    meta: {
      requestId,
    },
  };
}
