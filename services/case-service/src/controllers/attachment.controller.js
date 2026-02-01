import prisma from '../config/database.js';
import { NotFoundError } from '../../../shared/common/errors.js';

export async function getAttachments(req, res, next) {
  try {
    const attachments = await prisma.caseAttachment.findMany({
      where: {
        caseId: req.params.caseId,
        deletedAt: null,
      },
      include: {
        uploader: true,
      },
    });
    res.json({ attachments });
  } catch (error) {
    next(error);
  }
}

export async function uploadAttachment(req, res, next) {
  try {
    // File upload logic would go here
    // For now, just create the record
    const attachment = await prisma.caseAttachment.create({
      data: req.body,
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
    await prisma.caseAttachment.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });
    res.json({ message: 'Attachment deleted' });
  } catch (error) {
    next(error);
  }
}

