import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/database.js', () => {
  return {
    default: {
      caseAttachment: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      workflowStep: {
        findFirst: vi.fn(),
      },
      user: {
        findFirst: vi.fn(),
      },
    },
  };
});

vi.mock('../../src/security/caseAccessPolicy.js', () => ({
  assertCaseReadable: vi.fn(),
  assertCaseMutable: vi.fn(),
}));

import prisma from '../../src/config/database.js';
import { getAttachments, uploadAttachment, deleteAttachment } from '../../src/controllers/attachment.controller.js';
import { assertCaseReadable, assertCaseMutable } from '../../src/security/caseAccessPolicy.js';
import { ValidationError, NotFoundError } from '../../../../shared/common/errors.js';

describe('Attachment Controller', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      headers: { 'x-tenant-id': 't-1', 'x-user-id': 'u-1' },
      query: {},
      body: {},
      params: { caseId: 'c-1' },
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  describe('getAttachments', () => {
    it('returns attachments', async () => {
      const mockAttachments = [{ id: 'att-1' }];
      prisma.caseAttachment.findMany.mockResolvedValue(mockAttachments);
      assertCaseReadable.mockResolvedValue({});

      await getAttachments(req, res, next);

      expect(assertCaseReadable).toHaveBeenCalledWith(prisma, req, 'c-1', expect.any(Object));
      expect(prisma.caseAttachment.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { caseId: 'c-1', deletedAt: null }
      }));
      expect(res.json).toHaveBeenCalledWith({ attachments: mockAttachments });
    });

    it('throws ValidationError if tenantId is missing', async () => {
      req.headers['x-tenant-id'] = undefined;
      await getAttachments(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe('uploadAttachment', () => {
    it('uploads an attachment', async () => {
      req.body = {
        caseId: 'c-1',
        filename: 'file.txt',
        originalFilename: 'file.txt',
        mimeType: 'text/plain',
        fileSize: 100,
        filePath: '/tmp/file.txt',
      };
      
      assertCaseMutable.mockResolvedValue({ id: 'c-1', workflowId: 'wf-1', currentStepId: null });
      prisma.user.findFirst.mockResolvedValue({ id: 'u-1', tenantId: 't-1', isActive: true });
      prisma.caseAttachment.create.mockResolvedValue({ id: 'att-1', ...req.body });

      await uploadAttachment(req, res, next);

      expect(assertCaseMutable).toHaveBeenCalled();
      expect(prisma.caseAttachment.create).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ attachment: expect.any(Object) });
    });

    it('validates required fields', async () => {
      req.body = {};
      await uploadAttachment(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe('deleteAttachment', () => {
    it('deletes an attachment', async () => {
      req.params.id = 'att-1';
      prisma.caseAttachment.findFirst.mockResolvedValue({ id: 'att-1', caseId: 'c-1' });
      assertCaseMutable.mockResolvedValue({});

      await deleteAttachment(req, res, next);

      expect(assertCaseMutable).toHaveBeenCalledWith(prisma, req, 'c-1', expect.any(Object));
      expect(prisma.caseAttachment.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'att-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) })
      }));
      expect(res.json).toHaveBeenCalledWith({ message: 'Attachment deleted' });
    });

    it('throws NotFoundError if attachment is not found', async () => {
      req.params.id = 'att-1';
      prisma.caseAttachment.findFirst.mockResolvedValue(null);
      await deleteAttachment(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError));
    });
  });
});
