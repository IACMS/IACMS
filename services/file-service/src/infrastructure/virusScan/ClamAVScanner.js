import net from 'net';
import config from '../../config/index.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');

/**
 * ClamAV client using the clamd INSTREAM protocol over TCP.
 *
 * Feature-flagged via VIRUS_SCAN_ENABLED. When disabled, scan() returns clean.
 */
export class ClamAVScanner {
  /**
   * Scan a Buffer for viruses.
   * @param {Buffer} buffer
   * @returns {Promise<{ clean: boolean, threat: string|null }>}
   */
  async scan(buffer) {
    if (!config.virusScan.enabled) {
      return { clean: true, threat: null };
    }

    try {
      const result = await this._instream(buffer);
      return result;
    } catch (err) {
      logger.warn('ClamAV scan failed', { error: err.message, failOpen: config.virusScan.failOpen });
      if (config.virusScan.failOpen) {
        return { clean: true, threat: null };
      }
      throw err;
    }
  }

  /**
   * @param {Buffer} buffer
   * @returns {Promise<{ clean: boolean, threat: string|null }>}
   */
  _instream(buffer) {
    const { host, port, timeoutMs } = config.virusScan;

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        // zINSTREAM\0 then length-prefixed chunks, then zero-length terminator
        socket.write(Buffer.from('zINSTREAM\0'));

        const CHUNK = 2048;
        for (let offset = 0; offset < buffer.length; offset += CHUNK) {
          const slice = buffer.subarray(offset, Math.min(offset + CHUNK, buffer.length));
          const size = Buffer.alloc(4);
          size.writeUInt32BE(slice.length, 0);
          socket.write(size);
          socket.write(slice);
        }

        const end = Buffer.alloc(4);
        end.writeUInt32BE(0, 0);
        socket.write(end);
      });

      let response = '';
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`ClamAV timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.on('data', (data) => {
        response += data.toString('utf8');
      });

      socket.on('end', () => {
        clearTimeout(timer);
        const text = response.trim();
        if (text.includes('OK') && !text.includes('FOUND')) {
          resolve({ clean: true, threat: null });
        } else if (text.includes('FOUND')) {
          const threat = text.replace('stream: ', '').replace(' FOUND', '').trim();
          resolve({ clean: false, threat: threat || 'UNKNOWN' });
        } else {
          reject(new Error(`Unexpected ClamAV response: ${text}`));
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
}
