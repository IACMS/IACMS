import { executeMutation } from '../mutationHelper.js';
export const executeTransitionResolver = (_root, { input }, ctx) => executeMutation('executeTransition', input, ctx);
