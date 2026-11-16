import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Tenant Logo Upload Security', () => {
  const tenantRoutesPath = path.resolve(process.cwd(), 'src/routes/tenant.routes.js');
  const serverPath = path.resolve(process.cwd(), 'src/server.js');

  it('prohibits SVG and HTML in allowed upload MIME types in tenant.routes.js', () => {
    const content = fs.readFileSync(tenantRoutesPath, 'utf8');
    expect(content).not.toContain('image/svg+xml');
    expect(content).not.toContain('text/html');
  });

  it('restricts allowed upload MIME types strictly to png, jpeg, and webp', async () => {
    const { tenantLogoFileFilter, ALLOWED_MIME_TYPES } = await import('../../src/routes/tenant.routes.js');
    expect(ALLOWED_MIME_TYPES).toBeDefined();
    expect(ALLOWED_MIME_TYPES.has('image/png')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('image/jpeg')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('image/webp')).toBe(true);
    expect(ALLOWED_MIME_TYPES.has('image/svg+xml')).toBe(false);

    // Test filter rejection of SVG
    const svgCb = vi.fn();
    tenantLogoFileFilter({}, { mimetype: 'image/svg+xml' }, svgCb);
    expect(svgCb).toHaveBeenCalledWith(expect.any(Error));

    // Test filter rejection of HTML
    const htmlCb = vi.fn();
    tenantLogoFileFilter({}, { mimetype: 'text/html' }, htmlCb);
    expect(htmlCb).toHaveBeenCalledWith(expect.any(Error));

    // Test filter acceptance of PNG
    const pngCb = vi.fn();
    tenantLogoFileFilter({}, { mimetype: 'image/png' }, pngCb);
    expect(pngCb).toHaveBeenCalledWith(null, true);
  });

  it('enforces 5MB size limit on uploads', async () => {
    const { UPLOAD_LIMITS } = await import('../../src/routes/tenant.routes.js');
    expect(UPLOAD_LIMITS).toBeDefined();
    expect(UPLOAD_LIMITS.fileSize).toBe(5 * 1024 * 1024);
  });

  it('sets X-Content-Type-Options: nosniff on static upload asset delivery in server.js', () => {
    const serverContent = fs.readFileSync(serverPath, 'utf8');
    expect(serverContent).toMatch(/\/tenants\/assets[\s\S]*nosniff/);
  });
});
