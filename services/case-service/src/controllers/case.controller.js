import prisma from '../config/database.js';
import { NotFoundError, ValidationError } from '../../../shared/common/errors.js';
import EventBus from '../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');

export async function getCases(req, res, next) {
  try {
    const { tenantId, status, type, assignedTo } = req.query;
    const cases = await prisma.case.findMany({
      where: {
        ...(tenantId && { tenantId }),
        ...(status && { status }),
        ...(type && { type }),
        ...(assignedTo && { assignedTo }),
      },
      include: {
        tenant: true,
        assignee: true,
        creator: true,
      },
    });
    res.json({ cases });
  } catch (error) {
    next(error);
  }
}

export async function getCase(req, res, next) {
  try {
    const case_ = await prisma.case.findUnique({
      where: { id: req.params.id },
      include: {
        tenant: true,
        assignee: true,
        creator: true,
        attachments: true,
      },
    });
    if (!case_) throw new NotFoundError('Case');
    res.json({ case: case_ });
  } catch (error) {
    next(error);
  }
}

export async function createCase(req, res, next) {
  try {
    const case_ = await prisma.case.create({
      data: req.body,
      include: {
        tenant: true,
        creator: true,
      },
    });
    await eventBus.publish('case.created', { caseId: case_.id, tenantId: case_.tenantId });
    res.status(201).json({ case: case_ });
  } catch (error) {
    next(error);
  }
}

export async function updateCase(req, res, next) {
  try {
    const case_ = await prisma.case.update({
      where: { id: req.params.id },
      data: req.body,
    });
    await eventBus.publish('case.updated', { caseId: case_.id });
    res.json({ case: case_ });
  } catch (error) {
    next(error);
  }
}

export async function deleteCase(req, res, next) {
  try {
    await prisma.case.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });
    res.json({ message: 'Case deleted' });
  } catch (error) {
    next(error);
  }
}

