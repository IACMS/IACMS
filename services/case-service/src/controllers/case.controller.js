import prisma from '../config/database.js';
import { NotFoundError, ValidationError, InvalidTransitionError, WorkflowNotPublishedError } from '../../../shared/common/errors.js';
import EventBus, { TOPICS } from '../../../shared/utils/eventBus.js';

const eventBus = new EventBus(process.env.KAFKA_BROKERS || 'localhost:9092', 'case-service');

function emitAudit(payload) {
  eventBus.publish(TOPICS.AUDIT_LOG, payload).catch(() => {});
}

/** Tenant-wide case visibility: tenant administrators or platform system administrators. */
async function userHasTenantWideCaseAccess(userId) {
  const rows = await prisma.userRole.findMany({
    where: {
      userId,
      role: { name: { in: ['tenant_admin', 'system_admin'] }, isActive: true },
    },
    select: { roleId: true },
    take: 1,
  });
  return rows.length > 0;
}

async function generateCaseNumber(tenantId) {
  const year = new Date().getFullYear();
  // We need to use Prisma to atomicly increment the sequence
  const sequence = await prisma.caseSequence.upsert({
    where: {
      tenantId_year: { tenantId, year }
    },
    update: {
      lastSeq: { increment: 1 }
    },
    create: {
      tenantId,
      year,
      lastSeq: 1
    }
  });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const prefix = tenant ? tenant.code : 'UNKNOWN';
  const paddedSeq = sequence.lastSeq.toString().padStart(4, '0');
  
  return `${prefix}-${year}-${paddedSeq}`;
}

export async function getCases(req, res, next) {
  try {
    // Enforce tenant filtering based on the gateway header
    const tenantId = req.headers['x-tenant-id'];
    const userId = req.headers['x-user-id'];
    const { status, type, assignedTo } = req.query;
    
    if (!tenantId) {
      throw new ValidationError('Tenant ID is required in headers');
    }

    if (!userId) throw new ValidationError('User ID is required in headers');

    const isAdmin = await userHasTenantWideCaseAccess(userId);

    const whereClause = {
      tenantId, // strict tenant boundary
      ...(status && { status }),
      ...(type && { type }),
      deletedAt: null,
    };

    if (!isAdmin) {
      // Non-admins can only see cases they are assigned to or created
      whereClause.OR = [
        { assignedTo: userId },
        { createdBy: userId }
      ];
    } else if (assignedTo) {
      // Admins can filter by assignee
      whereClause.assignedTo = assignedTo;
    }

    const cases = await prisma.case.findMany({
      where: whereClause,
      include: {
        tenant: true,
        assignee: true,
        creator: true,
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ cases });
  } catch (error) {
    next(error);
  }
}

export async function getCase(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const userId = req.headers['x-user-id'];
    if (!userId) throw new ValidationError('User ID is required in headers');

    const isAdmin = await userHasTenantWideCaseAccess(userId);

    const whereClause = {
      id: req.params.id,
      tenantId, // strict tenant boundary
      deletedAt: null
    };

    if (!isAdmin) {
      whereClause.OR = [
        { assignedTo: userId },
        { createdBy: userId }
      ];
    }

    const case_ = await prisma.case.findFirst({
      where: whereClause,
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
    const tenantId = req.headers['x-tenant-id'];
    const userId = req.headers['x-user-id'];
    const { workflowId, title, description, type, priority, metadata } = req.body;

    if (!tenantId || !userId) throw new ValidationError('Tenant ID and User ID are required');
    if (!workflowId || !title || !type) throw new ValidationError('workflowId, title, and type are required');

    // 1. Validate workflow
    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId },
      include: { steps: true }
    });

    if (!workflow) throw new NotFoundError('Workflow');
    if (workflow.status !== 'PUBLISHED') throw new WorkflowNotPublishedError();

    // 2. Find initial step
    const initialStep = workflow.steps.find(s => s.isInitial);
    if (!initialStep) throw new ValidationError('Workflow has no initial step');

    // 3. Generate Case Number
    const caseNumber = await generateCaseNumber(tenantId);

    // 4. Create the Case
    const case_ = await prisma.case.create({
      data: {
        tenantId,
        originatingTenantId: tenantId,
        currentTenantId: tenantId,
        workflowId,
        workflowVersion: workflow.version,
        currentStepId: initialStep.id,
        caseNumber,
        title,
        description,
        type,
        priority,
        metadata,
        createdBy: userId,
      },
      include: {
        tenant: true,
        creator: true,
        currentStep: true
      },
    });

    // 5. Create initial history record
    await prisma.caseHistory.create({
      data: {
        caseId: case_.id,
        tenantId,
        toStepId: initialStep.id,
        actorId: userId,
        comment: 'Case created and initialized',
      }
    });

    await eventBus.publish(TOPICS.CASE_CREATED, { caseId: case_.id, tenantId: case_.tenantId });
    emitAudit({
      tenantId,
      entityType: 'case',
      entityId: case_.id,
      action: 'case_created',
      userId,
      metadata: { caseNumber: case_.caseNumber, workflowId, title },
    });
    res.status(201).json({ case: case_ });
  } catch (error) {
    next(error);
  }
}

export async function updateCase(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const userId = req.headers['x-user-id'];
    const case_ = await prisma.case.updateMany({
      where: { id: req.params.id, tenantId },
      data: req.body,
    });
    if (case_.count === 0) throw new NotFoundError('Case');

    await eventBus.publish(TOPICS.CASE_UPDATED, { caseId: req.params.id });
    emitAudit({
      tenantId,
      entityType: 'case',
      entityId: req.params.id,
      action: 'case_updated',
      userId: userId || null,
      metadata: { fields: Object.keys(req.body || {}) },
    });

    const updated = await prisma.case.findUnique({ where: { id: req.params.id } });
    res.json({ case: updated });
  } catch (error) {
    next(error);
  }
}

export async function deleteCase(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const userId = req.headers['x-user-id'];
    const result = await prisma.case.updateMany({
      where: { id: req.params.id, tenantId },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) throw new NotFoundError('Case');

    emitAudit({
      tenantId,
      entityType: 'case',
      entityId: req.params.id,
      action: 'case_deleted',
      userId: userId || null,
      metadata: {},
    });

    res.json({ message: 'Case deleted' });
  } catch (error) {
    next(error);
  }
}

export async function executeTransition(req, res, next) {
  try {
    const { id: caseId, transitionId } = req.params;
    const { comment } = req.body;
    const tenantId = req.headers['x-tenant-id'];
    const userId = req.headers['x-user-id'];
    const userRolesStr = req.headers['x-user-roles'];
    const userRoles = userRolesStr ? userRolesStr.split(',') : [];

    if (!tenantId || !userId) throw new ValidationError('Authentication headers required');

    // 1. Fetch case with current step
    const case_ = await prisma.case.findFirst({
      where: { id: caseId, tenantId, deletedAt: null },
      include: { workflow: true }
    });

    if (!case_) throw new NotFoundError('Case');
    if (case_.closedAt) throw new ValidationError('Case is already closed');

    // 2. Fetch transition
    const transition = await prisma.workflowTransition.findUnique({
      where: { id: transitionId },
      include: { toStep: true }
    });

    if (!transition) throw new NotFoundError('Transition');

    // 3. Validate transition from current step
    if (transition.fromStepId !== case_.currentStepId) {
      throw new InvalidTransitionError(`Transition not valid from current step`);
    }

    // 4. Validate roles (if transition has allowedRoleIds)
    if (transition.allowedRoleIds && transition.allowedRoleIds.length > 0) {
      const hasRole = transition.allowedRoleIds.some(role => userRoles.includes(role));
      if (!hasRole) throw new ValidationError('User does not have permission to execute this transition');
    }

    if (transition.requiresComment && !comment) {
      throw new ValidationError('This transition requires a comment');
    }

    // 5. Execute atomically
    const [updatedCase, history] = await prisma.$transaction([
      prisma.case.update({
        where: { id: caseId },
        data: {
          currentStepId: transition.toStepId,
          status: transition.toStep.isFinal ? 'closed' : case_.status,
          closedAt: transition.toStep.isFinal ? new Date() : null,
        }
      }),
      prisma.caseHistory.create({
        data: {
          caseId,
          tenantId,
          transitionId,
          fromStepId: case_.currentStepId,
          toStepId: transition.toStepId,
          actorId: userId,
          comment
        }
      })
    ]);

    await eventBus.publish(TOPICS.CASE_TRANSITIONED, {
      caseId,
      tenantId,
      transitionId,
      fromStepId: case_.currentStepId,
      toStepId: transition.toStepId,
    });

    emitAudit({
      tenantId,
      entityType: 'case',
      entityId: caseId,
      action: 'case_transitioned',
      userId,
      metadata: {
        transitionId,
        fromStepId: case_.currentStepId,
        toStepId: transition.toStepId,
      },
    });

    res.json({ case: updatedCase, history });
  } catch (error) {
    next(error);
  }
}

export async function getCaseHistory(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const caseId = req.params.id;

    const history = await prisma.caseHistory.findMany({
      where: { caseId, tenantId },
      include: {
        transition: true,
        actor: true, 
      },
      orderBy: { transitionedAt: 'desc' }
    });

    res.json({ history });
  } catch (error) {
    next(error);
  }
}

export async function getCaseState(req, res, next) {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const userRolesStr = req.headers['x-user-roles'];
    const userRoles = userRolesStr ? userRolesStr.split(',') : [];
    const caseId = req.params.id;

    const case_ = await prisma.case.findFirst({
      where: { id: caseId, tenantId, deletedAt: null },
      include: {
        currentStep: true,
      }
    });

    if (!case_) throw new NotFoundError('Case');

    // Get available outgoing transitions from current step
    let availableActions = [];
    if (case_.currentStepId) {
      const transitions = await prisma.workflowTransition.findMany({
        where: { fromStepId: case_.currentStepId },
        include: { toStep: true }
      });

      // Filter by role
      availableActions = transitions.filter(t => {
        if (!t.allowedRoleIds || t.allowedRoleIds.length === 0) return true;
        return t.allowedRoleIds.some(role => userRoles.includes(role));
      });
    }

    const history = await prisma.caseHistory.findMany({
      where: { caseId },
      include: { transition: true, actor: true },
      orderBy: { transitionedAt: 'desc' }
    });

    res.json({
      currentStep: case_.currentStep,
      availableActions,
      history
    });
  } catch (error) {
    next(error);
  }
}
