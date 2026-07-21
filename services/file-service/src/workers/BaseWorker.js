import Logger from '../../../../shared/common/logger.js';
import { WorkerLock } from '../infrastructure/cache/WorkerLock.js';

const logger = new Logger('file-service');

/**
 * BaseWorker — poll-loop framework shared by all FMS background workers.
 *
 * Subclasses implement:
 *   async processBatch()  — find and process work items
 *
 * Lifecycle:
 *   start(intervalMs) → runs processBatch immediately, then on interval
 *   stop()            → clears timer
 */
export class BaseWorker {
  /**
   * @param {string} name
   */
  constructor(name) {
    this.name = name;
    this._timer = null;
    this._running = false;
  }

  /**
   * @param {number} intervalMs
   */
  start(intervalMs) {
    logger.info(`${this.name} starting`, { intervalMs });

    this._run().catch((err) =>
      logger.error(`${this.name} initial run failed`, { error: err.message })
    );

    this._timer = setInterval(() => {
      this._run().catch((err) =>
        logger.error(`${this.name} scheduled run failed`, { error: err.message })
      );
    }, intervalMs);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      logger.info(`${this.name} stopped`);
    }
  }

  async _run() {
    if (this._running) {
      logger.info(`${this.name}: previous run still in progress, skipping`);
      return;
    }
    this._running = true;
    try {
      await this.processBatch();
    } catch (err) {
      logger.error(`${this.name}: run failed`, { error: err.message });
    } finally {
      this._running = false;
    }
  }

  /**
   * Override in subclasses.
   * @returns {Promise<void>}
   */
  async processBatch() {
    throw new Error(`${this.name}.processBatch() not implemented`);
  }

  /**
   * Acquire a per-file Redis lock, run fn, then release.
   * @param {string} fileId
   * @param {() => Promise<void>} fn
   * @returns {Promise<boolean>} whether work was performed
   */
  async withFileLock(fileId, fn) {
    const acquired = await WorkerLock.acquire(fileId);
    if (!acquired) return false;
    try {
      await fn();
      return true;
    } finally {
      await WorkerLock.release(fileId);
    }
  }
}
