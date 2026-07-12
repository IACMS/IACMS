import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';
import { assertCaseReadable, assertCaseMutable } from '../security/caseAccessPolicy.js';

export async function getAttachments(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const { caseId } = req.params;

    if (!tenantId) {
      throw new ValidationError('Tenant ID is required in headers');
    }

    await assertCaseReadable(prisma, req, caseId, { select: { id: true } });

    const attachments = await prisma.caseAttachment.findMany({
      where: {
        caseId,
        deletedAt: null,
      },
      include: {
        uploader: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json({ attachments });
  } catch (error) {
    next(error);
  }
}

export async function uploadAttachment(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const uploadedBy = req.headers['x-user-id'];

    if (!tenantId || !uploadedBy) {
      throw new ValidationError('Tenant ID and User ID are required in headers');
    }

    const {
      caseId,
      filename,
      originalFilename,
      mimeType,
      fileSize,
      filePath,
      description,
      workflowStepId: workflowStepIdBody,
    } = req.body || {};

    if (!caseId || !filename || !originalFilename || !mimeType || fileSize == null || !filePath) {
      throw new ValidationError(
        'caseId, filename, originalFilename, mimeType, fileSize, and filePath are required'
      );
    }

    const caseRow = await assertCaseMutable(prisma, req, caseId, {
      select: { id: true, workflowId: true, currentStepId: true },
    });

    let workflowStepId = workflowStepIdBody ?? caseRow.currentStepId ?? null;
    if (workflowStepId) {
      const step = await prisma.workflowStep.findFirst({
        where: { id: workflowStepId, workflowId: caseRow.workflowId },
      });
      if (!step) {
        throw new ValidationError('workflowStepId is not part of this case workflow');
      }
      if (caseRow.currentStepId && workflowStepId !== caseRow.currentStepId) {
        throw new ValidationError('Attachments can only be linked to the case current workflow step');
      }
    }

    const uploader = await prisma.user.findFirst({
      where: { id: uploadedBy, tenantId, isActive: true },
    });
    if (!uploader) {
      throw new ValidationError('Uploader not found in this tenant');
    }

    const attachment = await prisma.caseAttachment.create({
      data: {
        caseId,
        tenantId,
        filename,
        originalFilename,
        mimeType,
        fileSize: Number(fileSize),
        filePath,
        description: description ?? undefined,
        uploadedBy,
        workflowStepId: workflowStepId ?? undefined,
      },
      include: {
        uploader: true,
      },
    });
    res.status(201).json({ attachment });
  } catch (error) {
    next(error);
  }
}

export async function deleteAttachment(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];

    if (!tenantId) {
      throw new ValidationError('Tenant ID is required in headers');
    }

    const attachment = await prisma.caseAttachment.findFirst({
      where: {
        id: req.params.id,
        deletedAt: null,
      },
      select: { id: true, caseId: true },
    });

    if (!attachment) {
      throw new NotFoundError('Attachment');
    }

    await assertCaseMutable(prisma, req, attachment.caseId, { select: { id: true } });

    await prisma.caseAttachment.update({
      where: { id: attachment.id },
      data: { deletedAt: new Date() },
    });
    res.json({ message: 'Attachment deleted' });
  } catch (error) {
    next(error);
  }
}
