import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as attachmentService from '../../src/modules/attachments/attachment.service.js';

describe('Attachment Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('verifyOwnership: should return true if file service responds with verified=true', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ verified: true })
    });

    const result = await attachmentService.verifyOwnership('file-123', 'user-456');
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/internal/files/file-123/verify?userId=user-456'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': expect.stringContaining('Bearer ')
        })
      })
    );
  });

  it('verifyOwnership: should return false if file service returns 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404
    });

    const result = await attachmentService.verifyOwnership('file-123', 'user-456');
    expect(result).toBe(false);
  });

  it('verifyOwnership: should return false if file service returns 403', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403
    });

    const result = await attachmentService.verifyOwnership('file-123', 'user-456');
    expect(result).toBe(false);
  });

  it('verifyOwnership: should return false if file service fails (fail closed)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await attachmentService.verifyOwnership('file-123', 'user-456');
    expect(result).toBe(false);
  });
});
