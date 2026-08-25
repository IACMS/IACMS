import prisma from '../config/database.js';
import { getMutation } from './mutations/index.js';
import { InvalidQueryError, ForbiddenError } from '../../../../shared/common/errors.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('query-engine:mutations');

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

  // 4. Execute mutation
  const mutationContext = { tenantId, apiKeyId, prisma, sourceIp, requestId };
  const result = await mutation.execute(parseResult.data, mutationContext);

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
