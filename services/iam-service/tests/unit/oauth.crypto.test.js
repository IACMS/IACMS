import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import {
  encryptClientSecret,
  decryptClientSecret,
} from '../../src/oauth/client-secret.utils.js';

describe('client-secret.utils unit tests', () => {
  const originalKey = process.env.CLIENT_SECRET_KEY;
  const validKey = crypto.randomBytes(32).toString('hex');

  beforeEach(() => {
    process.env.CLIENT_SECRET_KEY = validKey;
  });

  afterEach(() => {
    process.env.CLIENT_SECRET_KEY = originalKey;
  });

  it('encrypts and decrypts a client secret successfully', () => {
    const secret = 'super-secret-oauth-value-12345';
    const encrypted = encryptClientSecret(secret);

    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toBe(secret);

    const decrypted = decryptClientSecret(encrypted);
    expect(decrypted).toBe(secret);
  });

  it('throws an error if CLIENT_SECRET_KEY is missing or invalid length', () => {
    delete process.env.CLIENT_SECRET_KEY;
    expect(() => encryptClientSecret('test')).toThrow('CLIENT_SECRET_KEY must be a 64-char hex string');

    process.env.CLIENT_SECRET_KEY = 'tooshort';
    expect(() => encryptClientSecret('test')).toThrow('CLIENT_SECRET_KEY must be a 64-char hex string');
  });

  it('throws an error if ciphertext is tampered with', () => {
    const secret = 'secret-to-tamper';
    const encrypted = encryptClientSecret(secret);
    const buf = Buffer.from(encrypted, 'base64');

    // Flip bits in the ciphertext portion
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');

    expect(() => decryptClientSecret(tampered)).toThrow();
  });

  it('throws an error if ciphertext payload is truncated or too short', () => {
    const invalidShort = Buffer.from('short').toString('base64');
    expect(() => decryptClientSecret(invalidShort)).toThrow('Invalid ciphertext payload');
  });
});
