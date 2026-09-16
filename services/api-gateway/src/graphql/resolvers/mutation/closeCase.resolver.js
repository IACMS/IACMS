import { executeMutation } from '../mutationHelper.js';
export const closeCaseResolver = (_root, { input }, ctx) => executeMutation('closeCase', input, ctx);
