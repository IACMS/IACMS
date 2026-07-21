import { z } from 'zod';

const FILE_STATUSES = ['PENDING', 'SCANNING', 'PROCESSING', 'AVAILABLE', 'FAILED', 'DELETED'];

const listQuerySchema = z.object({
  service: z.string().optional(),
  module: z.string().optional(),
  ownerId: z.string().optional(),
  referenceId: z.string().optional(),
  mimeType: z.string().optional(),
  status: z.enum(FILE_STATUSES).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  crossService: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  page: z
    .string()
    .optional()
    .transform((v) => Math.max(1, parseInt(v || '1', 10))),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, parseInt(v || '20', 10)))),
});

/**
 * Parse and validate query parameters for GET /files.
 * Returns safe defaults on invalid input (never throws).
 *
 * @param {object} query - req.query
 * @returns {object} validated query params
 */
export function validateListQuery(query) {
  const result = listQuerySchema.safeParse(query);
  if (!result.success) {
    return { page: 1, limit: 20 };
  }
  return result.data;
}
