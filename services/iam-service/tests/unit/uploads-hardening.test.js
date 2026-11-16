import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('../../src/config/database.js', () => ({
  default: {
    tenant: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('Item 3: Uploads hardening and CSP verification', () => {
  const tenantRoutesPath = path.resolve(process.cwd(), 'src/routes/tenant.routes.js');
  const serverPath = path.resolve(process.cwd(), 'src/server.js');

  it('validates UUID for :id and authorises before multer runs in tenant.routes.js', () => {
    const content = fs.readFileSync(tenantRoutesPath, 'utf8');

    // UUID regex check exists
    expect(content).toMatch(/UUID|uuid/i);

    // Authorization middleware is registered before upload.single
    const match = content.match(/router\.post\(\s*['"]\/:id\/logo['"]([\s\S]*?)\);/);
    expect(match).not.toBeNull();

    const routeDefinition = match[1];
    const authPos = routeDefinition.indexOf('authorizeTenantLogoUpload');
    const multerPos = routeDefinition.indexOf('upload.single');

    expect(authPos).not.toBe(-1);
    expect(multerPos).not.toBe(-1);
    expect(authPos).toBeLessThan(multerPos);
  });

  it('derives file extension strictly from validated MIME type and checks magic bytes', async () => {
    const { validateMagicBytes, MIME_TO_EXTENSION } = await import('../../src/routes/tenant.routes.js');

    expect(MIME_TO_EXTENSION).toBeDefined();
    expect(MIME_TO_EXTENSION['image/png']).toBe('.png');
    expect(MIME_TO_EXTENSION['image/jpeg']).toBe('.jpg');
    expect(MIME_TO_EXTENSION['image/webp']).toBe('.webp');

    // Valid PNG magic bytes (89 50 4E 47 0D 0A 1A 0A)
    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(validateMagicBytes(validPng, 'image/png')).toBe(true);

    // Spoofed PNG (HTML file claiming image/png)
    const fakePng = Buffer.from('<script>alert("XSS")</script>');
    expect(validateMagicBytes(fakePng, 'image/png')).toBe(false);

    // Valid JPEG magic bytes (FF D8 FF)
    const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect(validateMagicBytes(validJpeg, 'image/jpeg')).toBe(true);

    // Spoofed JPEG
    const fakeJpeg = Buffer.from('NOT A JPEG');
    expect(validateMagicBytes(fakeJpeg, 'image/jpeg')).toBe(false);

    // Valid WebP magic bytes (RIFF at 0..3, WEBP at 8..11)
    const validWebp = Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ');
    expect(validateMagicBytes(validWebp, 'image/webp')).toBe(true);

    // Spoofed WebP
    const fakeWebp = Buffer.from('RIFF\x00\x00\x00\x00NOTPVP8 ');
    expect(validateMagicBytes(fakeWebp, 'image/webp')).toBe(false);
  });

  it('serves /tenants/assets with Content-Security-Policy: default-src \'none\' in server.js', () => {
    const serverContent = fs.readFileSync(serverPath, 'utf8');

    expect(serverContent).toMatch(/\/tenants\/assets/);
    expect(serverContent).toMatch(/Content-Security-Policy/);
    expect(serverContent).toMatch(/default-src\s+'none'/);
  });
});
