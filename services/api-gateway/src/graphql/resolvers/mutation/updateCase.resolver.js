import { executeMutation } from '../mutationHelper.js';
export const updateCaseResolver = (_root, { input }, ctx) => executeMutation('updateCase', input, ctx);
