import { executeEntityQuery } from '../queryHelper.js';
export const workflowsResolver = (_root, args, ctx, info) => executeEntityQuery('workflows', args, ctx, info);
