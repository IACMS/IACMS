/**
 * Regression — audit event schema must reject incomplete AuditLog payloads.
 */
import { describe, it, expect } from 'vitest';
import { validateAuditKafkaPayload } from '../../src/utils/event-validator.js';

describe('AuditLog schema regression', () => {
  it('rejects missing tenantId', () => {
    const result = validateAuditKafkaPayload({
      entityType: 'case',
      entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      action: 'case.update',
    });
    expect(result).not.toBe(true);
  });

  it('rejects invalid UUID entityId', () => {
    const result = validateAuditKafkaPayload({
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      entityType: 'case',
      entityId: 'not-a-uuid',
      action: 'case.update',
    });
    expect(result).not.toBe(true);
  });
});
