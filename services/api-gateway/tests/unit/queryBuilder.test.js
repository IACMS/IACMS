import { describe, it, expect } from 'vitest';
import { buildPrismaQuery } from '../../src/engine/queryBuilder.js';
import { InvalidQueryError } from '../../../../shared/common/errors.js';

describe('queryBuilder', () => {
  it('should build a basic prisma query', () => {
    const query = {
      entity: 'cases',
      select: ['id', 'status', 'assignee.firstName'],
      filter: { status: 'OPEN', title: { contains: 'test' } },
      sort: { createdAt: 'desc' },
      pagination: { limit: 10, offset: 0 }
    };
    
    const result = buildPrismaQuery(query, 'tenant-1');
    
    expect(result.prismaModel).toBe('case');
    expect(result.args.take).toBe(10);
    expect(result.args.skip).toBe(0);
    expect(result.args.orderBy).toEqual([{ createdAt: 'desc' }]);
    expect(result.args.where).toMatchObject({
      tenantId: 'tenant-1',
      deletedAt: null,
      status: 'OPEN',
      title: { contains: 'test' }
    });
    
    // Select objects
    expect(result.args.select).toHaveProperty('id', true);
    expect(result.args.select).toHaveProperty('status', true);
    expect(result.args.select).toHaveProperty('assignee');
    expect(result.args.select.assignee).toHaveProperty('select');
    expect(result.args.select.assignee.select).toHaveProperty('firstName', true);
  });

  it('should throw InvalidQueryError for non-allowlisted top field', () => {
    const query = {
      entity: 'cases',
      select: ['secretField']
    };
    expect(() => {
      buildPrismaQuery(query, 'tenant-1');
    }).toThrow(InvalidQueryError);
  });

  it('should throw InvalidQueryError for invalid relation field', () => {
    const query = {
      entity: 'cases',
      select: ['assignee.password']
    };
    expect(() => {
      buildPrismaQuery(query, 'tenant-1');
    }).toThrow(InvalidQueryError);
  });

  it('should throw InvalidQueryError for invalid filter operator', () => {
    const query = {
      entity: 'cases',
      select: ['id'],
      filter: { status: { gt: 'OPEN' } } // gt is not allowed
    };
    expect(() => {
      buildPrismaQuery(query, 'tenant-1');
    }).toThrow(InvalidQueryError);
  });

  it('should throw InvalidQueryError for non-filterable field', () => {
    const query = {
      entity: 'cases',
      select: ['id'],
      filter: { unknownField: 'test' }
    };
    expect(() => {
      buildPrismaQuery(query, 'tenant-1');
    }).toThrow(InvalidQueryError);
  });

  it('should correctly map lt, gt, and neq operators', () => {
    const query = {
      entity: 'cases',
      select: ['id'],
      filter: {
        createdAt: { gt: '2023-01-01', lt: '2023-12-31' },
        status: { neq: 'CLOSED' }
      }
    };
    const result = buildPrismaQuery(query, 'tenant-1');
    expect(result.args.where.createdAt).toMatchObject({
      gt: new Date('2023-01-01'),
      lt: new Date('2023-12-31')
    });
    expect(result.args.where.status).toMatchObject({
      not: 'CLOSED'
    });
  });
  it('should support deep relational queries (depth > 1)', () => {
    const query = {
      entity: 'cases',
      select: ['id', 'workflow.name', 'workflow.steps.name', 'workflow.steps.key']
    };
    const result = buildPrismaQuery(query, 'tenant-1');
    
    expect(result.args.select).toHaveProperty('id', true);
    expect(result.args.select).toHaveProperty('workflow');
    expect(result.args.select.workflow).toHaveProperty('select');
    expect(result.args.select.workflow.select).toHaveProperty('name', true);
    expect(result.args.select.workflow.select).toHaveProperty('steps');
    expect(result.args.select.workflow.select.steps).toHaveProperty('select');
    expect(result.args.select.workflow.select.steps.select).toHaveProperty('name', true);
    expect(result.args.select.workflow.select.steps.select).toHaveProperty('key', true);
  });
});
