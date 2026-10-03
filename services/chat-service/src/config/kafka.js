import { Kafka, Partitioners } from 'kafkajs';

const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

export const kafka = new Kafka({
  clientId: 'chat-service',
  brokers,
});

export const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});

export const createConsumer = (groupId, options = {}) => {
  return kafka.consumer({
    groupId,
    allowAutoTopicCreation: true,
    ...options,
  });
};

export const ensureTopicsExist = async (topics) => {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const existingTopics = await admin.listTopics();
    const missingTopics = topics.filter((t) => !existingTopics.includes(t));
    if (missingTopics.length > 0) {
      console.log(`[kafka] Creating missing topics: ${missingTopics.join(', ')}`);
      await admin.createTopics({
        topics: missingTopics.map((topic) => ({
          topic,
          numPartitions: 1,
          replicationFactor: 1,
        })),
        waitForLeaders: true,
      });
    }
  } catch (err) {
    console.warn('[kafka] Note while ensuring topics exist:', err.message);
  } finally {
    try {
      await admin.disconnect();
    } catch (_) {}
  }
};

// Common topics
export const TOPICS = {
  CHAT_MESSAGE_CREATED: 'chat.message.created',
  CHAT_MESSAGE_UPDATED: 'chat.message.updated',
  CHAT_MESSAGE_DELETED: 'chat.message.deleted',
  CHAT_GROUP_MEMBER_ADDED: 'chat.group.member.added',
  CHAT_GROUP_MEMBER_REMOVED: 'chat.group.member.removed',
  CHAT_READ_RECEIPT: 'chat.read.receipt',
  
  // Consumed from other services
  CASE_ASSIGNED: 'case.assigned',
  CASE_UPDATED: 'case.updated',
};
