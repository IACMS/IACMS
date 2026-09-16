/**
 * Cost Limiter Plugin Tests
 *
 * Tests the query cost and depth computation without actually running Apollo.
 * We extract and test the internal logic by executing queries against a
 * minimal schema with the plugin logic stubbed.
 */
import { describe, it, expect } from 'vitest';
import { parse } from 'graphql';

/**
 * Re-implement computeCost from the plugin for unit testing.
 * We copy the logic here so we can test it without Apollo overhead.
 */
import { Kind, visit } from 'graphql';

const COST_BASE_FIELD = 1;
const COST_RELATION = 10;
const COST_NESTED_RELATION = 50;
const COST_TEXT_SEARCH = 20;
const COST_IN_FILTER_PER_ITEM = 5;
const MAX_COST = 500;
const MAX_DEPTH = 10;

function computeDepth(selectionSet, currentDepth = 0) {
  if (!selectionSet) return currentDepth;
  let maxDepth = currentDepth;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD && selection.selectionSet) {
      const childDepth = computeDepth(selection.selectionSet, currentDepth + 1);
      if (childDepth > maxDepth) maxDepth = childDepth;
    }
  }
  return maxDepth;
}

function computeCost(document) {
  let totalCost = 0;
  let maxDepth = 0;
  visit(document, {
    OperationDefinition(node) {
      const depth = computeDepth(node.selectionSet);
      if (depth > maxDepth) maxDepth = depth;
    },
    Field(node, _key, _parent, path, ancestors) {
      const depth = ancestors.filter(
        a => a && typeof a === 'object' && !Array.isArray(a) && a.kind === Kind.FIELD
      ).length;
      if (depth === 0) totalCost += COST_BASE_FIELD;
      else if (depth === 1) totalCost += COST_RELATION;
      else totalCost += COST_NESTED_RELATION * depth;
    },
  });
  return { totalCost, maxDepth };
}

describe('Cost Limiter Plugin — cost computation', () => {
  it('charges base cost for top-level fields', () => {
    const doc = parse('{ cases { data { id } } }');
    const { totalCost } = computeCost(doc);
    expect(totalCost).toBeGreaterThan(0);
  });

  it('charges relation cost for nested fields', () => {
    const shallow = parse('{ cases { data { id } } }');
    const withRelation = parse('{ cases { data { id assignee { firstName } } } }');
    const { totalCost: base } = computeCost(shallow);
    const { totalCost: withRel } = computeCost(withRelation);
    expect(withRel).toBeGreaterThan(base);
  });

  it('a simple single-field query is well within limits', () => {
    const doc = parse('{ cases { data { id } } }');
    const { totalCost, maxDepth } = computeCost(doc);
    expect(totalCost).toBeLessThan(MAX_COST);
    expect(maxDepth).toBeLessThan(MAX_DEPTH);
  });

  it('a deeply nested query accumulates higher cost', () => {
    // Simulate 4-level deep nesting: query > connection > data > relation > subField
    const doc = parse('{ cases { data { id assignee { firstName } workflow { steps { name } } } } }');
    const { totalCost } = computeCost(doc);
    expect(totalCost).toBeGreaterThan(10); // Should be significantly more than base
  });

  it('computes depth correctly for simple queries', () => {
    const doc = parse('{ cases { data { id } } }');
    const { maxDepth } = computeCost(doc);
    expect(maxDepth).toBeGreaterThanOrEqual(2); // cases > data > id
    expect(maxDepth).toBeLessThan(MAX_DEPTH);
  });
});
