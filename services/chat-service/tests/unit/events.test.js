import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/websocket/pubsub.js', () => ({
  publish: vi.fn().mockResolvedValue(true),
}));

import * as events from '../../src/websocket/events.js';
import { publish } from '../../src/websocket/pubsub.js';

describe('WebSocket Event Emitters (src/websocket/events.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emitMessageCreated emits MESSAGE_CREATED payload', async () => {
    const message = {
      id: 'msg-1',
      conversationId: 'conv-1',
      senderId: 'user-1',
      clientMessageId: 'cli-1',
      sender: { id: 'user-1', name: 'Alice' },
      messageType: 'TEXT',
      content: 'Hello World',
      replyToId: null,
      replyTo: null,
      attachments: [],
      createdAt: new Date(),
      participantUserIds: ['user-1', 'user-2'],
    };

    await events.emitMessageCreated(message);

    expect(publish).toHaveBeenCalledWith({
      type: 'MESSAGE_CREATED',
      conversationId: 'conv-1',
      participantUserIds: ['user-1', 'user-2'],
      data: expect.objectContaining({
        id: 'msg-1',
        conversationId: 'conv-1',
        content: 'Hello World',
      }),
    });
  });

  it('emitConversationCreated emits CONVERSATION_CREATED payload', async () => {
    const conv = { id: 'conv-10', title: 'Task Force' };
    await events.emitConversationCreated(conv, ['u1', 'u2']);

    expect(publish).toHaveBeenCalledWith({
      type: 'CONVERSATION_CREATED',
      conversationId: 'conv-10',
      participantUserIds: ['u1', 'u2'],
      data: conv,
    });
  });

  it('emitMessageUpdated emits MESSAGE_UPDATED payload', async () => {
    const updated = {
      id: 'msg-1',
      conversationId: 'conv-1',
      content: 'Edited content',
      editedAt: new Date(),
    };
    await events.emitMessageUpdated(updated);

    expect(publish).toHaveBeenCalledWith({
      type: 'MESSAGE_UPDATED',
      conversationId: 'conv-1',
      data: expect.objectContaining({
        id: 'msg-1',
        content: 'Edited content',
      }),
    });
  });

  it('emitMessageDeleted emits MESSAGE_DELETED payload', async () => {
    await events.emitMessageDeleted({
      messageId: 'msg-1',
      conversationId: 'conv-1',
      deletedBy: 'user-1',
    });

    expect(publish).toHaveBeenCalledWith({
      type: 'MESSAGE_DELETED',
      conversationId: 'conv-1',
      data: { messageId: 'msg-1', conversationId: 'conv-1', deletedBy: 'user-1' },
    });
  });

  it('emitReactionAdded and emitReactionRemoved emit proper payloads', async () => {
    await events.emitReactionAdded({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      userId: 'user-1',
      emoji: '👍',
    });

    expect(publish).toHaveBeenCalledWith({
      type: 'REACTION_ADDED',
      conversationId: 'conv-1',
      data: { messageId: 'msg-1', userId: 'user-1', emoji: '👍' },
    });

    await events.emitReactionRemoved({
      conversationId: 'conv-1',
      messageId: 'msg-1',
      userId: 'user-1',
      emoji: '👍',
    });

    expect(publish).toHaveBeenCalledWith({
      type: 'REACTION_REMOVED',
      conversationId: 'conv-1',
      data: { messageId: 'msg-1', userId: 'user-1', emoji: '👍' },
    });
  });

  it('emitReadReceipt emits READ_RECEIPT payload', async () => {
    await events.emitReadReceipt({
      conversationId: 'conv-1',
      userId: 'user-1',
      messageId: 'msg-100',
    });

    expect(publish).toHaveBeenCalledWith({
      type: 'READ_RECEIPT',
      conversationId: 'conv-1',
      data: { conversationId: 'conv-1', userId: 'user-1', lastReadMessageId: 'msg-100' },
    });
  });

  it('emitParticipantAdded and emitParticipantRemoved emit proper payloads', async () => {
    await events.emitParticipantAdded({
      conversationId: 'conv-1',
      participant: { userId: 'user-new', role: 'MEMBER' },
    });

    expect(publish).toHaveBeenCalledWith({
      type: 'PARTICIPANT_ADDED',
      conversationId: 'conv-1',
      data: { conversationId: 'conv-1', participant: { userId: 'user-new', role: 'MEMBER' } },
    });

    await events.emitParticipantRemoved({
      conversationId: 'conv-1',
      userId: 'user-removed',
    });

    expect(publish).toHaveBeenCalledWith({
      type: 'PARTICIPANT_REMOVED',
      conversationId: 'conv-1',
      data: { conversationId: 'conv-1', userId: 'user-removed' },
    });
  });

  it('emitMessagePinned and emitMessageUnpinned emit proper payloads', async () => {
    await events.emitMessagePinned({
      conversationId: 'conv-1',
      messageId: 'msg-pinned',
      pinnedBy: 'user-1',
      message: { id: 'msg-pinned', content: 'Urgent notice' },
    });

    expect(publish).toHaveBeenCalledWith({
      type: 'MESSAGE_PINNED',
      conversationId: 'conv-1',
      data: {
        conversationId: 'conv-1',
        messageId: 'msg-pinned',
        pinnedBy: 'user-1',
        message: { id: 'msg-pinned', content: 'Urgent notice' },
      },
    });

    await events.emitMessageUnpinned({
      conversationId: 'conv-1',
      unpinnedBy: 'user-1',
    });

    expect(publish).toHaveBeenCalledWith({
      type: 'MESSAGE_UNPINNED',
      conversationId: 'conv-1',
      data: { conversationId: 'conv-1', unpinnedBy: 'user-1' },
    });
  });
});
