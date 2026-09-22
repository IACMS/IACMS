import { InvalidQueryError } from '../../../../shared/common/errors.js';

const MAX_RELATION_DEPTH = 3;
const MAX_QUERY_COST = 500;

// Cost weights
const COST_BASE_FIELD = 1;
const COST_RELATION = 10;
const COST_NESTED_RELATION = 50;
const COST_TEXT_SEARCH = 20;
const COST_IN_FILTER_PER_ITEM = 5;

export function computeQueryCost(select, filter, allowlist) {
  let cost = 0;
  let maxDepth = 0;

  for (const field of select) {
    const parts = field.split('.');
    if (parts.length === 1) {
      cost += COST_BASE_FIELD;
    } else if (parts.length === 2) {
      cost += COST_RELATION;
      maxDepth = Math.max(maxDepth, 1);
    } else {
      cost += COST_NESTED_RELATION * (parts.length - 1);
      maxDepth = Math.max(maxDepth, parts.length - 1);
    }
  }

  if (filter) {
    for (const [field, value] of Object.entries(filter)) {
      if (value && typeof value === 'object' && 'contains' in value) cost += COST_TEXT_SEARCH;
      if (value && typeof value === 'object' && 'in' in value && Array.isArray(value.in)) {
        cost += COST_IN_FILTER_PER_ITEM * value.in.length;
      }
    }
  }

  const limitDepth = allowlist?.maxRelationDepth ?? MAX_RELATION_DEPTH;
  if (maxDepth > limitDepth) {
    throw new InvalidQueryError(`Relation depth ${maxDepth} exceeds maximum of ${limitDepth}`);
  }
  if (cost > MAX_QUERY_COST) {
    throw new InvalidQueryError(`Query cost ${cost} exceeds maximum of ${MAX_QUERY_COST}. Reduce selected fields or filters.`);
  }

  return { cost, maxDepth };
}
