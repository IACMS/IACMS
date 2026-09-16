import { executeEntityQuery } from '../queryHelper.js';
export const departmentsResolver = (_root, args, ctx, info) => executeEntityQuery('departments', args, ctx, info);
