import { describe, it, expect } from 'vitest';
import { computeQueryCost } from '../../src/engine/costCalculator.js';
import { InvalidQueryError } from '../../../../shared/common/errors.js';

describe('costCalculator', () => {
  it('should charge 1 for base fields', () => {
    const { cost, maxDepth } = computeQueryCost(['id', 'name'], null, null);
    expect(cost).toBe(2);
    expect(maxDepth).toBe(0);
  });

  it('should charge 10 for relation fields', () => {
    const { cost, maxDepth } = computeQueryCost(['id', 'author.id'], null, null);
    expect(cost).toBe(11);
    expect(maxDepth).toBe(1);
  });

  it('should charge 50 for nested relations', () => {
    const { cost, maxDepth } = computeQueryCost(['id', 'author.company.name'], null, null);
    expect(cost).toBe(101); // 1 + 50 * 2
    expect(maxDepth).toBe(2);
  });

  it('should charge 20 for contains filter', () => {
    const { cost } = computeQueryCost(['id'], { name: { contains: 'test' } }, null);
    expect(cost).toBe(21);
  });

  it('should charge 5 per item for in filter', () => {
    const { cost } = computeQueryCost(['id'], { status: { in: ['open', 'closed'] } }, null);
    expect(cost).toBe(11); // 1 + 5 * 2
  });

  it('should throw InvalidQueryError for exceeding max depth', () => {
    expect(() => {
      computeQueryCost(['a.b.c.d.e'], null, null);
    }).toThrow(InvalidQueryError);
  });

  it('should throw InvalidQueryError for exceeding max cost', () => {
    const bigInArray = Array(150).fill('status');
    expect(() => {
      computeQueryCost(['id'], { status: { in: bigInArray } }, null);
    }).toThrow(InvalidQueryError);
  });
  it('should respect allowlist maxRelationDepth override', () => {
    // Override max depth to 1
    const allowlist = { maxRelationDepth: 1 };
    
    // Depth 1 is allowed
    const { maxDepth } = computeQueryCost(['id', 'author.name'], null, allowlist);
    expect(maxDepth).toBe(1);
    
    // Depth 2 is rejected
    expect(() => {
      computeQueryCost(['id', 'author.company.name'], null, allowlist);
    }).toThrow(InvalidQueryError);
  });
});
