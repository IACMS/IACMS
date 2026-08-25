import { z } from 'zod';
import { InvalidQueryError } from '../../../../shared/common/errors.js';

const PaginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
}).optional();

const QueryRequestSchema = z.object({
  operation: z.literal('query'),
  entity: z.enum(['cases', 'workflows', 'workflowSteps', 'referrals', 'assignments', 'auditLogs', 'departments', 'metrics']),
  select: z.array(z.string().max(100)).min(1).max(50),
  filter: z.record(z.string(), z.unknown()).optional(),
  sort: z.record(z.string(), z.enum(['asc', 'desc'])).optional(),
  pagination: PaginationSchema,
});

const MutationRequestSchema = z.object({
  operation: z.literal('mutate'),
  action: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export function validateQueryRequest(body) {
  const result = QueryRequestSchema.safeParse(body);
  if (!result.success) throw new InvalidQueryError('Invalid query payload', result.error.issues);
  return result.data;
}

export function validateMutationRequest(body) {
  const result = MutationRequestSchema.safeParse(body);
  if (!result.success) throw new InvalidQueryError('Invalid mutation payload', result.error.issues);
  return result.data;
}

export function validateRequest(body) {
  if (!body || typeof body !== 'object') throw new InvalidQueryError('Request body must be a JSON object');
  if (body.operation === 'query') return { type: 'query', ...validateQueryRequest(body) };
  if (body.operation === 'mutate') return { type: 'mutate', ...validateMutationRequest(body) };
  throw new InvalidQueryError('operation must be "query" or "mutate"');
}
