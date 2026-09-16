import { executeMutation } from '../mutationHelper.js';
export const deactivateUserResolver = (_root, { input }, ctx) => executeMutation('deactivateUser', input, ctx);
