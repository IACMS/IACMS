/**
 * client-secret.utils.js
 * AES-256-GCM symmetric encryption for OAuth client secrets stored in the DB.
 *
 * Env var required: CLIENT_SECRET_KEY — 64 hex chars (= 32 bytes).
 * Generate with:  openssl rand -hex 32
 *
 * Ciphertext format (base64-encoded):
 *   [12-byte IV][16-byte auth-tag][N-byte ciphertext]
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM recommended
const TAG_BYTES = 16;

function getKey() {
  const hex = process.env.CLIENT_SECRET_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      '[client-secret.utils] CLIENT_SECRET_KEY must be a 64-char hex string (32 bytes). ' +
        'Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext client secret.
 * @param {string} plaintext
 * @returns {string} base64-encoded blob (IV + tag + ciphertext)
 */
export function encryptClientSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Prepend IV and tag so decryption is self-contained
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a stored client secret ciphertext.
 * @param {string} ciphertext base64-encoded blob produced by encryptClientSecret
 * @returns {string} plaintext
 */
export function decryptClientSecret(ciphertext) {
  const key = getKey();
  const buf = Buffer.from(ciphertext, 'base64');

  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = buf.subarray(IV_BYTES + TAG_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}
