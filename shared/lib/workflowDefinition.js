/**
 * Shared workflow definition validation and transition matching.
 * Shape matches {@link prisma/seed.js} default workflow: states, initialState, transitions (from, to, name?).
 */

import { ValidationError } from '../common/errors.js';

/**
 * @typedef {{ from: string, to: string, name?: string }} WorkflowTransition
 * @typedef {{ states: string[], initialState: string, transitions: WorkflowTransition[] }} WorkflowDefinition
 */

/**
 * @param {unknown} def
 * @returns {import('../common/errors.js').ValidationError|undefined} undefined if valid
 */
function definitionErrors(def) {
  if (def == null || typeof def !== 'object' || Array.isArray(def)) {
    return new ValidationError('definition must be a non-null object');
  }
  const d = def;
  if (!Array.isArray(d.states) || d.states.length === 0) {
    return new ValidationError('definition.states must be a non-empty array of strings');
  }
  for (const s of d.states) {
    if (typeof s !== 'string' || s.length === 0) {
      return new ValidationError('definition.states must contain only non-empty strings');
    }
  }
  if (typeof d.initialState !== 'string' || !d.states.includes(d.initialState)) {
    return new ValidationError('definition.initialState must be a string included in definition.states');
  }
  if (!Array.isArray(d.transitions)) {
    return new ValidationError('definition.transitions must be an array');
  }
  for (const t of d.transitions) {
    if (t == null || typeof t !== 'object') {
      return new ValidationError('each transition must be an object with from and to');
    }
    if (typeof t.from !== 'string' || typeof t.to !== 'string') {
      return new ValidationError('each transition must have string from and to');
    }
    if (!d.states.includes(t.from) || !d.states.includes(t.to)) {
      return new ValidationError('transition from/to must refer to names in definition.states');
    }
    if (t.name != null && typeof t.name !== 'string') {
      return new ValidationError('transition name must be a string when provided');
    }
  }
  return undefined;
}

/**
 * @param {unknown} def
 */
export function validateDefinition(def) {
  const err = definitionErrors(def);
  if (err) throw err;
}

/**
 * @param {object} def
 * @param {string} from
 * @param {string} to
 * @param {string|undefined} transitionName
 * @returns {WorkflowTransition | null}
 * @throws {import('../common/errors.js').ValidationError} when from→to is ambiguous and transitionName is missing
 */
export function findTransition(def, from, to, transitionName) {
  const list = def.transitions.filter(t => t.from === from && t.to === to);
  if (list.length === 0) return null;
  if (transitionName != null && transitionName !== '') {
    return list.find(t => t.name === transitionName) ?? null;
  }
  if (list.length > 1) {
    const unnamed = list.filter(t => t.name == null || t.name === '');
    if (unnamed.length === 1) return unnamed[0];
    throw new ValidationError(
      'transitionName is required when multiple transitions exist for the same from → to state pair'
    );
  }
  return list[0];
}

/**
 * @param {WorkflowDefinition} def
 * @param {string} currentFromLatestRow
 * @param {string} caseStatus
 * @param {boolean} hasStateRows
 * @returns {string}
 */
export function resolveCurrentState(def, currentFromLatestRow, caseStatus, hasStateRows) {
  if (hasStateRows) {
    return currentFromLatestRow;
  }
  if (caseStatus === def.initialState) {
    return def.initialState;
  }
  throw new ValidationError(
    `Case status "${caseStatus}" must equal workflow initial state "${def.initialState}" when no history exists`
  );
}
