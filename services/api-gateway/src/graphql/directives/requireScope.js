/**
 * @requireScope Schema Directive
 *
 * Wraps a resolver to enforce that the calling API key holds the
 * required scope before the field is resolved. This runs before
 * any resolver logic, so a scope failure short-circuits the request
 * before it ever touches Prisma.
 *
 * Usage in SDL:
 *   type Query {
 *     cases(...): CaseConnection! @requireScope(scope: "cases:read")
 *   }
 *
 * Implementation note: we use a manual schema visitor pattern to avoid
 * cross-module "graphql" instance conflicts that arise with mapSchema
 * when @graphql-tools/utils is installed in a nested node_modules.
 */
import { defaultFieldResolver, GraphQLError } from 'graphql';

/** Duck-type check: does this type have getFields (i.e. is it an object type)? */
function hasFields(type) {
  return type && typeof type.getFields === 'function' && typeof type.name === 'string';
}

/**
 * Walks the schema and wraps every field that has @requireScope.
 * This mutates the schema in-place (safe — called once at startup).
 *
 * @param {GraphQLSchema} schema - Result of makeExecutableSchema()
 * @returns {GraphQLSchema} The same schema with wrapped resolvers
 */
export function requireScopeDirectiveTransformer(schema) {
  const typeMap = schema.getTypeMap();

  for (const type of Object.values(typeMap)) {
    // Skip scalars, enums, unions, introspection types
    if (!hasFields(type) || type.name.startsWith('__')) continue;

    const fields = type.getFields();
    for (const field of Object.values(fields)) {
      // Find @requireScope directive on this field's AST node
      const directive = field.astNode?.directives?.find(
        (d) => d.name.value === 'requireScope',
      );
      if (!directive) continue;

      // Extract the "scope" argument value from the AST
      const scopeArg = directive.arguments?.find((a) => a.name.value === 'scope');
      if (!scopeArg || scopeArg.value.kind !== 'StringValue') continue;
      const requiredScope = scopeArg.value.value;

      // Wrap the existing resolver
      const originalResolve = field.resolve ?? defaultFieldResolver;
      field.resolve = function scopeGuard(source, args, context, info) {
        const scopes = context?.scopes ?? [];
        const hasScope =
          scopes.includes('*') || scopes.includes(requiredScope);

        if (!hasScope) {
          throw new GraphQLError(
            `API key lacks required scope: ${requiredScope}`,
            {
              extensions: {
                code: 'FORBIDDEN',
                requiredScope,
                http: { status: 403 },
              },
            },
          );
        }

        return originalResolve.call(this, source, args, context, info);
      };
    }
  }

  return schema;
}

