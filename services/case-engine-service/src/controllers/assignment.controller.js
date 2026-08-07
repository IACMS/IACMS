import prisma from '../config/database.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';
import { NotFoundError, ValidationError } from '../../../../shared/common/errors.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'case-service');

function emitAudit(payload) {
  eventBus.publish(TOPICS.AUDIT_LOG, payload).catch(() => {});
}

export async function getAssignments(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const { caseId, assignedTo } = req.query;

    if (!tenantId) {
      throw new ValidationError('Tenant ID is required in headers');
    }

    const assignments = await prisma.assignment.findMany({
      where: {
        isActive: true,
        case: { tenantId },
        ...(caseId && { caseId }),
        ...(assignedTo && { assignedTo }),
      },
      include: {
        case: true,
        assignee: true,
        assigner: true,
      },
    });
    res.json({ assignments });
  } catch (error) {
    next(error);
  }
}

export async function assignCase(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const actorId = req.headers['x-user-id'];
    const { caseId, assignedTo, assignmentType, notes } = req.body || {};

    if (!tenantId || !actorId) {
      throw new ValidationError('Tenant ID and User ID are required in headers');
    }
    if (!caseId || !assignedTo) {
      throw new ValidationError('caseId and assignedTo are required');
    }

    const caseRecord = await prisma.case.findFirst({
      where: { id: caseId, tenantId, deletedAt: null },
    });
    if (!caseRecord) throw new NotFoundError('Case');

    const assignee = await prisma.user.findFirst({
      where: { id: assignedTo, tenantId, isActive: true },
    });
    if (!assignee) {
      throw new ValidationError('Assignee not found or not in this tenant');
    }

    const assignment = await prisma.assignment.create({
      data: {
        caseId,
        assignedTo,
        assignedBy: actorId,
        assignmentType: assignmentType || 'manual',
        notes: notes ?? undefined,
      },
      include: {
        case: true,
        assignee: true,
      },
    });

    await prisma.case.update({
      where: { id: caseId },
      data: { assignedTo },
    });

    await eventBus.publish(TOPICS.CASE_ASSIGNED, {
      caseId: assignment.caseId,
      assignedTo: assignment.assignedTo,
      tenantId,
    });

    emitAudit({
      tenantId,
      entityType: 'assignment',
      entityId: assignment.id,
      action: 'case_assigned',
      userId: actorId,
      metadata: {
        caseId,
        assignedTo,
        assignmentType: assignment.assignmentType,
      },
    });

    res.status(201).json({ assignment });
  } catch (error) {
    next(error);
  }
}

export async function unassignCase(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const actorId = req.headers['x-user-id'];

    if (!tenantId) {
      throw new ValidationError('Tenant ID is required in headers');
    }

    const assignment = await prisma.assignment.findFirst({
      where: { id: req.params.id, isActive: true },
      include: { case: true },
    });

    if (!assignment || assignment.case.tenantId !== tenantId) {
      throw new NotFoundError('Assignment');
    }

    await prisma.assignment.update({
      where: { id: assignment.id },
      data: { isActive: false, unassignedAt: new Date() },
    });

    await prisma.case.updateMany({
      where: { id: assignment.caseId, assignedTo: assignment.assignedTo },
      data: { assignedTo: null },
    });

    emitAudit({
      tenantId,
      entityType: 'assignment',
      entityId: assignment.id,
      action: 'case_unassigned',
      userId: actorId || null,
      metadata: {
        caseId: assignment.caseId,
        previouslyAssignedTo: assignment.assignedTo,
      },
    });

    res.json({ message: 'Case unassigned' });
  } catch (error) {
    next(error);
  }
}
