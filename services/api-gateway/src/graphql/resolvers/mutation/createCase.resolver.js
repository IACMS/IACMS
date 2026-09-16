import { executeMutation } from '../mutationHelper.js';
export const createCaseResolver = (_root, { input }, ctx) => executeMutation('createCase', input, ctx);
