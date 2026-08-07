import prisma from '../config/database.js';

function toFullJson(wf) {
  const steps = [...(wf.steps || [])].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  const transitions = [...(wf.transitions || [])].sort(
    (a, b) => a.fromStepId.localeCompare(b.fromStepId) || a.name.localeCompare(b.name),
  );
  return {
    id: wf.id,
    tenantId: wf.tenantId,
    departmentId: wf.departmentId ?? null,
    name: wf.name,
    key: wf.key,
    version: wf.version,
    status: wf.status,
    publishedAt: wf.publishedAt ? wf.publishedAt.toISOString() : null,
    steps: steps.map(s => ({
      id: s.id,
      key: s.key,
      name: s.name,
      description: s.description,
      isInitial: s.isInitial,
      isFinal: s.isFinal,
      position: s.position,
      allowedRoleIds: s.allowedRoleIds ?? [],
    })),
    transitions: transitions.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      fromStepId: t.fromStepId,
      toStepId: t.toStepId,
      allowedRoleIds: t.allowedRoleIds ?? [],
      requiresComment: t.requiresComment ?? false,
      timeLimitType: t.timeLimitType ?? 'NONE',
      timeLimitAmount: t.timeLimitAmount ?? null,
      timeLimitUnit: t.timeLimitUnit ?? null,
    })),
  };
}

/**
 * Direct internal workflow lookup in consolidated case-engine-service.
 */
export async function fetchWorkflowFull(workflowId) {
  const wf = await prisma.workflow.findFirst({
    where: { id: workflowId },
    include: {
      steps: { orderBy: [{ position: 'asc' }, { key: 'asc' }] },
      transitions: true,
    },
  });
  if (!wf) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }
  return toFullJson(wf);
}

/** Highest published workflow for tenant + key */
export async function fetchPublishedWorkflow(key, tenantId) {
  const wf = await prisma.workflow.findFirst({
    where: {
      tenantId,
      key,
      status: 'PUBLISHED',
    },
    orderBy: [{ departmentId: 'desc' }, { version: 'desc' }],
    include: {
      steps: { orderBy: [{ position: 'asc' }, { key: 'asc' }] },
      transitions: true,
    },
  });
  if (!wf) {
    throw new Error(`Published workflow not found for key: ${key}`);
  }
  return toFullJson(wf);
}
