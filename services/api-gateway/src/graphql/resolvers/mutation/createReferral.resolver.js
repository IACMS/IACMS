import { executeMutation } from '../mutationHelper.js';
export const createReferralResolver = (_root, { input }, ctx) => executeMutation('createReferral', input, ctx);
