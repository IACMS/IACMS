import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as worker from '../../src/workers/outbox.worker.js';
import prisma from '../../src/config/database.js';
import { producer } from '../../src/config/kafka.js';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      chatOutboxEvent: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

vi.mock('../../src/config/kafka.js', () => {
  return {
    producer: {
      connect: vi.fn(),
      send: vi.fn(),
    },
    TOPICS: {
      CHAT_MESSAGE_CREATED: 'chat.message.created',
    }
  };
});

describe('Outbox Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    worker.stop(); // ensure it's not running
  });

  it('processBatch: should successfully publish events and mark them PUBLISHED', async () => {
    // Expose internal processBatch for testing
    // Since processBatch is not exported, we can trick it by exporting a test wrapper or just testing via start/stop.
    // For unit testing purposes here, let's assume we test the internal logic.
    // Given the constraints of modules, we can use `__get__` with babel, or just mock and call start() then stop().
    
    prisma.chatOutboxEvent.findMany.mockResolvedValueOnce([
      { id: 'event-1', eventType: 'CHAT_MESSAGE_CREATED', payload: { conversationId: 'c1' }, retryCount: 0 },
      { id: 'event-2', eventType: 'CHAT_MESSAGE_CREATED', payload: { conversationId: 'c1' }, retryCount: 0 },
    ]).mockResolvedValue([]); // return empty on second poll

    producer.send.mockResolvedValue();

    // Run one tick
    worker.start();
    await new Promise(r => setTimeout(r, 50));
    worker.stop();

    // Verify
    expect(prisma.chatOutboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1', 'event-2'] }, status: 'PENDING' },
      data: { status: 'PUBLISHING' },
    });

    expect(producer.send).toHaveBeenCalledTimes(2);

    expect(prisma.chatOutboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['event-1', 'event-2'] } },
      data: { status: 'PUBLISHED', publishedAt: expect.any(Date) },
    });
  });
});
