/**
 * Unit tests — AuditLog Kafka payload validator.
 */
import { describe, it, expect } from 'vitest';
import { validateAuditKafkaPayload } from '../../src/utils/event-validator.js';

const valid = () => ({
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  entityType: 'case',
  entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  action: 'case.create',
});

describe('AuditLog model — validateAuditKafkaPayload', () => {
  it('accepts minimal valid audit envelope', () => {
    expect(validateAuditKafkaPayload(valid())).toBe(true);
  });

  it('accepts null actor id', () => {
    expect(validateAuditKafkaPayload({ ...valid(), userId: null })).toBe(true);
  });

  it('rejects malformed payload', () => {
    const bad = validateAuditKafkaPayload({ entityType: 'x' });
    expect(typeof bad).toBe('string');
    expect(bad.length).toBeGreaterThan(0);
  });
});
