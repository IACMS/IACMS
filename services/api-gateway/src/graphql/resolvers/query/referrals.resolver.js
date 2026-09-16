import { executeEntityQuery } from '../queryHelper.js';
export const referralsResolver = (_root, args, ctx, info) => executeEntityQuery('referrals', args, ctx, info);
