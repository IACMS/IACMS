/** Shared helpers for case workflow state / guide responses. */

export function transitionDurationMs(transition) {
  const amount = transition.timeLimitAmount;
  const unit = transition.timeLimitUnit;
  if (amount == null || amount < 1 || (unit !== 'HOURS' && unit !== 'DAYS')) return null;
  if (unit === 'HOURS') return amount * 3600_000;
  return amount * 86400_000;
}

export function transitionTimingForClient(transition, stepEnteredAt) {
  const type = transition.timeLimitType || 'NONE';
  const ms = transitionDurationMs(transition);
  if (!stepEnteredAt || type === 'NONE' || !ms) {
    return {
      timeLimitType: type,
      timeLimitAmount: transition.timeLimitAmount ?? null,
      timeLimitUnit: transition.timeLimitUnit ?? null,
      deadlineAt: null,
      isPastDue: false,
    };
  }
  const deadlineAt = new Date(stepEnteredAt.getTime() + ms);
  const isPastDue = Date.now() > deadlineAt.getTime();
  return {
    timeLimitType: type,
    timeLimitAmount: transition.timeLimitAmount,
    timeLimitUnit: transition.timeLimitUnit,
    deadlineAt: deadlineAt.toISOString(),
    isPastDue,
  };
}

/**
 * @param {object} full - workflow-full projection `{ steps, transitions }`
 * @param {string | null} currentStepId
 * @param {Array<{ fromStepId?: string | null }>} historyOldestFirst
 */
export function buildWorkflowGuideFromFull(full, currentStepId, historyOldestFirst = []) {
  if (!full?.steps?.length) return null;

  const leftFrom = new Set(
    (historyOldestFirst || []).filter((h) => h.fromStepId).map((h) => h.fromStepId),
  );

  const stepsSorted = [...full.steps].sort((a, b) =>
    a.position !== b.position ? a.position - b.position : a.key.localeCompare(b.key),
  );

  const steps = stepsSorted.map((s) => ({
    id: s.id,
    name: s.name,
    key: s.key,
    position: s.position,
    isInitial: s.isInitial,
    isFinal: s.isFinal,
    requiresAttachment: Boolean(s.requiresAttachment),
    phase: s.id === currentStepId ? 'current' : leftFrom.has(s.id) ? 'completed' : 'upcoming',
  }));

  return {
    steps,
    transitions: (full.transitions || []).map((t) => ({
      id: t.id,
      name: t.name,
      fromStepId: t.fromStepId,
      toStepId: t.toStepId,
    })),
  };
}
