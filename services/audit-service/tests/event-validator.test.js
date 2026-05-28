import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAuditKafkaPayload } from '../src/utils/event-validator.js';

const valid = () => ({
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  entityType: 'case',
  entityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  action: 'case.create',
});

test('accepts minimal valid audit envelope', () => {
  assert.equal(validateAuditKafkaPayload(valid()), true);
});

test('accepts null actor id', () => {
  assert.equal(
    validateAuditKafkaPayload({
      ...valid(),
      userId: null,
    }),
    true,
  );
});

test('rejects malformed payload', () => {
  const bad = validateAuditKafkaPayload({ entityType: 'x' });
  assert.equal(typeof bad, 'string');
  assert.ok(bad.length > 0);
});
