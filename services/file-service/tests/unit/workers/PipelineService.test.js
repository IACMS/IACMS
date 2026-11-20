import { describe, it, expect } from 'vitest';
import { PipelineService } from '../../../src/application/services/PipelineService.js';

describe('PipelineService.isProcessingComplete', () => {
  it('marks non-image, no-compress file complete when metadata is set', () => {
    const file = {
      compressRequested: false,
      compressed: false,
      mimeType: 'application/pdf',
      thumbnails: null,
      metadata: { pages: 1 },
    };
    expect(PipelineService.isProcessingComplete(file)).toBe(true);
  });

  it('requires compression when compressRequested', () => {
    const file = {
      compressRequested: true,
      compressed: false,
      mimeType: 'image/png',
      thumbnails: {},
      metadata: {},
    };
    expect(PipelineService.isProcessingComplete(file)).toBe(false);
  });

  it('requires thumbnails for images when thumbnail feature is enabled', () => {
    const file = {
      compressRequested: false,
      compressed: false,
      mimeType: 'image/png',
      thumbnails: null,
      metadata: {},
    };
    expect(PipelineService.isProcessingComplete(file)).toBe(false);
  });

  it('accepts empty thumbnails object as completed thumbnail step', () => {
    const file = {
      compressRequested: false,
      compressed: false,
      mimeType: 'image/png',
      thumbnails: {},
      metadata: {},
    };
    expect(PipelineService.isProcessingComplete(file)).toBe(true);
  });
});
