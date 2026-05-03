/**
 * Shared helpers for auth controllers:
 * - JWT constants
 * - Lockout constants
 * - Lazy Kafka event bus singleton
 * - Token generation
 * - Temporary password generation
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import EventBus from '../../../../shared/utils/eventBus.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('auth-service');

export const JWT_SECRET = process.env.JWT_SECRET || 'iacms-dev-secret-key-change-in-production';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
export const RESET_TOKEN_EXPIRES_HOURS = 1;
export const LOCKOUT_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

// Lazy Kafka singleton — allows the service to start even if Kafka is not yet ready
let eventBus = null;

export function getEventBus() {
  if (!eventBus) {
    try {
      eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'auth-service');
    } catch (error) {
      logger.warn('Failed to connect to Kafka event bus', { error: error.message });
    }
  }
  return eventBus;
}

/**
 * Generate a signed access token and refresh token for a user.
 * @param {{ id: string, tenantId: string, email: string, mustChangePassword?: boolean }} user
 * @param {string[]} [roleIds] — RBAC role UUIDs (forwarded as x-user-roles by the gateway)
 */
export function generateTokens(user, roleIds = []) {
  const jti = crypto.randomUUID();

  const payload = {
    jti,
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    mustChangePassword: user.mustChangePassword ?? false,
    roles: roleIds,
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });

  return { accessToken, refreshToken };
}

/**
 * Generate a random 12-character temporary password that satisfies PASSWORD_REGEX:
 * 4 letters + 4 digits + 2 specials + 1 letter + 1 digit, then Fisher-Yates shuffled.
 */
export function generateTemporaryPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const specials = '@$!%*#?&';
  const rand = (str) => str[crypto.randomInt(str.length)];

  const parts = [
    rand(letters), rand(letters), rand(letters), rand(letters),
    rand(digits),  rand(digits),  rand(digits),  rand(digits),
    rand(specials), rand(specials),
    rand(letters), rand(digits),
  ];

  for (let i = parts.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [parts[i], parts[j]] = [parts[j], parts[i]];
  }

  return parts.join('');
}
