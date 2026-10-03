import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as worker from '../../src/workers/notification.worker.js';
import * as presence from '../../src/websocket/presence.js';
import * as pubsub from '../../src/websocket/pubsub.js';
import { TOPICS } from '../../src/config/kafka.js';

// Mock Kafka consumer
const mockConsumer = {
  connect: vi.fn().mockResolvedValue(),
  subscribe: vi.fn().mockResolvedValue(),
  run: vi.fn().mockResolvedValue(),
  disconnect: vi.fn().mockResolvedValue(),
  commitOffsets: vi.fn().mockResolvedValue(),
};

vi.mock('../../src/config/kafka.js', () => {
  return {
    createConsumer: vi.fn(() => mockConsumer),
    ensureTopicsExist: vi.fn().mockResolvedValue(),
    TOPICS: {
      CHAT_MESSAGE_CREATED: 'chat.message.created',
      CASE_ASSIGNED: 'case.assigned',
      CASE_UPDATED: 'case.updated',
    }
  };
});

vi.mock('../../src/websocket/presence.js', () => ({
  getBulkPresence: vi.fn(),
  getActiveConversation: vi.fn(),
}));

vi.mock('../../src/websocket/pubsub.js', () => ({
  publish: vi.fn().mockResolvedValue(),
}));

describe('Notification Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    worker.stop();
  });

  it('should start and subscribe to topics', async () => {
    await worker.start();
    
    expect(mockConsumer.connect).toHaveBeenCalled();
    expect(mockConsumer.subscribe).toHaveBeenCalledWith({ topic: TOPICS.CHAT_MESSAGE_CREATED, fromBeginning: false });
    expect(mockConsumer.run).toHaveBeenCalled();
  });

  it('should process CHAT_MESSAGE_CREATED and send notification if user is offline', async () => {
    await worker.start();
    
    const runCall = mockConsumer.run.mock.calls[0][0];
    const eachMessage = runCall.eachMessage;

    // Simulate presence: user2 is offline, user3 is online
    const mockMap = new Map();
    mockMap.set('user2', false);
    mockMap.set('user3', true);
    presence.getBulkPresence.mockResolvedValue(mockMap);
    
    // user3 is online, but actively viewing a different conversation
    presence.getActiveConversation.mockImplementation(async (id) => {
      if (id === 'user3') return 'conv-other';
      return null;
    });

    const message = {
      value: Buffer.from(JSON.stringify({
        data: {
          conversationId: 'conv-123',
          messageId: 'msg-123',
          senderId: 'user1',
          senderName: 'John',
          recipientIds: ['user2', 'user3', 'user1'], // user1 is sender, should be skipped
          contentPreview: 'Hello'
        }
      })),
      offset: '10'
    };

    await eachMessage({ topic: TOPICS.CHAT_MESSAGE_CREATED, partition: 0, message });

    // Should fetch notification service for user2 (offline) and user3 (online but diff conv)
    expect(global.fetch).toHaveBeenCalledTimes(2);
    
    const reqBody2 = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(reqBody2.recipientId).toBe('user2');
    
    const reqBody3 = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(reqBody3.recipientId).toBe('user3');

    // Should commit offset
    expect(mockConsumer.commitOffsets).toHaveBeenCalledWith([
      { topic: TOPICS.CHAT_MESSAGE_CREATED, partition: 0, offset: '11' }
    ]);
  });

  it('should process CASE_ASSIGNED and publish NOTIFICATION_CREATED to pubsub', async () => {
    await worker.start();
    
    const runCall = mockConsumer.run.mock.calls[0][0];
    const eachMessage = runCall.eachMessage;

    const message = {
      value: Buffer.from(JSON.stringify({
        recipientId: 'user-case-1',
        title: 'New Case',
        data: { caseId: '123' }
      })),
      offset: '20'
    };

    await eachMessage({ topic: TOPICS.CASE_ASSIGNED, partition: 0, message });

    expect(pubsub.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'NOTIFICATION_CREATED',
      data: expect.objectContaining({
        recipientId: 'user-case-1',
        notificationType: 'CASE_ASSIGNED',
        title: 'New Case'
      })
    }));

    // Should commit offset
    expect(mockConsumer.commitOffsets).toHaveBeenCalledWith([
      { topic: TOPICS.CASE_ASSIGNED, partition: 0, offset: '21' }
    ]);
  });
});
