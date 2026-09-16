/**
 * Query Cost Limiter Plugin
 *
 * An Apollo Server plugin that enforces query complexity and depth limits
 * before execution. This replaces the existing costCalculator.js used by
 * the custom JSON query engine.
 *
 * Cost Weights (mirrors costCalculator.js exactly):
 *   Base field:          1
 *   Relation field:      10
 *   Nested relation:     50 per level
 *   Text search filter:  20
 *   IN filter per item:  5
 *   Max total cost:      500
 *   Max depth:           10 (schema-wide; per-type limit is in SDL)
 */
import {
  GraphQLError,
  GraphQLNonNull,
  GraphQLList,
  isLeafType,
  isObjectType,
  isInterfaceType,
  visit,
  Kind,
} from 'graphql';

const MAX_COST = 500;
const MAX_DEPTH = 10;
const COST_BASE_FIELD = 1;
const COST_RELATION = 10;
const COST_NESTED_RELATION = 50;
const COST_TEXT_SEARCH = 20;
const COST_IN_FILTER_PER_ITEM = 5;

/**
 * Compute the depth of a selection set recursively.
 */
function computeDepth(selectionSet, currentDepth = 0) {
  if (!selectionSet) return currentDepth;
  let maxDepth = currentDepth;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD && selection.selectionSet) {
      const childDepth = computeDepth(selection.selectionSet, currentDepth + 1);
      if (childDepth > maxDepth) maxDepth = childDepth;
    } else if (
      (selection.kind === Kind.INLINE_FRAGMENT ||
        selection.kind === Kind.FRAGMENT_SPREAD) &&
      selection.selectionSet
    ) {
      const childDepth = computeDepth(selection.selectionSet, currentDepth);
      if (childDepth > maxDepth) maxDepth = childDepth;
    }
  }
  return maxDepth;
}

/**
 * Walk the operation and estimate cost based on field selection depth.
 */
function computeCost(document, schema) {
  let totalCost = 0;
  let maxDepth = 0;

  visit(document, {
    OperationDefinition(node) {
      const depth = computeDepth(node.selectionSet);
      if (depth > maxDepth) maxDepth = depth;
    },
    Field(node, _key, _parent, path, ancestors) {
      // Determine nesting level by counting ancestor fields
      const depth = ancestors.filter(
        (a) => a && typeof a === 'object' && !Array.isArray(a) && a.kind === Kind.FIELD,
      ).length;

      if (depth === 0) {
        // Top-level query/mutation field — base cost
        totalCost += COST_BASE_FIELD;
      } else if (depth === 1) {
        // First-level relation
        totalCost += COST_RELATION;
      } else {
        // Deeper nested relation
        totalCost += COST_NESTED_RELATION * depth;
      }

      // Check for "contains" arguments (text search cost)
      if (node.arguments) {
        for (const arg of node.arguments) {
          if (arg.name.value === 'filter' && arg.value.kind === Kind.OBJECT) {
            for (const field of arg.value.fields) {
              if (field.name.value === 'contains') totalCost += COST_TEXT_SEARCH;
              if (field.name.value === 'in' && field.value.kind === Kind.LIST) {
                totalCost += COST_IN_FILTER_PER_ITEM * field.value.values.length;
              }
            }
          }
        }
      }
    },
  });

  return { totalCost, maxDepth };
}

/**
 * Apollo Server plugin that rejects queries exceeding cost or depth limits.
 */
export const costLimiterPlugin = {
  async requestDidStart() {
    return {
      async didResolveOperation({ request, document, schema }) {
        try {
          const { totalCost, maxDepth } = computeCost(document, schema);

          if (maxDepth > MAX_DEPTH) {
            throw new GraphQLError(
              `Query depth ${maxDepth} exceeds maximum allowed depth of ${MAX_DEPTH}.`,
              {
                extensions: {
                  code: 'QUERY_TOO_DEEP',
                  depth: maxDepth,
                  maxDepth: MAX_DEPTH,
                  http: { status: 400 },
                },
              },
            );
          }

          if (totalCost > MAX_COST) {
            throw new GraphQLError(
              `Query cost ${totalCost} exceeds maximum of ${MAX_COST}. Reduce selected fields or filters.`,
              {
                extensions: {
                  code: 'QUERY_TOO_COMPLEX',
                  cost: totalCost,
                  maxCost: MAX_COST,
                  http: { status: 400 },
                },
              },
            );
          }
        } catch (err) {
          if (err instanceof GraphQLError) throw err;
          // Non-GraphQL errors in cost computation should not crash the server
        }
      },
    };
  },
};
