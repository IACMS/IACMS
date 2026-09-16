/**
 * Shared Mutation Resolver Helper
 *
 * Wraps the existing mutationDispatcher pipeline so that GraphQL mutation
 * resolvers are thin pass-throughs. Zod validation, business logic, scope
 * checks, Prisma error mapping, and audit writing are all performed by the
 * underlying mutation handler — identical to the custom JSON engine.
 */
import { getMutation } from '../../engine/mutations/index.js';
import { ForbiddenError, InvalidQueryError } from '../../../../../shared/common/errors.js';
import { GraphQLError } from 'graphql';
import crypto from 'node:crypto';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('graphql:mutation-resolver');

/**
 * Maps Prisma known error codes to clean 4xx GraphQL errors.
 * Mirrors mapPrismaError() in mutationDispatcher.js.
 */
function mapPrismaError(err) {
  const code = err?.code;
  if (!code?.startsWith('P2')) return null;

  const extensions = { http: { status: 409 } };

  switch (code) {
    case 'P2002': {
      const fields = err.meta?.target?.join(', ') ?? 'unknown field';
      return new GraphQLError(`A record with this ${fields} already exists.`, { extensions: { ...extensions, code: 'CONFLICT' } });
    }
    case 'P2003': {
      const field = err.meta?.field_name ?? 'referenced record';
      return new GraphQLError(`Related ${field} does not exist. Check your foreign-key references.`, { extensions: { ...extensions, code: 'VALIDATION_ERROR', http: { status: 400 } } });
    }
    case 'P2025':
      return new GraphQLError('The record you are trying to modify does not exist.', { extensions: { ...extensions, code: 'NOT_FOUND', http: { status: 404 } } });
    case 'P2014': {
      const rel = err.meta?.relation_name ?? 'unknown';
      return new GraphQLError(`Relation violation on "${rel}".`, { extensions: { ...extensions, code: 'VALIDATION_ERROR', http: { status: 400 } } });
    }
    default:
      return null;
  }
}

/**
 * Map AppErrors from the mutation handler into GraphQL-safe errors.
 */
function mapAppError(err) {
  if (err?.statusCode || err?.isAppError) {
    return new GraphQLError(err.message, {
      extensions: {
        code: err.code ?? 'APP_ERROR',
        http: { status: err.statusCode ?? 400 },
      },
    });
  }
  return null;
}

/**
 * Execute a named mutation, delegating to the existing mutation handler.
 *
 * @param {string} action - Mutation name (e.g. 'createCase')
 * @param {object} input  - Validated input from GraphQL (already type-checked by SDL)
 * @param {object} context - GraphQL context
 */
export async function executeMutation(action, input, context) {
  const { tenantId, apiKeyId, scopes, sourceIp, prisma } = context;
  const requestId = context.requestId ?? `gql_${crypto.randomBytes(5).toString('hex')}`;
  const startTime = Date.now();

  // 1. Lookup handler
  const mutation = getMutation(action);
  if (!mutation) {
    throw new GraphQLError(`Unknown mutation: "${action}"`, {
      extensions: { code: 'UNKNOWN_MUTATION', http: { status: 400 } },
    });
  }

  // 2. Scope check (belt-and-suspenders — @requireScope directive also guards)
  const requiredScope = mutation.requiredScope;
  if (requiredScope && !scopes.includes('*') && !scopes.includes(requiredScope)) {
    throw new GraphQLError(`API key lacks required scope: ${requiredScope}`, {
      extensions: { code: 'FORBIDDEN', http: { status: 403 } },
    });
  }

  // 3. Zod validation
  const parseResult = mutation.schema.safeParse(input);
  if (!parseResult.success) {
    throw new GraphQLError(`Invalid input for ${action}: ${parseResult.error.issues[0]?.message ?? 'validation failed'}`, {
      extensions: {
        code: 'VALIDATION_ERROR',
        issues: parseResult.error.issues,
        http: { status: 400 },
      },
    });
  }

  // 4. Execute
  const mutationContext = { tenantId, apiKeyId, prisma, sourceIp, requestId };
  let result;
  try {
    result = await mutation.execute(parseResult.data, mutationContext);
  } catch (err) {
    const mapped = mapPrismaError(err) ?? mapAppError(err);
    if (mapped) throw mapped;
    throw err; // unknown → 500
  }

  // 5. Write audit outbox (non-blocking — mirrors mutationDispatcher.js)
  prisma.auditOutbox.create({
    data: {
      tenantId,
      payload: {
        source: 'partner_api_graphql',
        apiKeyId,
        operation: 'mutate',
        action,
        data: parseResult.data,
        result: { success: true },
        sourceIp,
        requestId,
        timestamp: new Date().toISOString(),
      },
    },
  }).catch((err) => logger.error('Failed to write mutation audit record', { error: err.message, requestId }));

  const executionTimeMs = Date.now() - startTime;
  logger.info('GraphQL mutation executed', { action, tenantId, executionTimeMs, requestId });

  return result;
}
