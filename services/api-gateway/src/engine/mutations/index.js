import * as createCase from './createCase.mutation.js';
import * as executeTransition from './executeTransition.mutation.js';
import * as createReferral from './createReferral.mutation.js';

const mutations = new Map([
  ['createCase', createCase],
  ['executeTransition', executeTransition],
  ['createReferral', createReferral],
]);

export default mutations;

export function getMutation(action) {
  return mutations.get(action) || null;
}
