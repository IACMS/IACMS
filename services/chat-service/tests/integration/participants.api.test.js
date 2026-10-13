import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock database
vi.mock('../../src/config/database.js', () => {
  const tx = {
    chatParticipant: {
      create: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
  };

  return {
    default: {
      chatParticipant: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      chatMessage: {
        create: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => cb(tx)),
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
    mget: vi.fn().mockResolvedValue(['online', null]),
    pipeline: vi.fn(() => ({
      exists: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1], [null, 0]]),
    })),
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

describe('Participants & Presence API Integration (REST)', () => {
  const INTERNAL_TOKEN = 'test-internal-token-for-unit-tests';
  const TENANT_ID = '00000000-0000-0000-0000-000000000001';
  const USER_ID = '00000000-0000-0000-0000-000000000002';
  const TARGET_USER_ID = '00000000-0000-0000-0000-000000000003';
  const CONV_ID = 'conv-part-test-300';

  const authHeaders = {
    'x-internal-service-token': INTERNAL_TOKEN,
    'x-tenant-id': TENANT_ID,
    'x-user-id': USER_ID,
  };

  const ownerParticipantMock = {
    id: 'part-owner-1',
    conversationId: CONV_ID,
    userId: USER_ID,
    role: 'OWNER',
    conversation: {
      id: CONV_ID,
      tenantId: TENANT_ID,
      type: 'GROUP',
    },
  };

  const memberParticipantMock = {
    ...ownerParticipantMock,
    id: 'part-member-1',
    role: 'MEMBER',
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('GET /conversations/:id/participants', () => {
    it('returns active participants with user details', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(ownerParticipantMock);

      const mockParticipants = [
        {
          id: 'part-1',
          userId: USER_ID,
          role: 'OWNER',
          user: { id: USER_ID, firstName: 'Lead', lastName: 'Agent' },
        },
        {
          id: 'part-2',
          userId: TARGET_USER_ID,
          role: 'MEMBER',
          user: { id: TARGET_USER_ID, firstName: 'Junior', lastName: 'Analyst' },
        },
      ];

      prisma.chatParticipant.findMany.mockResolvedValueOnce(mockParticipants);

      const res = await request(app)
        .get(`/conversations/${CONV_ID}/participants`)
        .set(authHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('participants');
      expect(res.body.participants.length).toBe(2);
      expect(res.body.participants[0].userId).toBe(USER_ID);
    });
  });

  describe('POST /conversations/:id/participants (Add Participant)', () => {
    it('adds a new member when caller is OWNER/ADMIN with 201 Created', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(ownerParticipantMock);

      // No existing participant
      prisma.chatParticipant.findUnique.mockResolvedValueOnce(null);

      // User exists in tenant
      prisma.user.findFirst.mockResolvedValueOnce({
        id: TARGET_USER_ID,
        tenantId: TENANT_ID,
        firstName: 'Junior',
        lastName: 'Analyst',
        isActive: true,
      });

      const newParticipant = {
        id: 'part-new-3',
        conversationId: CONV_ID,
        userId: TARGET_USER_ID,
        role: 'MEMBER',
        user: { id: TARGET_USER_ID, firstName: 'Junior', lastName: 'Analyst' },
      };

      prisma.__tx.chatParticipant.create.mockResolvedValueOnce(newParticipant);
      prisma.__tx.chatMessage.create.mockResolvedValueOnce({});

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/participants`)
        .set(authHeaders)
        .send({ userId: TARGET_USER_ID });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(TARGET_USER_ID);
      expect(res.body.role).toBe('MEMBER');
    });

    it('returns 403 Forbidden when caller is only a MEMBER', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(memberParticipantMock);

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/participants`)
        .set(authHeaders)
        .send({ userId: TARGET_USER_ID });

      expect(res.status).toBe(403);
    });

    it('returns 400 Bad Request when userId is missing', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(ownerParticipantMock);

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/participants`)
        .set(authHeaders)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /conversations/:id/participants/:userId (Remove / Leave)', () => {
    it('allows OWNER to remove a member and returns 204 No Content', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(ownerParticipantMock);

      prisma.chatParticipant.findUnique.mockResolvedValueOnce({
        id: 'part-target-to-remove',
        conversationId: CONV_ID,
        userId: TARGET_USER_ID,
        role: 'MEMBER',
        leftAt: null,
        user: { firstName: 'Junior', lastName: 'Analyst' },
      });

      prisma.__tx.chatParticipant.update.mockResolvedValueOnce({});
      prisma.__tx.chatMessage.create.mockResolvedValueOnce({});

      const res = await request(app)
        .delete(`/conversations/${CONV_ID}/participants/${TARGET_USER_ID}`)
        .set(authHeaders);

      expect(res.status).toBe(204);
    });

    it('returns 403 when a regular MEMBER tries to kick another member', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(memberParticipantMock);

      const res = await request(app)
        .delete(`/conversations/${CONV_ID}/participants/${TARGET_USER_ID}`)
        .set(authHeaders);

      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /conversations/:id/participants/:userId/role (Update Role)', () => {
    it('allows OWNER to promote a member to ADMIN with 200 OK', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(ownerParticipantMock);

      prisma.chatParticipant.findUnique.mockResolvedValueOnce({
        id: 'part-target-role',
        conversationId: CONV_ID,
        userId: TARGET_USER_ID,
        role: 'MEMBER',
        leftAt: null,
      });

      prisma.chatParticipant.update.mockResolvedValueOnce({
        id: 'part-target-role',
        role: 'ADMIN',
      });

      const res = await request(app)
        .patch(`/conversations/${CONV_ID}/participants/${TARGET_USER_ID}/role`)
        .set(authHeaders)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('ADMIN');
    });

    it('returns 403 Forbidden when a non-owner tries to update role', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(memberParticipantMock);

      const res = await request(app)
        .patch(`/conversations/${CONV_ID}/participants/${TARGET_USER_ID}/role`)
        .set(authHeaders)
        .send({ role: 'ADMIN' });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /conversations/:id/participants/mute (Toggle Mute)', () => {
    it('mutes conversation for calling user with 200 OK', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(memberParticipantMock);

      prisma.chatParticipant.findUnique.mockResolvedValueOnce({
        id: 'part-member-1',
        conversationId: CONV_ID,
        userId: USER_ID,
        leftAt: null,
      });

      prisma.chatParticipant.update.mockResolvedValueOnce({
        id: 'part-member-1',
        isMuted: true,
      });

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/participants/mute`)
        .set(authHeaders)
        .send({ muted: true });

      expect(res.status).toBe(200);
      expect(res.body.isMuted).toBe(true);
    });

    it('returns 400 Bad Request when muted parameter is not a boolean', async () => {
      prisma.chatParticipant.findFirst.mockResolvedValueOnce(memberParticipantMock);

      const res = await request(app)
        .post(`/conversations/${CONV_ID}/participants/mute`)
        .set(authHeaders)
        .send({ muted: 'yes' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /presence (Bulk Presence Lookup)', () => {
    it('returns presence status map for provided userIds', async () => {
      const res = await request(app)
        .post('/presence')
        .set(authHeaders)
        .send({ userIds: [USER_ID, TARGET_USER_ID] });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('presence');
      expect(res.body.presence).toBeTypeOf('object');
    });

    it('returns 400 Bad Request if userIds is not an array', async () => {
      const res = await request(app)
        .post('/presence')
        .set(authHeaders)
        .send({ userIds: 'invalid-not-array' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('userIds array required');
    });
  });
});
