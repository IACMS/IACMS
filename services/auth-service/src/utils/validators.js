/**
 * Input Validation Utilities
 * Simple validation functions for auth service
 */

import { ValidationError } from '../../../../shared/common/errors.js';

/**
 * Email validation regex
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Password requirements:
 * - At least 8 characters
 * - Contains at least one letter
 * - Contains at least one number
 */
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$/;

/**
 * Validate email format
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    throw new ValidationError('Email is required');
  }
  
  const trimmedEmail = email.trim().toLowerCase();
  
  if (!EMAIL_REGEX.test(trimmedEmail)) {
    throw new ValidationError('Invalid email format');
  }
  
  if (trimmedEmail.length > 255) {
    throw new ValidationError('Email must be less than 255 characters');
  }
  
  return trimmedEmail;
}

/**
 * Validate password strength
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    throw new ValidationError('Password is required');
  }
  
  if (password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters long');
  }
  
  if (password.length > 128) {
    throw new ValidationError('Password must be less than 128 characters');
  }
  
  if (!PASSWORD_REGEX.test(password)) {
    throw new ValidationError('Password must contain at least one letter and one number');
  }
  
  return password;
}

/**
 * Validate name (first name, last name)
 */
export function validateName(name, fieldName = 'Name') {
  if (!name || typeof name !== 'string') {
    throw new ValidationError(`${fieldName} is required`);
  }
  
  const trimmedName = name.trim();
  
  if (trimmedName.length < 1) {
    throw new ValidationError(`${fieldName} is required`);
  }
  
  if (trimmedName.length > 100) {
    throw new ValidationError(`${fieldName} must be less than 100 characters`);
  }
  
  // Check for invalid characters (only letters, spaces, hyphens, apostrophes allowed)
  if (!/^[a-zA-Z\s\-']+$/.test(trimmedName)) {
    throw new ValidationError(`${fieldName} contains invalid characters`);
  }
  
  return trimmedName;
}

/**
 * Validate username
 */
export function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    return null; // Username is optional, will use email if not provided
  }
  
  const trimmedUsername = username.trim().toLowerCase();
  
  if (trimmedUsername.length < 3) {
    throw new ValidationError('Username must be at least 3 characters long');
  }
  
  if (trimmedUsername.length > 50) {
    throw new ValidationError('Username must be less than 50 characters');
  }
  
  // Only alphanumeric, underscores, and hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
    throw new ValidationError('Username can only contain letters, numbers, underscores, and hyphens');
  }
  
  return trimmedUsername;
}

/**
 * Validate UUID
 */
export function validateUUID(id, fieldName = 'ID') {
  if (!id || typeof id !== 'string') {
    throw new ValidationError(`${fieldName} is required`);
  }
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (!uuidRegex.test(id)) {
    throw new ValidationError(`${fieldName} must be a valid UUID`);
  }
  
  return id.toLowerCase();
}

/**
 * Validate tenant code
 */
export function validateTenantCode(code) {
  if (!code || typeof code !== 'string') {
    return null; // Tenant code is optional for login
  }
  
  const trimmedCode = code.trim().toUpperCase();
  
  if (trimmedCode.length < 2) {
    throw new ValidationError('Tenant code must be at least 2 characters');
  }
  
  if (trimmedCode.length > 50) {
    throw new ValidationError('Tenant code must be less than 50 characters');
  }
  
  // Only alphanumeric and hyphens
  if (!/^[A-Z0-9-]+$/.test(trimmedCode)) {
    throw new ValidationError('Tenant code can only contain letters, numbers, and hyphens');
  }
  
  return trimmedCode;
}

/**
 * Validate login request
 */
export function validateLoginRequest(body) {
  const { email, password, tenantCode } = body || {};
  
  return {
    email: validateEmail(email),
    password: password?.trim(), // Basic trim, don't validate strength on login
    tenantCode: validateTenantCode(tenantCode),
  };
}

/**
 * Validate registration request
 */
export function validateRegisterRequest(body) {
  const { email, password, firstName, lastName, tenantId, username } = body || {};
  
  return {
    email: validateEmail(email),
    password: validatePassword(password),
    firstName: validateName(firstName, 'First name'),
    lastName: validateName(lastName, 'Last name'),
    tenantId: validateUUID(tenantId, 'Tenant ID'),
    username: validateUsername(username),
  };
}

export default {
  validateEmail,
  validatePassword,
  validateName,
  validateUsername,
  validateUUID,
  validateTenantCode,
  validateLoginRequest,
  validateRegisterRequest,
};
