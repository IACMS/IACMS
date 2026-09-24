import { Kafka, Partitioners } from 'kafkajs';

const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');

export const kafka = new Kafka({
  clientId: 'chat-service',
  brokers,
});

export const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});

export const createConsumer = (groupId) => {
  return kafka.consumer({ groupId });
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
