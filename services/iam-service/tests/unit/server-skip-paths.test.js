import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Item 1: Server and router authentication hardening', () => {
  const serverPath = path.resolve(process.cwd(), 'src/server.js');
  const roleRoutesPath = path.resolve(process.cwd(), 'src/routes/role.routes.js');
  const permRoutesPath = path.resolve(process.cwd(), 'src/routes/permission.routes.js');
  const userRoleRoutesPath = path.resolve(process.cwd(), 'src/routes/user-role.routes.js');
  const tenantRoutesPath = path.resolve(process.cwd(), 'src/routes/tenant.routes.js');

  it('removes allowOAuthBearer: true from server.js internal request guard', () => {
    const serverContent = fs.readFileSync(serverPath, 'utf8');
    expect(serverContent).not.toMatch(/allowOAuthBearer:\s*true/);
  });

  it('removes blanket /auth, /roles, /permissions, /api-keys from server.js skipPaths', () => {
    const serverContent = fs.readFileSync(serverPath, 'utf8');

    // Extract the requireInternalRequest skipPaths block
    const guardMatch = serverContent.match(/requireInternalRequest\(\{([\s\S]*?)\}\)/);
    expect(guardMatch).not.toBeNull();
    const guardConfig = guardMatch[1];

    expect(guardConfig).not.toMatch(/['"]\/auth['"]/);
    expect(guardConfig).not.toMatch(/['"]\/roles['"]/);
    expect(guardConfig).not.toMatch(/['"]\/permissions['"]/);
    expect(guardConfig).not.toMatch(/['"]\/api-keys['"]/);

    // Must include specific public auth routes
    expect(guardConfig).toContain("'/auth/login'");
    expect(guardConfig).toContain("'/auth/refresh'");
    expect(guardConfig).toContain("'/auth/forgot-password'");
    expect(guardConfig).toContain("'/auth/reset-password'");
    expect(guardConfig).toContain("'/auth/social'");
  });

  it('requires authentication on role, permission, user-role, and tenant routes', () => {
    const roleContent = fs.readFileSync(roleRoutesPath, 'utf8');
    expect(roleContent).toMatch(/authenticateToken|authenticateAdminRequest/);

    const permContent = fs.readFileSync(permRoutesPath, 'utf8');
    expect(permContent).toMatch(/authenticateToken|authenticateAdminRequest/);

    const userRoleContent = fs.readFileSync(userRoleRoutesPath, 'utf8');
    expect(userRoleContent).toMatch(/authenticateToken|authenticateAdminRequest/);

    const tenantContent = fs.readFileSync(tenantRoutesPath, 'utf8');
    expect(tenantContent).toMatch(/router\.get\(\s*['"]\/['"],\s*authenticateToken/);
  });
});
