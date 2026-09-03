import { describe, it, expect } from 'vitest';
import { signPayload, SUPPORTED_EVENTS } from '../../src/services/webhook.service.js';

describe('Webhook Service', () => {
  it('should generate a valid sha256 HMAC signature', () => {
    const secret = 'my-super-secret-key';
    const payload = JSON.stringify({ event: 'case.created', data: { id: 1 } });
    
    const signature = signPayload(secret, payload);
    
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    
    // Test determinism
    const signature2 = signPayload(secret, payload);
    expect(signature).toBe(signature2);
    
    // Test different payload gives different signature
    const signature3 = signPayload(secret, JSON.stringify({ event: 'case.created', data: { id: 2 } }));
    expect(signature).not.toBe(signature3);
  });

  it('should export SUPPORTED_EVENTS array', () => {
    expect(Array.isArray(SUPPORTED_EVENTS)).toBe(true);
    expect(SUPPORTED_EVENTS.length).toBeGreaterThan(0);
    expect(SUPPORTED_EVENTS).toContain('case.created');
  });
});
