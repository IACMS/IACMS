import { z } from 'zod';
import { ValidationError } from '../../../../shared/common/errors.js';

const uploadFieldsSchema = z.object({
  service: z
    .string({ required_error: 'service is required' })
    .min(1, 'service cannot be empty')
    .max(100, 'service name too long')
    .regex(/^[a-z0-9-]+$/, 'service must be lowercase alphanumeric with hyphens only'),
  module: z
    .string({ required_error: 'module is required' })
    .min(1, 'module cannot be empty')
    .max(100, 'module name too long')
    .regex(/^[a-z0-9-]+$/, 'module must be lowercase alphanumeric with hyphens only'),
  referenceId: z.string().max(200).optional(),
  compress: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  visibility: z.enum(['private', 'internal', 'public']).default('private'),
});

/**
 * Validate the non-file multipart fields for a single file upload.
 * Throws ValidationError with a descriptive message if invalid.
 *
 * @param {object} fields - raw fields from busboy
 * @returns {object} validated and transformed fields
 */
export function validateUploadFields(fields) {
  const result = uploadFieldsSchema.safeParse(fields);
  if (!result.success) {
    const messages = result.error.errors
      .map((e) => `${e.path.join('.') || 'field'}: ${e.message}`)
      .join('; ');
    throw new ValidationError(`Upload validation failed — ${messages}`);
  }
  return result.data;
}
