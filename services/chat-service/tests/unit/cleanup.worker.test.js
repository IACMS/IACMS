import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as worker from '../../src/workers/cleanup.worker.js';
import prisma from '../../src/config/database.js';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      chatMessage: {
        deleteMany: vi.fn(),
      },
      chatOutboxEvent: {
        deleteMany: vi.fn(),
      }
    },
  };
});

describe('Cleanup Worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    worker.stop();
  });

  it('should run cleanup tasks on start', async () => {
    prisma.chatMessage.deleteMany.mockResolvedValue({ count: 5 });
    prisma.chatOutboxEvent.deleteMany.mockResolvedValue({ count: 2 });

    await worker.start();

    // Verify it called chatMessage.deleteMany with correctly formed query
    expect(prisma.chatMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        deletedAt: {
          not: null,
          lt: expect.any(Date),
        }
      }
    });

    expect(prisma.chatOutboxEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        status: 'FAILED',
        createdAt: {
          lt: expect.any(Date),
        }
      }
    });

    worker.stop();
  });
});
