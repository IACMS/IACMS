import config from '../../config/index.js';
import { MinIOStorage } from './minio/MinIOStorage.js';
import { LocalStorage } from './local/LocalStorage.js';
import { S3Storage } from './s3/S3Storage.js';

let instance = null;

/**
 * StorageFactory — returns the configured storage provider singleton.
 * Supported providers: minio, local, s3
 */
export class StorageFactory {
  static getInstance() {
    if (!instance) {
      const provider = config.storage.provider;
      switch (provider) {
        case 'minio':
          instance = new MinIOStorage();
          break;
        case 'local':
          instance = new LocalStorage();
          break;
        case 's3':
          instance = new S3Storage();
          break;
        default:
          throw new Error(
            `Unknown storage provider: "${provider}". Set STORAGE_PROVIDER to one of: minio, local, s3`
          );
      }
      console.log(`File Service: Using storage provider: ${provider}`);
    }
    return instance;
  }

  static reset() {
    instance = null;
  }
}
