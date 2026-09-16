import { executeEntityQuery } from '../queryHelper.js';
export const assignmentsResolver = (_root, args, ctx, info) => executeEntityQuery('assignments', args, ctx, info);
