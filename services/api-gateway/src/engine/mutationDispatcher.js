import prisma from '../config/database.js';
import { getMutation } from './mutations/index.js';
import { InvalidQueryError, ForbiddenError, ConflictError, NotFoundError, ValidationError } from '../../../../shared/common/errors.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('query-engine:mutations');

/**
 * Maps known Prisma Client error codes to clean HTTP-safe AppErrors.
 * Prevents raw Prisma exceptions from surfacing as 500s when the cause is
 * actually a data integrity / constraint issue originating from the caller.
 *
 * Prisma error reference:
 *   P2002 – Unique constraint failed
 *   P2003 – Foreign key constraint failed
 *   P2025 – Required record not found (update/delete on non-existent row)
 *   P2014 – Relation violation
 */
function mapPrismaError(err) {
  const code = err?.code;
  if (!code?.startsWith('P2')) return null; // not a Prisma known error

  switch (code) {
    case 'P2002': {
      // meta.target is an array of field names involved in the unique violation
      const fields = err.meta?.target?.join(', ') ?? 'unknown field';
      return new ConflictError(`A record with this ${fields} already exists.`);
    }
    case 'P2003': {
      const field = err.meta?.field_name ?? 'referenced record';
      return new ValidationError(`Related ${field} does not exist. Check your foreign-key references.`);
    }
    case 'P2025':
      return new NotFoundError('The record you are trying to modify');
    case 'P2014': {
      const relation = err.meta?.relation_name ?? 'unknown';
      return new ValidationError(`Relation violation on "${relation}". Ensure all related records exist.`);
    }
    default:
      return null;
  }
}

export async function executeMutation(request, context) {
  const { action, data } = request;
  const { tenantId, apiKeyId, sourceIp, requestId } = context;
  const startTime = Date.now();

  // 1. Look up mutation handler
  const mutation = getMutation(action);
  if (!mutation) throw new InvalidQueryError(`Unknown mutation action: "${action}"`);

  // 2. Check scope
  const requiredScope = mutation.requiredScope;
  if (requiredScope && !context.scopes.includes(requiredScope) && !context.scopes.includes('*')) {
    throw new ForbiddenError(`API key lacks required scope: ${requiredScope}`);
  }

  // 3. Validate input data against mutation's Zod schema
  const parseResult = mutation.schema.safeParse(data);
  if (!parseResult.success) {
    throw new InvalidQueryError(`Invalid data for action "${action}"`, parseResult.error.issues);
  }

  // 4. Execute mutation — map Prisma integrity errors to clean 4xx responses
  const mutationContext = { tenantId, apiKeyId, prisma, sourceIp, requestId };
  let result;
  try {
    result = await mutation.execute(parseResult.data, mutationContext);
  } catch (err) {
    const mapped = mapPrismaError(err);
    if (mapped) throw mapped;
    throw err; // re-throw unknown errors (will become 500)
  }

  // 5. Write audit (outside mutation transaction - mutations handle their own transactions)
  try {
    await prisma.auditOutbox.create({
      data: {
        tenantId,
        payload: {
          source: 'partner_api',
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
    });
  } catch (err) {
    logger.error('Failed to write mutation audit record', { error: err.message, requestId });
  }

  const executionTimeMs = Date.now() - startTime;
  logger.info('Mutation executed', { action, tenantId, executionTimeMs, requestId });

  return {
    success: true,
    action,
    data: result,
    meta: {
      executionTimeMs,
      requestId,
    },
  };
}
