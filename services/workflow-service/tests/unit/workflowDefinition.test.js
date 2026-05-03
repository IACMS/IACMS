import { describe, it, expect } from 'vitest';
import {
  findTransition,
  resolveCurrentState,
  validateDefinition,
} from '../../../../shared/lib/workflowDefinition.js';
import { ValidationError } from '../../../../shared/common/errors.js';

const simple = {
  states: ['a', 'b', 'c'],
  initialState: 'a',
  transitions: [{ from: 'a', to: 'b', name: 'go' }, { from: 'b', to: 'c' }],
};

describe('validateDefinition', () => {
  it('accepts a valid definition', () => {
    expect(() => validateDefinition(simple)).not.toThrow();
  });

  it('rejects bad shapes', () => {
    expect(() => validateDefinition(null)).toThrow(ValidationError);
    expect(() => validateDefinition({ states: [], initialState: 'a', transitions: [] })).toThrow(
      ValidationError
    );
    expect(() =>
      validateDefinition({ states: ['a'], initialState: 'x', transitions: [] })
    ).toThrow(ValidationError);
  });
});

describe('findTransition', () => {
  it('finds a single edge', () => {
    const t = findTransition(simple, 'a', 'b', 'go');
    expect(t).toEqual({ from: 'a', to: 'b', name: 'go' });
  });

  it('returns null for missing edge', () => {
    expect(findTransition(simple, 'a', 'c', undefined)).toBeNull();
  });

  it('throws when from→to is ambiguous and name is missing', () => {
    const def = {
      states: ['a', 'b'],
      initialState: 'a',
      transitions: [
        { from: 'a', to: 'b', name: 'x' },
        { from: 'a', to: 'b', name: 'y' },
      ],
    };
    expect(() => findTransition(def, 'a', 'b', undefined)).toThrow(ValidationError);
  });

  it('picks a named edge when disambiguation is required', () => {
    const def = {
      states: ['a', 'b'],
      initialState: 'a',
      transitions: [
        { from: 'a', to: 'b', name: 'x' },
        { from: 'a', to: 'b', name: 'y' },
      ],
    };
    expect(findTransition(def, 'a', 'b', 'y')).toEqual({ from: 'a', to: 'b', name: 'y' });
  });
});

describe('resolveCurrentState', () => {
  it('uses latest row when history exists', () => {
    expect(
      resolveCurrentState(simple, 'b', 'wrong-status', true)
    ).toBe('b');
  });

  it('requires case status to match initial when there is no history', () => {
    expect(
      resolveCurrentState(simple, 'a', 'a', false)
    ).toBe('a');
    expect(() => resolveCurrentState(simple, 'a', 'open', false)).toThrow(ValidationError);
  });
});
