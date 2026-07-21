import { describe, it, expect } from 'vitest';
import { StoragePath } from '../../../src/domain/value-objects/StoragePath.js';

describe('StoragePath', () => {
  describe('build()', () => {
    it('returns correct pattern: service/module/YYYY/MM/uuid.bin', () => {
      const date = new Date('2026-07-15');
      const path = StoragePath.build({
        service: 'case-management',
        module: 'evidence',
        fileId: 'abc-123',
        date,
      });
      expect(path).toBe('case-management/evidence/2026/07/abc-123.bin');
    });

    it('zero-pads single-digit months', () => {
      const date = new Date('2026-03-01');
      const path = StoragePath.build({ service: 'chat', module: 'conversation', fileId: 'x', date });
      expect(path).toContain('/03/');
    });

    it('sanitizes uppercase to lowercase', () => {
      const path = StoragePath.build({ service: 'CASE-MGT', module: 'Evidence', fileId: 'y' });
      expect(path).toMatch(/^case-mgt\/evidence\//);
    });

    it('replaces spaces and special chars with hyphens', () => {
      const path = StoragePath.build({ service: 'my service!', module: 'my@module', fileId: 'z' });
      expect(path).toMatch(/^my-service\/my-module\//);
    });

    it('collapses consecutive hyphens into one', () => {
      const path = StoragePath.build({ service: 'a--b--c', module: 'x', fileId: 'z' });
      expect(path.split('/')[0]).toBe('a-b-c');
    });

    it('generates a UUID fileId when none is provided', () => {
      const path = StoragePath.build({ service: 'chat', module: 'conv', fileId: undefined });
      // UUID pattern at end: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.bin
      expect(path).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$/);
    });

    it('never contains the word "uploads" or exposes original filename', () => {
      const path = StoragePath.build({ service: 'hr', module: 'docs', fileId: 'myuuid' });
      expect(path).not.toContain('uploads');
      expect(path).not.toContain('original');
    });

    it('always ends with .bin', () => {
      const path = StoragePath.build({ service: 'finance', module: 'invoices', fileId: 'f1' });
      expect(path).toMatch(/\.bin$/);
    });
  });

  describe('buildThumbnail()', () => {
    it('places thumbnails in a thumbs/ sub-directory', () => {
      const path = StoragePath.buildThumbnail({
        service: 'case-management',
        module: 'evidence',
        fileId: 'abc',
        size: 250,
        date: new Date('2026-07-01'),
      });
      expect(path).toContain('/thumbs/');
      expect(path).toContain('-250.jpg');
    });

    it('thumbnail path shares the same service/module/year/month prefix as the original', () => {
      const date = new Date('2026-07-01');
      const filePath  = StoragePath.build({ service: 'chat', module: 'conv', fileId: 'u1', date });
      const thumbPath = StoragePath.buildThumbnail({ service: 'chat', module: 'conv', fileId: 'u1', size: 100, date });

      const filePrefix  = filePath.split('/').slice(0, 4).join('/');
      const thumbPrefix = thumbPath.split('/').slice(0, 4).join('/');
      expect(thumbPrefix).toBe(filePrefix);
    });
  });

  describe('buildChunkTemp()', () => {
    it('returns a path under tmp/uploads/', () => {
      const path = StoragePath.buildChunkTemp({ uploadId: 'upload-uuid', chunkNumber: 3 });
      expect(path).toMatch(/^tmp\/uploads\/upload-uuid\//);
    });

    it('zero-pads chunk numbers to 6 digits', () => {
      const path = StoragePath.buildChunkTemp({ uploadId: 'uid', chunkNumber: 14 });
      expect(path).toContain('000014.bin');
    });
  });
});
