/**
 * Integration Secret Encryption Utility
 *
 * Uses AES-256-GCM (same pattern as OAuthProvider.clientSecretEnc) to
 * encrypt/decrypt integration API keys and secrets before they touch the DB.
 *
 * Environment variable required:
 *   INTEGRATION_SECRET_KEY  — 32-byte hex string (64 hex chars), e.g.:
 *     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;   // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;  // 128-bit authentication tag

/**
 * Returns the 32-byte key buffer from the INTEGRATION_SECRET_KEY env var.
 * Throws if the env var is missing or malformed so misconfiguration is caught
 * at startup rather than silently at first write.
 */
function getKey() {
  const hex = process.env.INTEGRATION_SECRET_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'INTEGRATION_SECRET_KEY must be a 64-char hex string (32 bytes). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a plaintext string.
 * Returns a base64-encoded string in the format: <iv>:<ciphertext>:<authTag>
 * Returns null if plaintext is null/undefined.
 *
 * @param {string|null|undefined} plaintext
 * @returns {string|null}
 */
export function encrypt(plaintext) {
  if (plaintext == null) return null;

  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: base64(iv):base64(ciphertext):base64(tag)
  return [iv, encrypted, tag].map((b) => b.toString('base64')).join(':');
}

/**
 * Decrypts a ciphertext string produced by encrypt().
 * Returns null if ciphertext is null/undefined.
 * Throws if the ciphertext is tampered or the key is wrong (GCM auth failure).
 *
 * @param {string|null|undefined} ciphertext
 * @returns {string|null}
 */
export function decrypt(ciphertext) {
  if (ciphertext == null) return null;

  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format — expected iv:data:tag');
  }

  const [ivB64, dataB64, tagB64] = parts;
  const iv  = Buffer.from(ivB64,  'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag  = Buffer.from(tagB64,  'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Convenience: encrypts a { apiKey, apiSecret } pair into { apiKeyEnc, apiSecretEnc }.
 * Pass the raw body from the API request.
 *
 * @param {{ apiKey?: string, apiSecret?: string }} raw
 * @returns {{ apiKeyEnc: string|null, apiSecretEnc: string|null }}
 */
export function encryptSecrets({ apiKey, apiSecret } = {}) {
  return {
    apiKeyEnc:    encrypt(apiKey    ?? null),
    apiSecretEnc: encrypt(apiSecret ?? null),
  };
}

/**
 * Convenience: decrypts { apiKeyEnc, apiSecretEnc } back to { apiKey, apiSecret }.
 * Use only for internal sync calls that genuinely need the raw credentials.
 *
 * @param {{ apiKeyEnc?: string, apiSecretEnc?: string }} row
 * @returns {{ apiKey: string|null, apiSecret: string|null }}
 */
export function decryptSecrets({ apiKeyEnc, apiSecretEnc } = {}) {
  return {
    apiKey:    decrypt(apiKeyEnc    ?? null),
    apiSecret: decrypt(apiSecretEnc ?? null),
  };
}

