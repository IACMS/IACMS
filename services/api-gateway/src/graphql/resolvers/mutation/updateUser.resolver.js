import { executeMutation } from '../mutationHelper.js';
export const updateUserResolver = (_root, { input }, ctx) => executeMutation('updateUser', input, ctx);
