import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock database
vi.mock('../../src/config/database.js', () => {
  const tx = {
    chatMessage: {
      create: vi.fn(),
      update: vi.fn(),
    },
    chatConversation: { update: vi.fn() },
    chatOutboxEvent: { create: vi.fn() },
    chatParticipant: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    chatReaction: { create: vi.fn(), delete: vi.fn(), upsert: vi.fn() },
  };

  return {
    default: {
      chatConversation: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      chatParticipant: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      chatMessage: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      chatReaction: {
        create: vi.fn(),
        deleteMany: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
      },
      chatOutboxEvent: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
      __tx: tx,
    },
  };
});

// Mock redis
vi.mock('../../src/config/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  },
  redisPub: {
    publish: vi.fn().mockResolvedValue(1),
  },
  redisSub: {
    subscribe: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
  },
}));

// Mock pubsub to track emitted websocket events
vi.mock('../../src/websocket/pubsub.js', () => ({
  subscribe: vi.fn().mockResolvedValue(true),
  publish: vi.fn().mockResolvedValue(true),
}));

import app from '../../src/server.js';
import prisma from '../../src/config/database.js';

describe('Messages API Integration (REST)', () => {
  const INTERNAL_TOKEN = 'test-internal-token-for-unit-tests';
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';
  const USER_ID = '00000000-0000-0000-0000-000000000002';
  const CONV_ID = 'conv-msg-test-200';

  const authHeaders = {
    'x-internal-service-token': INTERNAL_TOKEN,
    'x-tenant-id': TENANT_ID,
    'x-user-id': USER_ID,
  };

  const participantMock = {
    id: 'part-msg-1',
    conversationId: CONV_ID,
    userId: USER_ID,
    role: 'MEMBER',
    conversation: {
      id: CONV_ID,
      tenantId: TENANT_ID,
      type: 'GROUP',
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Authorization Gate on Messages', () => {
    it('returns 403 Forbidden when caller is not an active participant of the conversation', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/conversations/${CONV_ID}/messages`)
        .set(authHeaders);

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('GET /conversations/:id/messages (List Messages)', () => {
    it('returns paginated list of messages for participant', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(participantMock);

      const mockMessages = [
        {
          id: 'msg-1',
          conversationId: CONV_ID,
          senderId: USER_ID,
          content: 'First statement',
          createdAt: new Date(),
          reactions: [],
        },
        {
          id: 'msg-2',
          conversationId: CONV_ID,
          senderId: 'user-other',
          content: 'Second statement',
          createdAt: new Date(),
          reactions: [],
        },
      ];

      prisma.chatMessage.findMany.mockResolvedValueOnce(mockMessages);

      const res = await request(app)
        .get(`/conversations/${CONV_ID}/messages?limit=20`)
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('messages');
      expect(res.body.messages.length).toBe(2);
      expect(res.body.messages[0].id).toBe('msg-1');
    });
  });

  describe('POST /conversations/:id/messages (Send Message)', () => {
    it('sends text message successfully with 201 Created', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(participantMock);

      const createdMsg = {
        id: 'msg-created-1',
        conversationId: CONV_ID,
        senderId: USER_ID,
        clientMessageId: 'client-uuid-99',
        content: 'Evidence uploaded successfully.',
        messageType: 'TEXT',
        createdAt: new Date(),
        sender: { id: USER_ID, firstName: 'John', lastName: 'Watson' },
        attachments: [],
      };

      prisma.__tx.chatParticipant.findMany.mockResolvedValueOnce([
        { userId: USER_ID },
        { userId: 'user-partner' },
      ]);
      prisma.__tx.chatMessage.create.mockResolvedValueOnce(createdMsg);
      prisma.__tx.chatConversation.update.mockResolvedValueOnce({});
      prisma.__tx.chatParticipant.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.__tx.chatOutboxEvent.create.mockResolvedValueOnce({});

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/messages`)
        .set(authHeaders)
        .send({
          clientMessageId: 'client-uuid-99',
          messageType: 'TEXT',
          content: 'Evidence uploaded successfully.',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('msg-created-1');
      expect(res.body.content).toBe('Evidence uploaded successfully.');
    });

    it('rejects sending text message with empty content with 400 Bad Request', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(participantMock);

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/messages`)
        .set(authHeaders)
        .send({
          clientMessageId: 'client-uuid-99',
          messageType: 'TEXT',
          content: '   ',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('rejects sending message without clientMessageId with 400', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(participantMock);

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/messages`)
        .set(authHeaders)
        .send({
          messageType: 'TEXT',
          content: 'Hello without client id',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /conversations/:id/messages/:messageId (Edit Message)', () => {
    it('allows author to edit their own message with 200', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(participantMock);

      prisma.chatMessage.findFirst.mockResolvedValueOnce({
        id: 'msg-to-edit',
        conversationId: CONV_ID,
        senderId: USER_ID,
        messageType: 'TEXT',
        content: 'Original typo content',
        deletedAt: null,
      });

      prisma.__tx.chatMessage.update.mockResolvedValueOnce({
        id: 'msg-to-edit',
        conversationId: CONV_ID,
        senderId: USER_ID,
        content: 'Corrected content without typos',
        editedAt: new Date(),
      });
      prisma.__tx.chatOutboxEvent.create.mockResolvedValueOnce({});

      const res = await request(app)
        .patch(`/conversations/${CONV_ID}/messages/msg-to-edit`)
        .set(authHeaders)
        .send({ content: 'Corrected content without typos' });

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('Corrected content without typos');
    });

    it('returns 403 Forbidden when a user attempts to edit another user message', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(participantMock);

      prisma.chatMessage.findFirst.mockResolvedValueOnce({
        id: 'msg-other-user',
        conversationId: CONV_ID,
        senderId: 'different-user-id',
        messageType: 'TEXT',
        content: 'Original content',
        deletedAt: null,
      });

      const res = await request(app)
        .patch(`/conversations/${CONV_ID}/messages/msg-other-user`)
        .set(authHeaders)
        .send({ content: 'Malicious modification' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /conversations/:id/messages/:messageId (Delete Message)', () => {
    it('soft deletes message and returns 204 No Content', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(participantMock);

      prisma.chatMessage.findFirst.mockResolvedValueOnce({
        id: 'msg-to-delete',
        conversationId: CONV_ID,
        senderId: USER_ID,
        deletedAt: null,
      });

      prisma.__tx.chatMessage.update.mockResolvedValueOnce({
        id: 'msg-to-delete',
        deletedAt: new Date(),
      });
      prisma.__tx.chatOutboxEvent.create.mockResolvedValueOnce({});

      const res = await request(app)
        .delete(`/conversations/${CONV_ID}/messages/msg-to-delete`)
        .set(authHeaders);

      expect(res.status).toBe(204);
    });
  });

  describe('Reactions API', () => {
    it('POST /conversations/:id/messages/:messageId/reactions adds reaction with 201', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(participantMock);

      prisma.chatMessage.findFirst.mockResolvedValueOnce({
        id: 'msg-target',
        conversationId: CONV_ID,
        deletedAt: null,
      });

      prisma.chatReaction.upsert.mockResolvedValueOnce({
        id: 'react-1',
        messageId: 'msg-target',
        userId: USER_ID,
        emoji: '🔥',
      });

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/messages/msg-target/reactions`)
        .set(authHeaders)
        .send({ emoji: '🔥' });

      expect(res.status).toBe(201);
      expect(res.body.emoji).toBe('🔥');
    });

    it('DELETE /conversations/:id/messages/:messageId/reactions/:emoji removes reaction with 204', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(participantMock);

      prisma.chatReaction.deleteMany.mockResolvedValueOnce({ count: 1 });

      const res = await request(app)
        .delete(`/conversations/${CONV_ID}/messages/msg-target/reactions/%F0%9F%94%A5`)
        .set(authHeaders);

      expect(res.status).toBe(204);
    });
  });

  describe('POST /conversations/:id/messages/read (Read Receipts)', () => {
    it('marks conversation as read and returns 200', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(participantMock);

      prisma.chatParticipant.findUnique.mockResolvedValueOnce({
        id: 'part-msg-1',
        conversationId: CONV_ID,
        userId: USER_ID,
      });

      prisma.chatParticipant.update.mockResolvedValueOnce({
        id: 'part-msg-1',
        lastReadMessageId: 'msg-last-read',
        lastReadAt: new Date(),
      });

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/messages/read`)
        .set(authHeaders)
        .send({ messageId: 'msg-last-read' });

      expect(res.status).toBe(200);
      expect(res.body.conversationId).toBe(CONV_ID);
      expect(res.body.lastReadMessageId).toBe('msg-last-read');
    });
  });
});
