/**
 * Workflow publish invariants (PHASES §5.4).
 * @param {{ steps: any[]; transitions: any[] }} workflow — must include steps + transitions arrays
 */
export function assertPublishable(workflow) {
  const steps = workflow.steps || [];
  const transitions = workflow.transitions || [];
  const errs = [];

  const initial = steps.filter(s => s.isInitial);
  if (initial.length !== 1) errs.push('Exactly one step must have isInitial=true');
  if (!steps.some(s => s.isFinal)) errs.push('At least one step must have isFinal=true');

  const stepIds = new Set(steps.map(s => s.id));
  for (const t of transitions) {
    if (!stepIds.has(t.fromStepId) || !stepIds.has(t.toStepId)) {
      errs.push(`Transition "${t.name}" references a step outside the workflow`);
    }
    if (t.fromStepId === t.toStepId) {
      errs.push(`Transition "${t.name}" cannot be a zero-length loop (fromStep === toStep)`);
    }
  }

  const byId = new Map(steps.map(s => [s.id, s]));
  for (const s of steps) {
    if (s.isFinal) continue;
    const hasOut = transitions.some(t => t.fromStepId === s.id);
    if (!hasOut) errs.push(`Step "${s.key}" must have at least one outgoing transition`);
  }

  const root = initial[0]?.id;
  if (root) {
    const adj = new Map();
    for (const t of transitions) {
      if (!adj.has(t.fromStepId)) adj.set(t.fromStepId, []);
      adj.get(t.fromStepId).push(t.toStepId);
    }
    const seen = new Set([root]);
    const q = [root];
    while (q.length) {
      const u = q.shift();
      for (const v of adj.get(u) || []) {
        if (!seen.has(v)) {
          seen.add(v);
          q.push(v);
        }
      }
    }
    for (const s of steps) {
      if (!s.isInitial && !seen.has(s.id)) errs.push(`Step "${s.key}" is not reachable from the initial step`);
    }
  }

  if (errs.length) {
    const e = new Error(errs.join('; '));
    e.code = 'WORKFLOW_NOT_PUBLISHABLE';
    e.details = errs;
    throw e;
  }
}
