import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config module before importing MimeTypeGuard
vi.mock('../../../src/config/index.js', () => ({
  default: {
    upload: {
      blockedExtensions: ['.exe', '.sh', '.bat', '.cmd', '.ps1', '.vbs', '.scr', '.pif', '.com'],
    },
  },
}));

const { MimeTypeGuard } = await import('../../../src/domain/value-objects/MimeTypeGuard.js');

describe('MimeTypeGuard', () => {
  describe('isBlocked()', () => {
    it('returns true for .exe files', () => {
      expect(MimeTypeGuard.isBlocked('malware.exe')).toBe(true);
    });

    it('returns true for .sh files', () => {
      expect(MimeTypeGuard.isBlocked('script.sh')).toBe(true);
    });

    it('returns true for .bat files', () => {
      expect(MimeTypeGuard.isBlocked('run.bat')).toBe(true);
    });

    it('returns true for .cmd files', () => {
      expect(MimeTypeGuard.isBlocked('run.cmd')).toBe(true);
    });

    it('returns true for .ps1 files', () => {
      expect(MimeTypeGuard.isBlocked('script.ps1')).toBe(true);
    });

    it('is case-insensitive — blocks .EXE and .SH', () => {
      expect(MimeTypeGuard.isBlocked('virus.EXE')).toBe(true);
      expect(MimeTypeGuard.isBlocked('script.SH')).toBe(true);
    });

    it('returns false for .pdf files', () => {
      expect(MimeTypeGuard.isBlocked('document.pdf')).toBe(false);
    });

    it('returns false for .jpg files', () => {
      expect(MimeTypeGuard.isBlocked('photo.jpg')).toBe(false);
    });

    it('returns false for .mp4 files', () => {
      expect(MimeTypeGuard.isBlocked('video.mp4')).toBe(false);
    });

    it('returns false for .docx files', () => {
      expect(MimeTypeGuard.isBlocked('report.docx')).toBe(false);
    });

    it('returns false for empty filename', () => {
      expect(MimeTypeGuard.isBlocked('')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(MimeTypeGuard.isBlocked(null)).toBe(false);
      expect(MimeTypeGuard.isBlocked(undefined)).toBe(false);
    });
  });

  describe('isImage()', () => {
    it('returns true for image/jpeg', () => expect(MimeTypeGuard.isImage('image/jpeg')).toBe(true));
    it('returns true for image/png',  () => expect(MimeTypeGuard.isImage('image/png')).toBe(true));
    it('returns true for image/webp', () => expect(MimeTypeGuard.isImage('image/webp')).toBe(true));
    it('returns false for video/mp4', () => expect(MimeTypeGuard.isImage('video/mp4')).toBe(false));
    it('returns false for application/pdf', () => expect(MimeTypeGuard.isImage('application/pdf')).toBe(false));
  });

  describe('isVideo()', () => {
    it('returns true for video/mp4',  () => expect(MimeTypeGuard.isVideo('video/mp4')).toBe(true));
    it('returns true for video/webm', () => expect(MimeTypeGuard.isVideo('video/webm')).toBe(true));
    it('returns false for audio/mp3', () => expect(MimeTypeGuard.isVideo('audio/mp3')).toBe(false));
    it('returns false for image/jpeg', () => expect(MimeTypeGuard.isVideo('image/jpeg')).toBe(false));
  });

  describe('isAudio()', () => {
    it('returns true for audio/mpeg', () => expect(MimeTypeGuard.isAudio('audio/mpeg')).toBe(true));
    it('returns true for audio/wav',  () => expect(MimeTypeGuard.isAudio('audio/wav')).toBe(true));
    it('returns false for video/mp4', () => expect(MimeTypeGuard.isAudio('video/mp4')).toBe(false));
  });

  describe('isPdf()', () => {
    it('returns true for application/pdf',  () => expect(MimeTypeGuard.isPdf('application/pdf')).toBe(true));
    it('returns false for application/zip', () => expect(MimeTypeGuard.isPdf('application/zip')).toBe(false));
    it('returns false for text/plain',      () => expect(MimeTypeGuard.isPdf('text/plain')).toBe(false));
  });

  describe('normalize()', () => {
    it('lowercases the MIME type', () => {
      expect(MimeTypeGuard.normalize('Image/JPEG')).toBe('image/jpeg');
    });

    it('strips charset and other parameters', () => {
      expect(MimeTypeGuard.normalize('text/html; charset=UTF-8')).toBe('text/html');
    });

    it('returns application/octet-stream for empty string', () => {
      expect(MimeTypeGuard.normalize('')).toBe('application/octet-stream');
    });

    it('returns application/octet-stream for null', () => {
      expect(MimeTypeGuard.normalize(null)).toBe('application/octet-stream');
    });

    it('returns application/octet-stream for undefined', () => {
      expect(MimeTypeGuard.normalize(undefined)).toBe('application/octet-stream');
    });

    it('trims surrounding whitespace', () => {
      expect(MimeTypeGuard.normalize('  image/png  ')).toBe('image/png');
    });
  });
});
