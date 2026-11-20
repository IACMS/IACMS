/**
 * StoragePath — builds the canonical storage path for a file.
 *
 * Pattern: service/module/YYYY/MM/fileId.bin
 */
import { randomUUID } from 'crypto';

export class StoragePath {
  /**
   * Build the storage path for a file.
   * @param {{ service: string, module: string, fileId?: string, date?: Date }} opts
   * @returns {string}
   */
  static build({ service, module, fileId, date = new Date() }) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const safeService = StoragePath._sanitize(service);
    const safeModule = StoragePath._sanitize(module);
    const id = fileId || randomUUID();
    return `${safeService}/${safeModule}/${year}/${month}/${id}.bin`;
  }

  /**
   * Build the storage path for a thumbnail.
   * @param {{ service: string, module: string, fileId: string, size: number, date?: Date }} opts
   * @returns {string}
   */
  static buildThumbnail({ service, module, fileId, size, date = new Date() }) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const safeService = StoragePath._sanitize(service);
    const safeModule = StoragePath._sanitize(module);
    return `${safeService}/${safeModule}/${year}/${month}/thumbs/${fileId}-${size}.jpg`;
  }

  /**
   * Build a temp path for a chunk during chunked upload staging.
   * @param {{ uploadId: string, chunkNumber: number }} opts
   * @returns {string}
   */
  static buildChunkTemp({ uploadId, chunkNumber }) {
    return `tmp/uploads/${uploadId}/${String(chunkNumber).padStart(6, '0')}.bin`;
  }

  static _sanitize(segment) {
    return segment
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
