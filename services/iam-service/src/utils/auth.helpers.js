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

if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'test') {
  throw new Error('[auth-helpers] JWT_SECRET environment variable is required. Generate with: openssl rand -base64 64');
}
export const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-chars-long-for-testing-only!';

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
export const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
export const RESET_TOKEN_EXPIRES_HOURS = 1;
export const LOCKOUT_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

// Lazy Kafka singleton — allows the service to start even if Kafka is not yet ready
let eventBus = null;

export function getEventBus() {
  if (!eventBus) {
    eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'auth-service');
  }
  return eventBus;
}

export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function generateRefreshToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
}

export function generateTemporaryPassword() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*';

  let password = '';
  password += upper[crypto.randomInt(upper.length)];
  password += lower[crypto.randomInt(lower.length)];
  password += numbers[crypto.randomInt(numbers.length)];
  password += special[crypto.randomInt(special.length)];

  const all = upper + lower + numbers + special;
  for (let i = 4; i < 12; i++) {
    password += all[crypto.randomInt(all.length)];
  }

  return password.split('').sort(() => 0.5 - Math.random()).join('');
}
