import prisma from '../config/database.js';
import EventBus from '../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.REDIS_URL || 'redis://localhost:6379');

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
    const assignment = await prisma.assignment.create({
      data: req.body,
      include: {
        case: true,
        assignee: true,
      },
    });
    await eventBus.publish('case.assigned', {
      caseId: assignment.caseId,
      assignedTo: assignment.assignedTo,
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

