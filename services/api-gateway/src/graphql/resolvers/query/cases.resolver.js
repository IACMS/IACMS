import { executeEntityQuery } from '../queryHelper.js';
export const casesResolver = (_root, args, ctx, info) => executeEntityQuery('cases', args, ctx, info);
