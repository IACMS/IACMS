/**
 * Unit tests — Workflow publish invariants (WorkflowStep + WorkflowTransition models).
 */
import { describe, it, expect } from 'vitest';
import { assertPublishable } from '../../src/services/invariants.js';

function validWorkflow() {
  return {
    steps: [
      { id: 's1', key: 'intake', isInitial: true, isFinal: false },
      { id: 's2', key: 'review', isInitial: false, isFinal: true },
    ],
    transitions: [{ id: 't1', name: 'submit', fromStepId: 's1', toStepId: 's2' }],
  };
}

describe('WorkflowStep + WorkflowTransition — assertPublishable', () => {
  it('accepts a minimal valid workflow', () => {
    expect(() => assertPublishable(validWorkflow())).not.toThrow();
  });

  it('rejects workflow without exactly one initial step', () => {
    const wf = validWorkflow();
    wf.steps.push({ id: 's3', key: 'extra', isInitial: true, isFinal: false });
    expect(() => assertPublishable(wf)).toThrow(/Exactly one step/);
  });

  it('rejects transition referencing unknown step', () => {
    const wf = validWorkflow();
    wf.transitions.push({ id: 't2', name: 'bad', fromStepId: 's1', toStepId: 'missing' });
    expect(() => assertPublishable(wf)).toThrow(/outside the workflow/);
  });

  it('rejects zero-length transition loops', () => {
    const wf = validWorkflow();
    wf.transitions.push({ id: 't2', name: 'loop', fromStepId: 's1', toStepId: 's1' });
    expect(() => assertPublishable(wf)).toThrow(/zero-length loop/);
  });

  it('rejects unreachable non-initial steps', () => {
    const wf = validWorkflow();
    wf.steps.push({ id: 's3', key: 'orphan', isInitial: false, isFinal: true });
    expect(() => assertPublishable(wf)).toThrow(/not reachable/);
  });
});
