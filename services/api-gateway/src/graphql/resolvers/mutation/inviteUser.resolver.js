import { executeMutation } from '../mutationHelper.js';
export const inviteUserResolver = (_root, { input }, ctx) => executeMutation('inviteUser', input, ctx);
