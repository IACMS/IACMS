import { TOPICS } from '../../../../../shared/utils/eventBus.js';
import { getEventBus } from './KafkaPublisher.js';
import { PrismaFileRepository } from '../persistence/PrismaFileRepository.js';
import config from '../../config/index.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('file-service');
const fileRepo = new PrismaFileRepository();

/**
 * Subscribe to case.deleted → cascade soft-delete all files for that referenceId.
 */
export async function startKafkaConsumers() {
  const bus = getEventBus();
  if (!bus) {
    logger.warn('Kafka EventBus unavailable — consumers not started');
    return;
  }

  bus.subscribe(TOPICS.CASE_DELETED, async (event) => {
    const data = event?.data || event;
    const referenceId = data.caseId || data.referenceId || data.id;
    if (!referenceId) {
      logger.warn('case.deleted event missing caseId/referenceId', { data });
      return;
    }

    const scheduledDeleteAt = new Date(
      Date.now() + config.retention.defaultSoftDeleteDays * 24 * 60 * 60 * 1000
    );

    const result = await fileRepo.softDeleteByReferenceId(String(referenceId), {
      scheduledDeleteAt,
    });

    logger.info('Cascaded soft-delete from case.deleted', {
      referenceId,
      count: result.count,
    });
  });

  logger.info('FMS Kafka consumers registered', { topics: [TOPICS.CASE_DELETED] });
}
