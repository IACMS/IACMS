import config from '../../config/index.js';
import { MinIOStorage } from './minio/MinIOStorage.js';
import { LocalStorage } from './local/LocalStorage.js';

let instance = null;

/**
 * StorageFactory — returns the configured storage provider singleton.
 *
 * Business logic and controllers NEVER import storage adapters directly.
 * Always use StorageFactory.getInstance() so the provider can be swapped via config.
 *
 * Supported providers: minio, local
 * Future providers: s3 (added when needed)
 */
export class StorageFactory {
  /**
   * Get the active storage provider instance.
   * @returns {MinIOStorage | LocalStorage}
   */
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
        default:
          throw new Error(
            `Unknown storage provider: "${provider}". Set STORAGE_PROVIDER to one of: minio, local`
          );
      }
      console.log(`File Service: Using storage provider: ${provider}`);
    }
    return instance;
  }

  /**
   * Reset the singleton instance. Useful for testing.
   */
  static reset() {
    instance = null;
  }
}
