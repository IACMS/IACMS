import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import crypto from 'crypto';
import {
  encrypt,
  decrypt,
  encryptSecrets,
  decryptSecrets,
} from '../../src/utils/integrationCrypto.js';

describe('integrationCrypto utility', () => {
  const originalKey = process.env.INTEGRATION_SECRET_KEY;
  const validKey = crypto.randomBytes(32).toString('hex');

  beforeEach(() => {
    process.env.INTEGRATION_SECRET_KEY = validKey;
  });

  afterAll(() => {
    process.env.INTEGRATION_SECRET_KEY = originalKey;
  });

  it('successfully encrypts and decrypts a secret using AES-256-GCM', () => {
    const rawSecret = 'super-secret-partner-api-key-12345';
    const ciphertext = encrypt(rawSecret);

    expect(ciphertext).toBeDefined();
    expect(ciphertext).not.toBe(rawSecret);
    expect(typeof ciphertext).toBe('string');
    expect(ciphertext.split(':').length).toBe(3); // iv:data:tag

    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(rawSecret);
  });

  it('handles null and undefined values gracefully', () => {
    expect(encrypt(null)).toBeNull();
    expect(encrypt(undefined)).toBeNull();
    expect(decrypt(null)).toBeNull();
    expect(decrypt(undefined)).toBeNull();
  });

  it('throws an error if INTEGRATION_SECRET_KEY is missing', () => {
    delete process.env.INTEGRATION_SECRET_KEY;
    expect(() => encrypt('test')).toThrow('INTEGRATION_SECRET_KEY must be a 64-char hex string');
    expect(() => decrypt('test')).toThrow('INTEGRATION_SECRET_KEY must be a 64-char hex string');
  });

  it('throws an error if INTEGRATION_SECRET_KEY has invalid length', () => {
    process.env.INTEGRATION_SECRET_KEY = 'too-short';
    expect(() => encrypt('test')).toThrow('INTEGRATION_SECRET_KEY must be a 64-char hex string');
  });

  it('fails decryption if ciphertext has been tampered with (GCM authentication check)', () => {
    const rawSecret = 'webhook-signing-secret';
    const ciphertext = encrypt(rawSecret);

    const parts = ciphertext.split(':');
    const dataBuf = Buffer.from(parts[1], 'base64');
    // Flip a byte in encrypted data
    dataBuf[0] ^= 0xff;
    parts[1] = dataBuf.toString('base64');
    const tampered = parts.join(':');

    expect(() => decrypt(tampered)).toThrow();
  });

  it('fails decryption if ciphertext format is invalid (not iv:data:tag)', () => {
    expect(() => decrypt('invalid-format-string')).toThrow('Invalid ciphertext format');
  });

  it('encrypts and decrypts secret pairs via convenience helpers', () => {
    const raw = { apiKey: 'key_123', apiSecret: 'secret_456' };
    const enc = encryptSecrets(raw);

    expect(enc.apiKeyEnc).toBeDefined();
    expect(enc.apiSecretEnc).toBeDefined();
    expect(enc.apiKeyEnc).not.toBe('key_123');

    const dec = decryptSecrets(enc);
    expect(dec.apiKey).toBe('key_123');
    expect(dec.apiSecret).toBe('secret_456');
  });
});
