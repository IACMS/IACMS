import EventBus, { TOPICS } from '../../../../../shared/utils/eventBus.js';
import config from '../../config/index.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');

let eventBus = null;

export function getEventBus() {
  if (!eventBus) {
    try {
      eventBus = new EventBus(config.kafka.brokers.join(','), config.kafka.groupId);
    } catch (err) {
      logger.warn('Failed to create Kafka EventBus', { error: err.message });
    }
  }
  return eventBus;
}

/**
 * KafkaPublisher — publishes FMS domain events.
 * All publish calls are non-blocking (errors are logged, never thrown to callers).
 */
export class KafkaPublisher {
  static async fileUploaded(file) {
    const bus = getEventBus();
    if (!bus) return;
    await bus.publish(TOPICS.FILE_UPLOADED, {
      fileId: file.id,
      service: file.service,
      module: file.module,
      referenceId: file.referenceId,
      mimeType: file.mimeType,
      size: Number(file.size),
      ownerId: file.ownerId,
    });
  }

  static async fileProcessed(file) {
    const bus = getEventBus();
    if (!bus) return;
    await bus.publish(TOPICS.FILE_PROCESSED, {
      fileId: file.id,
      service: file.service,
      thumbnails: file.thumbnails,
      metadata: file.metadata,
    });
  }

  static async fileDeleted(file, deletedBy) {
    const bus = getEventBus();
    if (!bus) return;
    await bus.publish(TOPICS.FILE_DELETED, {
      fileId: file.id,
      service: file.service,
      module: file.module,
      referenceId: file.referenceId,
      deletedBy,
    });
  }

  static async fileVirusFound(file, threat) {
    const bus = getEventBus();
    if (!bus) return;
    await bus.publish(TOPICS.FILE_VIRUS_FOUND, {
      fileId: file.id,
      service: file.service,
      module: file.module,
      originalName: file.originalName,
      threat,
    });
  }

  static async filePermanentlyDeleted(file) {
    const bus = getEventBus();
    if (!bus) return;
    await bus.publish(TOPICS.FILE_PERMANENTLY_DELETED, {
      fileId: file.id,
      service: file.service,
      module: file.module,
    });
  }

  /**
   * Structured audit event → Audit Service via audit.log topic.
   */
  static async audit(action, file, actorId = null) {
    const bus = getEventBus();
    if (!bus) return;
    await bus.publish(TOPICS.AUDIT_LOG, {
      action,
      entityType: 'file',
      entityId: file.id,
      userId: actorId || file.ownerId,
      tenantId: null,
      metadata: {
        service: file.service,
        module: file.module,
        referenceId: file.referenceId,
        mimeType: file.mimeType,
        size: Number(file.size),
      },
    });
  }
}
