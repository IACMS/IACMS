import prisma from '../config/database.js';
import EventBus, { TOPICS } from '../../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'case-service');

export async function getAssignments(req, res, next) {
  try {
    const { caseId, assignedTo } = req.query;
    const assignments = await prisma.assignment.findMany({
      where: {
        ...(caseId && { caseId }),
        ...(assignedTo && { assignedTo }),
        isActive: true,
      },
      include: {
        case: { include: { tenant: true } },
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
    const assignment = await prisma.assignment.create({
      data: req.body,
      include: {
        case: { include: { tenant: true } },
        assignee: true,
      },
    });
    await eventBus.publish(TOPICS.CASE_ASSIGNED, {
      caseId: assignment.caseId,
      assignedTo: assignment.assignedTo,
      assigneeEmail: assignment.assignee?.email ?? null,
      assigneeFirstName: assignment.assignee?.firstName ?? null,
      caseNumber: assignment.case?.caseNumber ?? null,
      caseTitle: assignment.case?.title ?? null,
      tenantCode: assignment.case?.tenant?.code ?? null,
    });
    res.status(201).json({ assignment });
  } catch (error) {
    next(error);
  }
}

export async function unassignCase(req, res, next) {
  try {
    await prisma.assignment.update({
      where: { id: req.params.id },
      data: { isActive: false, unassignedAt: new Date() },
    });
    res.json({ message: 'Case unassigned' });
  } catch (error) {
    next(error);
  }
}
