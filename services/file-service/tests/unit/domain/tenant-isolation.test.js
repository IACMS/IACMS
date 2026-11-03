import { describe, it, expect } from 'vitest';
import { assertFileTenantAccess } from '../../../src/api/controllers/FileController.js';

describe('File Multi-Tenant Boundary Isolation', () => {
  it('allows access when caller belongs to the same tenant', () => {
    const file = { id: 'file-1', tenantId: 'tenant-a' };
    const req = { user: { id: 'user-1', tenantId: 'tenant-a' } };

    expect(() => assertFileTenantAccess(file, req)).not.toThrow();
  });

  it('rejects access and masks existence (NotFoundError) when caller belongs to a different tenant', () => {
    const file = { id: 'file-1', tenantId: 'tenant-a' };
    const req = { user: { id: 'user-2', tenantId: 'tenant-b', roles: ['user'], permissions: [] } };

    expect(() => assertFileTenantAccess(file, req)).toThrow('File');
  });

  it('allows cross-tenant access if user has system_admin role', () => {
    const file = { id: 'file-1', tenantId: 'tenant-a' };
    const req = { user: { id: 'admin-1', tenantId: 'tenant-b', roles: ['system_admin'], permissions: [] } };

    expect(() => assertFileTenantAccess(file, req)).not.toThrow();
  });

  it('allows cross-tenant access if user has file:admin permission', () => {
    const file = { id: 'file-1', tenantId: 'tenant-a' };
    const req = { user: { id: 'admin-2', tenantId: 'tenant-b', roles: ['user'], permissions: ['file:admin'] } };

    expect(() => assertFileTenantAccess(file, req)).not.toThrow();
  });

  it('allows cross-tenant access if user has wildcard (*) permission', () => {
    const file = { id: 'file-1', tenantId: 'tenant-a' };
    const req = { user: { id: 'admin-3', tenantId: 'tenant-b', roles: ['user'], permissions: ['*'] } };

    expect(() => assertFileTenantAccess(file, req)).not.toThrow();
  });

  it('allows access for legacy files without tenantId', () => {
    const legacyFile = { id: 'legacy-file-1', tenantId: null };
    const req = { user: { id: 'user-1', tenantId: 'tenant-b' } };

    expect(() => assertFileTenantAccess(legacyFile, req)).not.toThrow();
  });
});
