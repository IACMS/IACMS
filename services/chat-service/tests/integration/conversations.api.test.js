import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock database
vi.mock('../../src/config/database.js', () => ({
  default: {
    chatConversation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    chatParticipant: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    chatMessage: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    case: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    department: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock redis
vi.mock('../../src/config/redis.js', () => {
  const store = new Map();
  return {
    redis: {
      get: vi.fn(async (key) => store.get(key) || null),
      set: vi.fn(async (key, val) => { store.set(key, val); return 'OK'; }),
      del: vi.fn(async (key) => { store.delete(key); return 1; }),
      sadd: vi.fn().mockResolvedValue(1),
      srem: vi.fn().mockResolvedValue(1),
      smembers: vi.fn().mockResolvedValue([]),
    },
    redisPub: {
      publish: vi.fn().mockResolvedValue(1),
    },
    redisSub: {
      subscribe: vi.fn().mockResolvedValue('OK'),
      on: vi.fn(),
    },
  };
});

// Mock pubsub to track emitted websocket events
vi.mock('../../src/websocket/pubsub.js', () => ({
  subscribe: vi.fn().mockResolvedValue(true),
  publish: vi.fn().mockResolvedValue(true),
}));

import app from '../../src/server.js';
import prisma from '../../src/config/database.js';
import * as conversationService from '../../src/modules/conversations/conversation.service.js';

describe('Conversations API Integration (REST)', () => {
  const INTERNAL_TOKEN = 'test-internal-token-for-unit-tests';
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';
  const USER_ID = '00000000-0000-0000-0000-000000000002';
  const CONV_ID = 'conv-test-100';

  const authHeaders = {
    'x-internal-service-token': INTERNAL_TOKEN,
    'x-tenant-id': TENANT_ID,
    'x-user-id': USER_ID,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(conversationService, 'ensureDefaultChannels').mockResolvedValue(true);
  });

  describe('Health Endpoints (Public)', () => {
    it('GET /health returns 200 with service info without tokens', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('chat-service');
    });

    it('GET /health/live returns 200', async () => {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
    });

    it('GET /health/ready returns 200', async () => {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
    });
  });

  describe('Security & Gateway Header Gate', () => {
    it('rejects requests without x-internal-service-token with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/conversations')
        .set('x-tenant-id', TENANT_ID)
        .set('x-user-id', USER_ID);

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
    });

    it('rejects requests missing x-tenant-id with 400', async () => {
      const res = await request(app)
        .get('/conversations')
        .set('x-internal-service-token', INTERNAL_TOKEN)
        .set('x-user-id', USER_ID);

      expect(res.status).toBe(400);
    });

    it('rejects requests missing x-user-id with 400', async () => {
      const res = await request(app)
        .get('/conversations')
        .set('x-internal-service-token', INTERNAL_TOKEN)
        .set('x-tenant-id', TENANT_ID);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /conversations', () => {
    it('returns list of user conversations', async () => {
      prisma.chatParticipant.findMany.mockResolvedValueOnce([
        {
          conversation: {
            id: 'c1',
            type: 'GROUP',
            title: 'Audit Squad',
            lastMessageId: 'm1',
            lastMessageAt: new Date(),
            participants: [{ userId: USER_ID, role: 'OWNER' }],
          },
        },
      ]);
      prisma.chatMessage.count.mockResolvedValueOnce(0);

      const res = await request(app)
        .get('/conversations')
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('conversations');
      expect(res.body.conversations.length).toBe(1);
      expect(res.body.conversations[0].id).toBe('c1');
      expect(res.body.conversations[0].title).toBe('Audit Squad');
    });
  });

  describe('POST /conversations', () => {
    it('creates a DIRECT conversation', async () => {
      prisma.chatConversation.findFirst.mockResolvedValueOnce(null);
      prisma.chatConversation.create.mockResolvedValueOnce({
        id: 'conv-direct-new',
        type: 'DIRECT',
        participants: [
          { userId: USER_ID, role: 'MEMBER' },
          { userId: 'user-other', role: 'MEMBER' },
        ],
      });

      const res = await request(app)
        .post('/conversations')
        .set(authHeaders)
        .send({
          type: 'DIRECT',
          participantId: 'user-other',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('conv-direct-new');
      expect(res.body.type).toBe('DIRECT');
    });

    it('creates a GROUP conversation', async () => {
      prisma.chatConversation.create.mockResolvedValueOnce({
        id: 'conv-group-new',
        type: 'GROUP',
        title: 'Task Force Delta',
        description: 'High priority',
        participants: [
          { userId: USER_ID, role: 'OWNER' },
          { userId: 'user-other', role: 'MEMBER' },
        ],
      });

      const res = await request(app)
        .post('/conversations')
        .set(authHeaders)
        .send({
          type: 'GROUP',
          title: 'Task Force Delta',
          description: 'High priority',
          participantIds: ['user-other'],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('conv-group-new');
      expect(res.body.title).toBe('Task Force Delta');
    });

    it('validates required fields for GROUP conversation (title missing)', async () => {
      const res = await request(app)
        .post('/conversations')
        .set(authHeaders)
        .send({
          type: 'GROUP',
          participantIds: ['user-other'],
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /conversations/:id', () => {
    it('returns conversation details if user is an active participant', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce({
        id: 'part-1',
        conversationId: CONV_ID,
        userId: USER_ID,
        conversation: { id: CONV_ID, tenantId: TENANT_ID, type: 'GROUP' },
      });

      prisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: CONV_ID,
        type: 'GROUP',
        title: 'Room 100',
        participants: [{ userId: USER_ID, role: 'OWNER' }],
      });

      const res = await request(app)
        .get(`/conversations/${CONV_ID}`)
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(CONV_ID);
      expect(res.body.title).toBe('Room 100');
    });

    it('returns 403 Forbidden if user is NOT a participant', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/conversations/${CONV_ID}`)
        .set(authHeaders);

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /conversations/:id', () => {
    it('updates group metadata when user is OWNER/ADMIN', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce({
        id: 'part-1',
        conversationId: CONV_ID,
        userId: USER_ID,
        role: 'OWNER',
        conversation: { id: CONV_ID, tenantId: TENANT_ID, type: 'GROUP' },
      });

      prisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: CONV_ID,
        type: 'GROUP',
        title: 'Original Title',
        participants: [{ userId: USER_ID, role: 'OWNER' }],
      });

      prisma.chatConversation.update.mockResolvedValueOnce({
        id: CONV_ID,
        type: 'GROUP',
        title: 'Updated Group Title',
        description: 'New Description',
      });

      const res = await request(app)
        .patch(`/conversations/${CONV_ID}`)
        .set(authHeaders)
        .send({
          title: 'Updated Group Title',
          description: 'New Description',
        });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Updated Group Title');
    });

    it('returns 403 Forbidden if participant is only a MEMBER', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce({
        id: 'part-1',
        conversationId: CONV_ID,
        userId: USER_ID,
        role: 'MEMBER',
        conversation: { id: CONV_ID, tenantId: TENANT_ID, type: 'GROUP' },
      });

      prisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: CONV_ID,
        type: 'GROUP',
        participants: [{ userId: USER_ID, role: 'MEMBER' }],
      });

      const res = await request(app)
        .patch(`/conversations/${CONV_ID}`)
        .set(authHeaders)
        .send({ title: 'Unauthorized Rename' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /conversations/:id (Archive/Leave)', () => {
    it('archives participant membership with 204 No Content', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce({
        id: 'part-1',
        conversationId: CONV_ID,
        userId: USER_ID,
        conversation: { id: CONV_ID, tenantId: TENANT_ID, type: 'GROUP' },
      });

      prisma.chatParticipant.update.mockResolvedValueOnce({
        id: 'part-1',
        leftAt: new Date(),
      });

      const res = await request(app)
        .delete(`/conversations/${CONV_ID}`)
        .set(authHeaders);

      expect(res.status).toBe(204);
    });
  });

  describe('Pinned Messages API', () => {
    it('POST /conversations/:id/pin/:messageId pins message', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce({
        id: 'part-1',
        conversationId: CONV_ID,
        userId: USER_ID,
        conversation: { id: CONV_ID, tenantId: TENANT_ID, type: 'GROUP' },
      });

      prisma.chatMessage.findUnique.mockResolvedValueOnce({
        id: 'msg-target',
        conversationId: CONV_ID,
        content: 'Crucial briefing',
      });

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/pin/msg-target`)
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /conversations/:id/pinned retrieves pinned message', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce({
        id: 'part-1',
        conversationId: CONV_ID,
        userId: USER_ID,
        conversation: { id: CONV_ID, tenantId: TENANT_ID, type: 'GROUP' },
      });

      // No pin in redis or db
      prisma.chatMessage.findUnique.mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/conversations/${CONV_ID}/pinned`)
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('pinnedMessage');
    });

    it('DELETE /conversations/:id/pin unpins message', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce({
        id: 'part-1',
        conversationId: CONV_ID,
        userId: USER_ID,
        conversation: { id: CONV_ID, tenantId: TENANT_ID, type: 'GROUP' },
      });

      const res = await request(app)
        .delete(`/conversations/${CONV_ID}/pin`)
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Case-Linked Collaboration Endpoints', () => {
    const CASE_ID = 'case-fraud-999';

    it('GET /conversations/case/:caseId returns exists: false when room not initiated', async () => {
      prisma.case.findFirst.mockResolvedValueOnce({
        id: CASE_ID,
        caseNumber: 'CAS-2026-0999',
        title: 'Embezzlement Inquiry',
        status: 'open',
        priority: 'high',
      });
      prisma.chatConversation.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .get(`/conversations/case/${CASE_ID}`)
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(false);
      expect(res.body.caseInfo.caseNumber).toBe('CAS-2026-0999');
      expect(res.body.conversation).toBeNull();
    });

    it('GET /conversations/case/:caseId returns exists: true and conversation when room exists', async () => {
      prisma.case.findFirst.mockResolvedValueOnce({
        id: CASE_ID,
        caseNumber: 'CAS-2026-0999',
        title: 'Embezzlement Inquiry',
        status: 'open',
        priority: 'high',
      });
      prisma.chatConversation.findFirst.mockResolvedValueOnce({
        id: 'conv-case-999',
        title: 'Case #CAS-2026-0999: Embezzlement Inquiry',
        participants: [{ userId: USER_ID }],
      });

      const res = await request(app)
        .get(`/conversations/case/${CASE_ID}`)
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body.exists).toBe(true);
      expect(res.body.conversation.id).toBe('conv-case-999');
    });

    it('POST /conversations/case/:caseId creates discussion room on demand with 201', async () => {
      prisma.case.findFirst.mockResolvedValueOnce({
        id: CASE_ID,
        caseNumber: 'CAS-2026-0999',
        title: 'Embezzlement Inquiry',
        status: 'open',
        priority: 'high',
        assignedTo: USER_ID,
        createdBy: 'user-author',
      });

      // No existing conversation
      prisma.chatConversation.findFirst.mockResolvedValueOnce(null);

      prisma.user.findUnique.mockResolvedValueOnce({
        id: USER_ID,
        firstName: 'Sherlock',
        lastName: 'Holmes',
        username: 'sherlock',
      });

      prisma.chatConversation.create.mockResolvedValueOnce({
        id: 'conv-case-new-created',
        title: 'Case #CAS-2026-0999: Embezzlement Inquiry',
      });

      prisma.chatMessage.create.mockResolvedValueOnce({
        id: 'msg-welcome-sys',
        createdAt: new Date(),
      });

      prisma.chatConversation.update.mockResolvedValueOnce({});

      // Mock getConversationDetails
      prisma.chatConversation.findUnique.mockResolvedValueOnce({
        id: 'conv-case-new-created',
        title: 'Case #CAS-2026-0999: Embezzlement Inquiry',
        participants: [{ userId: USER_ID, role: 'OWNER' }],
      });

      const res = await request(app)
        .post(`/conversations/case/${CASE_ID}`)
        .set(authHeaders);

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(true);
      expect(res.body.conversation.id).toBe('conv-case-new-created');
      expect(res.body.caseInfo.caseNumber).toBe('CAS-2026-0999');
    });
  });
});
