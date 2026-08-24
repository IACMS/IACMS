import { describe, it, expect } from 'vitest';
import { assertPublishable } from '../../src/services/invariants.js';

describe('Workflow Engine Invariants (assertPublishable)', () => {
  it('passes for a valid minimal 2-step workflow', () => {
    const validWf = {
      steps: [
        { id: 's1', key: 'draft', isInitial: true, isFinal: false },
        { id: 's2', key: 'approved', isInitial: false, isFinal: true },
      ],
      transitions: [
        { id: 't1', name: 'Approve', fromStepId: 's1', toStepId: 's2' },
      ],
    };

    expect(() => assertPublishable(validWf)).not.toThrow();
  });

  it('fails if there is no initial step', () => {
    const invalidWf = {
      steps: [
        { id: 's1', key: 'step1', isInitial: false, isFinal: false },
        { id: 's2', key: 'step2', isInitial: false, isFinal: true },
      ],
      transitions: [
        { id: 't1', name: 'Go', fromStepId: 's1', toStepId: 's2' },
      ],
    };

    expect(() => assertPublishable(invalidWf)).toThrow(/Exactly one step must have isInitial=true/);
  });

  it('fails if there is no final step', () => {
    const invalidWf = {
      steps: [
        { id: 's1', key: 'step1', isInitial: true, isFinal: false },
        { id: 's2', key: 'step2', isInitial: false, isFinal: false },
      ],
      transitions: [
        { id: 't1', name: 'Go', fromStepId: 's1', toStepId: 's2' },
      ],
    };

    expect(() => assertPublishable(invalidWf)).toThrow(/At least one step must have isFinal=true/);
  });

  it('fails if a transition is a zero-length loop (fromStep === toStep)', () => {
    const loopWf = {
      steps: [
        { id: 's1', key: 'step1', isInitial: true, isFinal: false },
        { id: 's2', key: 'step2', isInitial: false, isFinal: true },
      ],
      transitions: [
        { id: 't1', name: 'Loop', fromStepId: 's1', toStepId: 's1' },
        { id: 't2', name: 'Approve', fromStepId: 's1', toStepId: 's2' },
      ],
    };

    expect(() => assertPublishable(loopWf)).toThrow(/cannot be a zero-length loop/);
  });

  it('fails if a non-final step has no outgoing transitions', () => {
    const deadEndWf = {
      steps: [
        { id: 's1', key: 'step1', isInitial: true, isFinal: false },
        { id: 's2', key: 'deadend', isInitial: false, isFinal: false },
        { id: 's3', key: 'done', isInitial: false, isFinal: true },
      ],
      transitions: [
        { id: 't1', name: 'GoToDeadEnd', fromStepId: 's1', toStepId: 's2' },
        { id: 't2', name: 'DirectToDone', fromStepId: 's1', toStepId: 's3' },
      ],
    };

    expect(() => assertPublishable(deadEndWf)).toThrow(/Step "deadend" must have at least one outgoing transition/);
  });

  it('fails if a step is unreachable from the initial step', () => {
    const unreachableWf = {
      steps: [
        { id: 's1', key: 'initial', isInitial: true, isFinal: false },
        { id: 's2', key: 'unreachable', isInitial: false, isFinal: false },
        { id: 's3', key: 'done', isInitial: false, isFinal: true },
      ],
      transitions: [
        { id: 't1', name: 'Finish', fromStepId: 's1', toStepId: 's3' },
        { id: 't2', name: 'FromUnreachable', fromStepId: 's2', toStepId: 's3' },
      ],
    };

    expect(() => assertPublishable(unreachableWf)).toThrow(/is not reachable from the initial step/);
  });
});
