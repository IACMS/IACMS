/**
 * Shared Query Resolver Helper
 *
 * Wraps the existing queryDispatcher + queryBuilder pipeline so that
 * GraphQL query resolvers are thin pass-throughs. All filtering, tenant
 * scoping, cost calculation, and auditing logic is preserved.
 */
import { buildPrismaQuery } from '../../engine/queryBuilder.js';

import { writeAuditRecord } from '../../engine/auditWriter.js';
import { getAllowlist } from '../../engine/allowlists/index.js';
import { executeMetricsQuery } from '../../engine/metricsHandler.js';
import crypto from 'node:crypto';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('graphql:query-resolver');

/**
 * Translates GraphQL input filter objects into the flat filter format
 * understood by the existing queryBuilder.js.
 *
 * GraphQL:  { status: { eq: "open" } }
 * Engine:   { status: { eq: "open" } }   (same shape — pass-through)
 */
function normaliseFilter(filter) {
  if (!filter) return undefined;
  const out = {};
  for (const [field, value] of Object.entries(filter)) {
    if (value === null || value === undefined) continue;
    out[field] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Translates GraphQL sort object into the engine's sort format.
 * GraphQL:  { createdAt: "desc" }
 * Engine:   { createdAt: "desc" }   (same shape)
 */
function normaliseSort(sort) {
  if (!sort) return undefined;
  const out = {};
  for (const [field, dir] of Object.entries(sort)) {
    if (dir) out[field] = dir;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Build a flat list of selected fields from the GraphQL info object.
 * GraphQL selects fields natively; we derive the allowlist-compatible
 * select array so we can reuse queryBuilder.js for Prisma query construction.
 *
 * For a query like: { cases { data { id title assignee { firstName } } } }
 * We produce: ['id', 'title', 'assignee.firstName']
 */
function extractSelectFromInfo(info, entityType) {
  try {
    const dataField = info.fieldNodes[0]?.selectionSet?.selections?.find(
      (s) => s.kind === 'Field' && s.name.value === 'data',
    );
    if (!dataField?.selectionSet) return ['id'];
    return flattenSelections(dataField.selectionSet.selections, '');
  } catch {
    return ['id'];
  }
}

function flattenSelections(selections, prefix) {
  const fields = [];
  for (const sel of selections) {
    if (sel.kind !== 'Field') continue;
    const name = sel.name.value;
    if (name.startsWith('__')) continue;
    const full = prefix ? `${prefix}.${name}` : name;
    if (sel.selectionSet) {
      fields.push(...flattenSelections(sel.selectionSet.selections, full));
    } else {
      fields.push(full);
    }
  }
  return fields.length > 0 ? fields : ['id'];
}

/**
 * Generic entity query executor — used by all entity resolvers except metrics.
 *
 * @param {string} entity  - Entity name (e.g. 'cases', 'workflows')
 * @param {object} args    - Raw GraphQL resolver args { filter, sort, pagination }
 * @param {object} context - GraphQL context (tenantId, prisma, apiKeyId, etc.)
 * @param {object} info    - GraphQL ResolveInfo (field selection)
 */
export async function executeEntityQuery(entity, args, context, info) {
  const { tenantId, apiKeyId, sourceIp, prisma } = context;
  const requestId = context.requestId ?? `gql_${crypto.randomBytes(5).toString('hex')}`;
  const startTime = Date.now();

  // Extract select from GraphQL selection (or fall back to all selectable fields)
  const allowlist = getAllowlist(entity);
  let select = extractSelectFromInfo(info, entity);

  // Ensure 'id' is always in select (queryBuilder requires it)
  if (!select.includes('id')) select = ['id', ...select];

  // Only keep selectable fields (drop __typename etc. that sneak through)
  const topLevelSelectable = new Set(allowlist.selectableFields);
  const relationNames = allowlist.relations ? Object.keys(allowlist.relations) : [];
  select = select.filter((f) => {
    const top = f.split('.')[0];
    return topLevelSelectable.has(top) || relationNames.includes(top);
  });
  if (select.length === 0) select = ['id'];

  const query = {
    entity,
    select,
    filter: normaliseFilter(args.filter),
    sort: normaliseSort(args.sort),
    pagination: args.pagination ?? { limit: 20, offset: 0 },
  };

  const { prismaModel, args: prismaArgs, countArgs } = buildPrismaQuery(query, tenantId);

  const result = await prisma.$transaction(async (tx) => {
    // Inject tenant context for RLS
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}::text, true)`;

    const [data, total] = await Promise.all([
      tx[prismaModel].findMany(prismaArgs),
      tx[prismaModel].count(countArgs),
    ]);

    await writeAuditRecord(tx, {
      tenantId, apiKeyId, operation: 'query', entity,
      action: null, select, filter: query.filter, sourceIp, requestId,
      resultCount: data.length,
    });

    return { data, total };
  });

  const executionTimeMs = Date.now() - startTime;
  const limit = query.pagination?.limit ?? 20;
  const offset = query.pagination?.offset ?? 0;

  logger.info('GraphQL query executed', { entity, tenantId, resultCount: result.data.length, executionTimeMs, requestId });

  return {
    data: result.data,    // GraphQL resolves individual fields natively
    pagination: {
      total: result.total,
      limit,
      offset,
      hasMore: offset + limit < result.total,
    },
    meta: { executionTimeMs, requestId },
  };
}

/**
 * Metrics query — delegates to the existing metricsHandler.js
 */
export async function executeMetrics(args, context) {
  const requestId = context.requestId ?? `gql_${crypto.randomBytes(5).toString('hex')}`;
  const startTime = Date.now();

  const result = await executeMetricsQuery(
    { entity: 'metrics', select: args.select ?? [] },
    { ...context, requestId },
  );

  const executionTimeMs = Date.now() - startTime;
  return {
    ...result.data[0],
    meta: { executionTimeMs, requestId },
  };
}
