import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createWriteStream, unlinkSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import config from '../../config/index.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * VideoCompressor — H264 compression via fluent-ffmpeg.
 * Disabled by default (COMPRESSION_VIDEO_ENABLED=false).
 */
export class VideoCompressor {
  /**
   * @param {Buffer} input
   * @returns {Promise<{ buffer: Buffer, mimeType: string, compressionType: string }|null>}
   */
  static async compress(input) {
    if (!config.compression.video.enabled) return null;

    let tmpDir = null;
    try {
      const ffmpeg = (await import('fluent-ffmpeg')).default;
      tmpDir = mkdtempSync(path.join(tmpdir(), 'fms-video-'));
      const inputPath = path.join(tmpDir, 'input.bin');
      const outputPath = path.join(tmpDir, 'output.mp4');

      await pipeline(Readable.from(input), createWriteStream(inputPath));

      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .videoCodec('libx264')
          .outputOptions([`-crf ${config.compression.video.crf || 23}`, '-preset medium'])
          .on('end', resolve)
          .on('error', reject)
          .save(outputPath);
      });

      const buffer = readFileSync(outputPath);
      return { buffer, mimeType: 'video/mp4', compressionType: 'h264' };
    } catch (err) {
      logger.warn('Video compression failed', { error: err.message });
      return null;
    } finally {
      if (tmpDir) {
        try {
          unlinkSync(path.join(tmpDir, 'input.bin'));
          unlinkSync(path.join(tmpDir, 'output.mp4'));
        } catch {
          /* ignore */
        }
      }
    }
  }
}
