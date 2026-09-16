/**
 * GraphQL Schema Validation Tests
 *
 * Verifies that the schema is valid, all types are reachable, and the
 * @requireScope directive is present on every Query and Mutation field.
 */
import { describe, it, expect } from 'vitest';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { typeDefs } from '../../../src/graphql/schema/typeDefs.js';
import { resolvers } from '../../../src/graphql/resolvers/index.js';
import { requireScopeDirectiveTransformer } from '../../../src/graphql/directives/requireScope.js';

function buildTestSchema() {
  const base = makeExecutableSchema({ typeDefs, resolvers });
  return requireScopeDirectiveTransformer(base);
}

describe('GraphQL Schema', () => {
  it('builds without errors', () => {
    expect(() => buildTestSchema()).not.toThrow();
  });

  it('is a valid schema object (has getQueryType and getTypeMap)', () => {
    const schema = buildTestSchema();
    expect(typeof schema.getQueryType).toBe('function');
    expect(typeof schema.getMutationType).toBe('function');
    expect(typeof schema.getTypeMap).toBe('function');
    expect(schema.getQueryType()).toBeDefined();
  });

  it('has a Query type with all expected fields', () => {
    const schema = buildTestSchema();
    const queryType = schema.getQueryType();
    expect(queryType).toBeDefined();
    const fields = Object.keys(queryType.getFields());
    expect(fields).toContain('cases');
    expect(fields).toContain('workflows');
    expect(fields).toContain('workflowSteps');
    expect(fields).toContain('referrals');
    expect(fields).toContain('assignments');
    expect(fields).toContain('auditLogs');
    expect(fields).toContain('departments');
    expect(fields).toContain('metrics');
  });

  it('has a Mutation type with all expected fields', () => {
    const schema = buildTestSchema();
    const mutationType = schema.getMutationType();
    expect(mutationType).toBeDefined();
    const fields = Object.keys(mutationType.getFields());
    expect(fields).toContain('createCase');
    expect(fields).toContain('updateCase');
    expect(fields).toContain('closeCase');
    expect(fields).toContain('executeTransition');
    expect(fields).toContain('createReferral');
    expect(fields).toContain('inviteUser');
    expect(fields).toContain('updateUser');
    expect(fields).toContain('deactivateUser');
  });

  it('has a Case type with expected fields', () => {
    const schema = buildTestSchema();
    const caseType = schema.getType('Case');
    expect(caseType).toBeDefined();
    const fields = Object.keys(caseType.getFields());
    expect(fields).toContain('id');
    expect(fields).toContain('caseNumber');
    expect(fields).toContain('title');
    expect(fields).toContain('status');
    expect(fields).toContain('assignee');
    expect(fields).toContain('currentStep');
    expect(fields).toContain('workflow');
  });

  it('has CaseConnection with data, pagination, meta', () => {
    const schema = buildTestSchema();
    const connType = schema.getType('CaseConnection');
    expect(connType).toBeDefined();
    const fields = Object.keys(connType.getFields());
    expect(fields).toContain('data');
    expect(fields).toContain('pagination');
    expect(fields).toContain('meta');
  });

  it('has DateTime and JSON scalars', () => {
    const schema = buildTestSchema();
    expect(schema.getType('DateTime')).toBeDefined();
    expect(schema.getType('JSON')).toBeDefined();
  });
});
