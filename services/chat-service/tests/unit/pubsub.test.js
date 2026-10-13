import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/redis.js', () => {
  const listeners = new Map();
  return {
    redisPub: {
      publish: vi.fn().mockResolvedValue(1),
    },
    redisSub: {
      subscribe: vi.fn().mockResolvedValue('OK'),
      on: vi.fn((event, handler) => {
        listeners.set(event, handler);
      }),
      // test helper to simulate receiving a message
      emitMessage: (channel, msg) => {
        const handler = listeners.get('message');
        if (handler) handler(channel, msg);
      },
    },
  };
});

vi.mock('../../src/websocket/connection.registry.js', () => ({
  broadcastToConversation: vi.fn(),
  sendToUser: vi.fn(),
}));

import * as pubsub from '../../src/websocket/pubsub.js';
import { redisPub, redisSub } from '../../src/config/redis.js';
import * as registry from '../../src/websocket/connection.registry.js';

describe('PubSub Bridge (src/websocket/pubsub.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes to Redis Pub/Sub channel and registers on("message") listener', async () => {
    await pubsub.subscribe();
    expect(redisSub.subscribe).toHaveBeenCalledWith('chat:pubsub');
    expect(redisSub.on).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('publish writes JSON string payload to redisPub channel', async () => {
    const event = { type: 'MESSAGE_CREATED', conversationId: 'conv-10', data: { id: 'm-1' } };
    await pubsub.publish(event);
    expect(redisPub.publish).toHaveBeenCalledWith('chat:pubsub', JSON.stringify(event));
  });

  it('handles MESSAGE_CREATED event by broadcasting to conversation and notifying participants', async () => {
    await pubsub.subscribe();
    const event = {
      type: 'MESSAGE_CREATED',
      conversationId: 'conv-1',
      participantUserIds: ['u1', 'u2'],
      data: { id: 'msg-1', content: 'Hello' },
    };

    redisSub.emitMessage('chat:pubsub', JSON.stringify(event));

    expect(registry.broadcastToConversation).toHaveBeenCalledWith('conv-1', {
      type: 'MESSAGE_CREATED',
      data: { id: 'msg-1', content: 'Hello' },
    });
    expect(registry.sendToUser).toHaveBeenCalledWith('u1', {
      type: 'CONVERSATION_ACTIVITY',
      data: { conversationId: 'conv-1', message: { id: 'msg-1', content: 'Hello' } },
    });
    expect(registry.sendToUser).toHaveBeenCalledWith('u2', {
      type: 'CONVERSATION_ACTIVITY',
      data: { conversationId: 'conv-1', message: { id: 'msg-1', content: 'Hello' } },
    });
  });

  it('handles CONVERSATION_CREATED event by delivering to participant users', async () => {
    await pubsub.subscribe();
    const event = {
      type: 'CONVERSATION_CREATED',
      conversationId: 'conv-2',
      participantUserIds: ['u1', 'u3'],
      data: { id: 'conv-2', title: 'New Room' },
    };

    redisSub.emitMessage('chat:pubsub', JSON.stringify(event));

    expect(registry.sendToUser).toHaveBeenCalledWith('u1', {
      type: 'CONVERSATION_CREATED',
      data: { id: 'conv-2', title: 'New Room' },
    });
    expect(registry.sendToUser).toHaveBeenCalledWith('u3', {
      type: 'CONVERSATION_CREATED',
      data: { id: 'conv-2', title: 'New Room' },
    });
  });

  it('handles MESSAGE_UPDATED, MESSAGE_DELETED, and reactions by broadcasting to conversation', async () => {
    await pubsub.subscribe();
    const events = [
      { type: 'MESSAGE_UPDATED', conversationId: 'c1', data: { id: 'm1', content: 'Updated' } },
      { type: 'MESSAGE_DELETED', conversationId: 'c1', data: { messageId: 'm1' } },
      { type: 'REACTION_ADDED', conversationId: 'c1', data: { emoji: '👍' } },
      { type: 'REACTION_REMOVED', conversationId: 'c1', data: { emoji: '👍' } },
      { type: 'MESSAGE_PINNED', conversationId: 'c1', data: { messageId: 'm1' } },
      { type: 'MESSAGE_UNPINNED', conversationId: 'c1', data: { unpinnedBy: 'u1' } },
    ];

    for (const evt of events) {
      redisSub.emitMessage('chat:pubsub', JSON.stringify(evt));
      expect(registry.broadcastToConversation).toHaveBeenCalledWith(evt.conversationId, {
        type: evt.type,
        data: evt.data,
      });
    }
  });

  it('handles TYPING_START and TYPING_STOP by broadcasting but excluding the typer', async () => {
    await pubsub.subscribe();
    const event = {
      type: 'TYPING_START',
      conversationId: 'c1',
      data: { userId: 'typer-1', firstName: 'Alice' },
    };

    redisSub.emitMessage('chat:pubsub', JSON.stringify(event));

    expect(registry.broadcastToConversation).toHaveBeenCalledWith(
      'c1',
      { type: 'TYPING_START', data: { userId: 'typer-1', firstName: 'Alice' } },
      'typer-1'
    );
  });

  it('handles PRESENCE_CHANGE across conversationIds', async () => {
    await pubsub.subscribe();
    const event = {
      type: 'PRESENCE_CHANGE',
      conversationIds: ['c1', 'c2'],
      data: { userId: 'u1', isOnline: true },
    };

    redisSub.emitMessage('chat:pubsub', JSON.stringify(event));

    expect(registry.broadcastToConversation).toHaveBeenCalledWith('c1', {
      type: 'PRESENCE_CHANGE',
      data: { userId: 'u1', isOnline: true },
    });
    expect(registry.broadcastToConversation).toHaveBeenCalledWith('c2', {
      type: 'PRESENCE_CHANGE',
      data: { userId: 'u1', isOnline: true },
    });
  });

  it('handles NOTIFICATION_CREATED by sending to recipient', async () => {
    await pubsub.subscribe();
    const event = {
      type: 'NOTIFICATION_CREATED',
      data: { recipientId: 'user-recip', title: 'New alert' },
    };

    redisSub.emitMessage('chat:pubsub', JSON.stringify(event));

    expect(registry.sendToUser).toHaveBeenCalledWith('user-recip', {
      type: 'NOTIFICATION_CREATED',
      data: { recipientId: 'user-recip', title: 'New alert' },
    });
  });

  it('safely ignores invalid JSON payloads and unknown channels', async () => {
    await pubsub.subscribe();
    // Message from another channel
    redisSub.emitMessage('other:channel', JSON.stringify({ type: 'TEST' }));
    expect(registry.broadcastToConversation).not.toHaveBeenCalled();

    // Invalid JSON
    redisSub.emitMessage('chat:pubsub', 'INVALID-NON-JSON');
    expect(registry.broadcastToConversation).not.toHaveBeenCalled();
  });
});
