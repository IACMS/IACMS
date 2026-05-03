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
 * Accepts either tenantCode (preferred) or tenantId (UUID)
 */
export function validateRegisterRequest(body) {
  const { email, password, firstName, lastName, tenantId, tenantCode, username } = body || {};
  
  // Must provide either tenantCode or tenantId
  if (!tenantCode && !tenantId) {
    throw new ValidationError('Tenant code is required');
  }
  
  return {
    email: validateEmail(email),
    password: validatePassword(password),
    firstName: validateName(firstName, 'First name'),
    lastName: validateName(lastName, 'Last name'),
    tenantCode: tenantCode ? validateTenantCode(tenantCode) : null,
    tenantId: tenantId ? validateUUID(tenantId, 'Tenant ID') : null,
    username: validateUsername(username),
  };
}

/**
 * Validate admin "create user" request.
 * Password is NOT provided by the admin — it's auto-generated by the server.
 * roleId is optional — if provided, the user will be assigned that role on creation.
 */
export function validateCreateUserRequest(body) {
  const { email, firstName, lastName, username, tenantId, tenantCode, roleId } = body || {};

  if (!tenantCode && !tenantId) {
    throw new ValidationError('Tenant code is required');
  }

  return {
    email: validateEmail(email),
    firstName: validateName(firstName, 'First name'),
    lastName: validateName(lastName, 'Last name'),
    username: validateUsername(username),
    tenantCode: tenantCode ? validateTenantCode(tenantCode) : null,
    tenantId: tenantId ? validateUUID(tenantId, 'Tenant ID') : null,
    roleId: roleId ? validateUUID(roleId, 'Role ID') : null,
  };
}

/**
 * Validate admin "update user" request.
 * All fields are optional but at least one must be provided.
 * Email uniqueness within the tenant is checked in the controller.
 */
export function validateUpdateUserRequest(body) {
  const { firstName, lastName, email, phone } = body || {};

  const hasAnyField = firstName !== undefined || lastName !== undefined ||
    email !== undefined || phone !== undefined;

  if (!hasAnyField) {
    throw new ValidationError('At least one field (firstName, lastName, email, phone) is required');
  }

  const result = {};

  if (firstName !== undefined) {
    result.firstName = validateName(firstName, 'First name');
  }
  if (lastName !== undefined) {
    result.lastName = validateName(lastName, 'Last name');
  }
  if (email !== undefined) {
    result.email = validateEmail(email);
  }
  if (phone !== undefined) {
    if (phone !== null && phone !== '') {
      const trimmed = String(phone).trim();
      if (trimmed.length > 30) {
        throw new ValidationError('Phone must be less than 30 characters');
      }
      result.phone = trimmed;
    } else {
      result.phone = null; // allow clearing phone
    }
  }

  return result;
}

/**
 * Validate self-service profile update request.
 * Unlike admin update, email cannot be changed here (it would break verified state).
 * Only firstName, lastName, phone are allowed.
 */
/**
 * Self-service tenant registration: creates organization + first user as tenant administrator.
 */
export function validateTenantRegistrationRequest(body) {
  const { tenantName, tenantCode, email, password, firstName, lastName, username } = body || {};

  if (!tenantName || typeof tenantName !== 'string' || !tenantName.trim()) {
    throw new ValidationError('Organization name is required');
  }
  const orgName = tenantName.trim();
  if (orgName.length > 200) {
    throw new ValidationError('Organization name must be at most 200 characters');
  }

  const code = validateTenantCode(tenantCode);
  if (!code) {
    throw new ValidationError('Tenant code is required');
  }

  return {
    tenantName: orgName,
    tenantCode: code,
    email: validateEmail(email),
    password: validatePassword(password),
    firstName: validateName(firstName, 'First name'),
    lastName: validateName(lastName, 'Last name'),
    username: validateUsername(username),
  };
}

export function validateProfileUpdateRequest(body) {
  const { firstName, lastName, phone } = body || {};

  const hasAnyField = firstName !== undefined || lastName !== undefined || phone !== undefined;

  if (!hasAnyField) {
    throw new ValidationError('At least one field (firstName, lastName, phone) is required');
  }

  const result = {};

  if (firstName !== undefined) {
    result.firstName = validateName(firstName, 'First name');
  }
  if (lastName !== undefined) {
    result.lastName = validateName(lastName, 'Last name');
  }
  if (phone !== undefined) {
    if (phone !== null && phone !== '') {
      const trimmed = String(phone).trim();
      if (trimmed.length > 30) {
        throw new ValidationError('Phone must be less than 30 characters');
      }
      result.phone = trimmed;
    } else {
      result.phone = null;
    }
  }

  return result;
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
  validateCreateUserRequest,
  validateUpdateUserRequest,
  validateProfileUpdateRequest,
  validateTenantRegistrationRequest,
};
