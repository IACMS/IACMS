/**
 * @requireScope Directive Tests
 *
 * Tests the directive logic by directly calling the wrapped resolvers
 * without going through the graphql() executor (which has cross-module
 * graphql instance issues in vitest with nested node_modules).
 */
import { describe, it, expect, vi } from 'vitest';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { requireScopeDirectiveTransformer } from '../../../src/graphql/directives/requireScope.js';
import { GraphQLError } from 'graphql';

// Minimal schema with the directive
const TEST_TYPE_DEFS = `
  directive @requireScope(scope: String!) on FIELD_DEFINITION

  type Query {
    protectedField: String! @requireScope(scope: "cases:read")
    openField: String!
  }
`;

const TEST_RESOLVERS = {
  Query: {
    protectedField: () => 'secret data',
    openField: () => 'public data',
  },
};

function buildSchema() {
  const base = makeExecutableSchema({ typeDefs: TEST_TYPE_DEFS, resolvers: TEST_RESOLVERS });
  return requireScopeDirectiveTransformer(base);
}

/**
 * Simulate calling a field resolver with a given context.
 * This bypasses the graphql() executor to avoid cross-module issues.
 */
function callResolver(schema, typeName, fieldName, context) {
  const type = schema.getType(typeName);
  const field = type.getFields()[fieldName];
  return field.resolve(null, {}, context, { fieldName });
}

describe('@requireScope directive', () => {
  const schema = buildSchema();

  it('blocks access when scope is missing', () => {
    expect(() =>
      callResolver(schema, 'Query', 'protectedField', { scopes: [] })
    ).toThrow(GraphQLError);

    try {
      callResolver(schema, 'Query', 'protectedField', { scopes: [] });
    } catch (err) {
      expect(err).toBeInstanceOf(GraphQLError);
      expect(err.message).toContain('cases:read');
      expect(err.extensions?.code).toBe('FORBIDDEN');
    }
  });

  it('blocks access when a different scope is present', () => {
    expect(() =>
      callResolver(schema, 'Query', 'protectedField', { scopes: ['workflows:read'] })
    ).toThrow(GraphQLError);
  });

  it('allows access when the exact scope is present', () => {
    const result = callResolver(schema, 'Query', 'protectedField', { scopes: ['cases:read'] });
    expect(result).toBe('secret data');
  });

  it('allows access when wildcard "*" scope is present', () => {
    const result = callResolver(schema, 'Query', 'protectedField', { scopes: ['*'] });
    expect(result).toBe('secret data');
  });

  it('does not block fields without the directive', () => {
    const result = callResolver(schema, 'Query', 'openField', { scopes: [] });
    expect(result).toBe('public data');
  });

  it('allows multiple scopes, one of which matches', () => {
    const result = callResolver(schema, 'Query', 'protectedField', {
      scopes: ['workflows:read', 'cases:read', 'referrals:read'],
    });
    expect(result).toBe('secret data');
  });

  it('has wrapped the resolver for the protected field', () => {
    const type = schema.getType('Query');
    const field = type.getFields()['protectedField'];
    // The resolver should be our scopeGuard wrapper, not the original
    expect(field.resolve.name).toBe('scopeGuard');
  });

  it('has NOT wrapped the resolver for the open field', () => {
    const type = schema.getType('Query');
    const field = type.getFields()['openField'];
    // The original resolver (from makeExecutableSchema) should not be wrapped
    // It should either be the original or defaultFieldResolver — not scopeGuard
    expect(field.resolve?.name).not.toBe('scopeGuard');
  });
});
