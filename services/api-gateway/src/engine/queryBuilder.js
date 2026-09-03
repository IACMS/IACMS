import { getAllowlist } from './allowlists/index.js';
import { InvalidQueryError } from '../../../../shared/common/errors.js';
import { computeQueryCost } from './costCalculator.js';

export function buildPrismaQuery(query, tenantId) {
  const { entity, select, filter, sort, pagination } = query;
  const allowlist = getAllowlist(entity);

  // 1. Validate and separate top-level fields vs relation fields
  const topFields = [];
  const includes = {};

  for (const field of select) {
    const parts = field.split('.');
    if (parts.length === 1) {
      // Top-level field
      if (!allowlist.selectableFields.includes(field)) {
        throw new InvalidQueryError(`Field "${field}" is not queryable on entity "${entity}"`);
      }
      topFields.push(field);
    } else if (parts.length === 2) {
      // Relation field (e.g., "assignee.firstName")
      const [relation, subField] = parts;
      const relDef = allowlist.relations?.[relation];
      if (!relDef) throw new InvalidQueryError(`Relation "${relation}" is not available on entity "${entity}"`);
      if (!relDef.selectableFields.includes(subField)) {
        throw new InvalidQueryError(`Field "${subField}" is not queryable on relation "${relation}"`);
      }
      if (!includes[relation]) includes[relation] = { select: {} };
      includes[relation].select[subField] = true;
    } else {
      throw new InvalidQueryError(`Nested relation depth > 1 is not supported in select: "${field}"`);
    }
  }

  // 2. Build Prisma select object
  const prismaSelect = {};
  for (const f of topFields) prismaSelect[f] = true;
  // Always include id for consistency
  prismaSelect.id = true;

  // 3. Build Prisma include for relations
  const prismaInclude = {};
  for (const [relation, inc] of Object.entries(includes)) {
    const relDef = allowlist.relations[relation];
    let relationPayload = inc;
    
    // Patch relation leak: if the related entity uses soft-delete,
    // ensure we don't accidentally return deleted records.
    if (relDef.softDelete) {
      relationPayload = { ...inc, where: { deletedAt: null } };
    }
    
    prismaInclude[relDef.prismaRelation || relation] = relationPayload;
  }

  // 4. Build where clause with tenant scoping
  const where = buildWhereClause(filter, allowlist, tenantId);

  // 5. Build orderBy
  const orderBy = buildOrderBy(sort, allowlist);

  // 6. Compute cost
  computeQueryCost(select, filter, allowlist);

  // 7. Pagination
  const take = pagination?.limit ?? 20;
  const skip = pagination?.offset ?? 0;

  return {
    prismaModel: allowlist.prismaModel,
    args: {
      where,
      ...(Object.keys(prismaSelect).length > 0 ? { select: { ...prismaSelect, ...(Object.keys(prismaInclude).length > 0 ? Object.fromEntries(Object.entries(prismaInclude).map(([k, v]) => [k, v])) : {}) } } : {}),
      orderBy,
      take,
      skip,
    },
    countArgs: { where },
  };
}

function buildWhereClause(filter, allowlist, tenantId) {
  const where = {};
  // Always inject tenant scope
  where.tenantId = tenantId;

  // Generic soft-delete guard: honour the allowlist flag rather than
  // hardcoding entity names here. Any allowlist that sets softDelete: true
  // will automatically exclude logically-deleted records.
  if (allowlist.softDelete) {
    where.deletedAt = null;
  }

  if (!filter) return where;

  for (const [field, value] of Object.entries(filter)) {
    // Block tenantId filter injection
    if (field === 'tenantId') continue;

    const fieldDef = allowlist.filterableFields?.[field];
    if (!fieldDef) throw new InvalidQueryError(`Filter on field "${field}" is not allowed for entity "${allowlist.prismaModel}"`);

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Operator-based filter: { gte, lte, gt, lt, neq, in, contains }
      const prismaFilter = {};
      for (const [op, opVal] of Object.entries(value)) {
        if (!fieldDef.operators.includes(op)) {
          throw new InvalidQueryError(`Operator "${op}" is not allowed on field "${field}"`);
        }
        if (op === 'contains')    prismaFilter.contains = opVal;
        else if (op === 'in')     prismaFilter.in  = Array.isArray(opVal) ? opVal : [opVal];
        else if (op === 'gte')    prismaFilter.gte = parseFilterValue(opVal, field);
        else if (op === 'lte')    prismaFilter.lte = parseFilterValue(opVal, field);
        else if (op === 'gt')     prismaFilter.gt  = parseFilterValue(opVal, field);
        else if (op === 'lt')     prismaFilter.lt  = parseFilterValue(opVal, field);
        else if (op === 'neq')    prismaFilter.not = parseFilterValue(opVal, field);
      }
      where[field] = prismaFilter;
    } else {
      // Exact match
      if (!fieldDef.operators.includes('eq')) {
        throw new InvalidQueryError(`Exact match filter is not allowed on field "${field}"`);
      }
      where[field] = value;
    }
  }

  return where;
}

function buildOrderBy(sort, allowlist) {
  if (!sort) return undefined;
  const orderBy = [];
  for (const [field, direction] of Object.entries(sort)) {
    if (!allowlist.selectableFields.includes(field)) {
      throw new InvalidQueryError(`Sort on field "${field}" is not allowed`);
    }
    orderBy.push({ [field]: direction });
  }
  return orderBy.length > 0 ? orderBy : undefined;
}

function parseFilterValue(value, field) {
  // Auto-parse ISO dates
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return value;
}
