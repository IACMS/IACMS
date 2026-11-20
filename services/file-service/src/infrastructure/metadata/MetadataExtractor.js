import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Logger from '../../../../../shared/common/logger.js';

const execFileAsync = promisify(execFile);
const logger = new Logger('file-service');

/**
 * MetadataExtractor — extracts type-specific metadata for images, video/audio, and PDFs.
 */
export class MetadataExtractor {
  /**
   * @param {Buffer} buffer
   * @param {string} mimeType
   * @returns {Promise<object>}
   */
  static async extract(buffer, mimeType) {
    try {
      if (mimeType?.startsWith('image/')) {
        return await MetadataExtractor._fromImage(buffer);
      }
      if (mimeType?.startsWith('video/') || mimeType?.startsWith('audio/')) {
        return await MetadataExtractor._fromMedia(buffer);
      }
      if (mimeType === 'application/pdf') {
        return await MetadataExtractor._fromPdf(buffer);
      }
      return {};
    } catch (err) {
      logger.warn('Metadata extraction failed', { mimeType, error: err.message });
      return {};
    }
  }

  static async _fromImage(buffer) {
    const meta = {};
    try {
      const sharp = (await import('sharp')).default;
      const info = await sharp(buffer).metadata();
      meta.width = info.width;
      meta.height = info.height;
      meta.format = info.format;
    } catch {
      /* ignore */
    }

    try {
      const exifr = (await import('exifr')).default;
      const exif = await exifr.parse(buffer, { gps: true });
      if (exif) {
        if (exif.Make) meta.cameraMake = exif.Make;
        if (exif.Model) meta.cameraModel = exif.Model;
        if (exif.ISO) meta.iso = exif.ISO;
        if (exif.FNumber) meta.fStop = exif.FNumber;
        if (exif.latitude != null) meta.gpsLat = exif.latitude;
        if (exif.longitude != null) meta.gpsLng = exif.longitude;
      }
    } catch {
      /* exifr optional */
    }

    return meta;
  }

  static async _fromMedia(buffer) {
    let tmpDir = null;
    try {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'fms-meta-'));
      const inputPath = path.join(tmpDir, 'input.bin');
      writeFileSync(inputPath, buffer);

      const { stdout } = await execFileAsync(
        'ffprobe',
        ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
        { timeout: 15000 }
      );

      const probe = JSON.parse(stdout);
      const videoStream = (probe.streams || []).find((s) => s.codec_type === 'video');
      const audioStream = (probe.streams || []).find((s) => s.codec_type === 'audio');
      const format = probe.format || {};

      return {
        duration: format.duration ? parseFloat(format.duration) : undefined,
        bitrate: format.bit_rate ? parseInt(format.bit_rate, 10) : undefined,
        width: videoStream?.width,
        height: videoStream?.height,
        codec: videoStream?.codec_name || audioStream?.codec_name,
        fps: videoStream?.r_frame_rate
          ? (() => {
              const [n, d] = videoStream.r_frame_rate.split('/').map(Number);
              return d ? n / d : n;
            })()
          : undefined,
      };
    } catch (err) {
      logger.warn('ffprobe metadata failed', { error: err.message });
      return {};
    } finally {
      if (tmpDir) {
        try {
          unlinkSync(path.join(tmpDir, 'input.bin'));
          rmdirSync(tmpDir);
        } catch {
          /* ignore */
        }
      }
    }
  }

  static async _fromPdf(buffer) {
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(buffer);
      return {
        pages: data.numpages,
        author: data.info?.Author,
        title: data.info?.Title,
        creationDate: data.info?.CreationDate,
      };
    } catch (err) {
      logger.warn('PDF metadata failed', { error: err.message });
      return {};
    }
  }
}
