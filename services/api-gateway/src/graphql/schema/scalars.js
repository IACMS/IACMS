/**
 * Custom GraphQL Scalars
 * DateTime — serializes JS Date / ISO strings to ISO-8601 strings.
 */
import { GraphQLScalarType, Kind } from 'graphql';

export const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO-8601 date-time string (e.g. "2024-01-15T09:30:00.000Z")',

  /** Outbound: convert internal value → JSON */
  serialize(value) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    throw new Error(`DateTime cannot serialize value: ${value}`);
  },

  /** Inbound (literal): parse hardcoded string in query doc */
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      const d = new Date(ast.value);
      if (isNaN(d.getTime())) throw new Error(`DateTime literal "${ast.value}" is not a valid date`);
      return d;
    }
    throw new Error('DateTime must be a string literal');
  },

  /** Inbound (variable): parse value supplied as a variable */
  parseValue(value) {
    if (typeof value === 'string') {
      const d = new Date(value);
      if (isNaN(d.getTime())) throw new Error(`DateTime variable "${value}" is not a valid date`);
      return d;
    }
    if (value instanceof Date) return value;
    throw new Error('DateTime variable must be a string');
  },
});
