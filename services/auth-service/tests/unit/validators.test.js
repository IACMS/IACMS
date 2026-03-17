/**
 * Unit tests for auth validators.
 * Pure functions — no mocking needed.
 */

import { describe, it, expect } from 'vitest';
import {
  validateCreateUserRequest,
} from '../../src/utils/validators.js';

const VALID_UUID = '55555555-5555-5555-5555-555555555555';

const BASE_BODY = {
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  tenantCode: 'TEST-ORG',
};

describe('validateCreateUserRequest', () => {
  it('returns roleId when a valid UUID is provided', () => {
    const result = validateCreateUserRequest({ ...BASE_BODY, roleId: VALID_UUID });

    expect(result.roleId).toBe(VALID_UUID);
    expect(result.email).toBe('test@example.com');
  });

  it('returns roleId as null when roleId is omitted', () => {
    const result = validateCreateUserRequest(BASE_BODY);

    expect(result.roleId).toBeNull();
  });

  it('throws ValidationError when roleId is not a valid UUID', () => {
    expect(() =>
      validateCreateUserRequest({ ...BASE_BODY, roleId: 'not-a-uuid' })
    ).toThrow('Role ID must be a valid UUID');
  });

  it('throws ValidationError when both tenantCode and tenantId are missing', () => {
    const { tenantCode, ...bodyWithoutTenant } = BASE_BODY;

    expect(() =>
      validateCreateUserRequest(bodyWithoutTenant)
    ).toThrow('Tenant code is required');
  });

  it('accepts tenantId UUID instead of tenantCode', () => {
    const body = {
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      tenantId: VALID_UUID,
    };

    const result = validateCreateUserRequest(body);

    expect(result.tenantId).toBe(VALID_UUID);
    expect(result.tenantCode).toBeNull();
  });

  it('throws ValidationError when email is missing', () => {
    const { email, ...bodyWithoutEmail } = BASE_BODY;

    expect(() =>
      validateCreateUserRequest(bodyWithoutEmail)
    ).toThrow('Email is required');
  });

  it('throws ValidationError when firstName is missing', () => {
    expect(() =>
      validateCreateUserRequest({ ...BASE_BODY, firstName: '' })
    ).toThrow('First name is required');
  });
});
