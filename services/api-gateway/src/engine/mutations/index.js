import * as createCase       from './createCase.mutation.js';
import * as executeTransition from './executeTransition.mutation.js';
import * as createReferral    from './createReferral.mutation.js';
import * as updateCase        from './updateCase.mutation.js';
import * as closeCase         from './closeCase.mutation.js';
import * as inviteUser        from './inviteUser.mutation.js';
import * as deactivateUser    from './deactivateUser.mutation.js';
import * as updateUser        from './updateUser.mutation.js';

const mutations = new Map([
  // ── Phase 0-3 (original) ───────────────────────────────────────────
  ['createCase',       createCase],
  ['executeTransition', executeTransition],
  ['createReferral',   createReferral],

  // ── Phase 4.1 — Expanded Mutations ────────────────────────────────
  // Group A: Case mutations
  ['updateCase',       updateCase],
  ['closeCase',        closeCase],

  // Group B: User management mutations
  ['inviteUser',       inviteUser],
  ['deactivateUser',   deactivateUser],
  ['updateUser',       updateUser],
]);

export default mutations;

export function getMutation(action) {
  return mutations.get(action) || null;
}

/**
 * Returns the list of all registered mutation action names.
 * Used by the scope discovery endpoint so the frontend API key form
 * stays in sync with registered handlers automatically.
 */
export function getMutationActions() {
  return Array.from(mutations.keys());
}
