import { executeEntityQuery } from '../queryHelper.js';
export const workflowStepsResolver = (_root, args, ctx, info) => executeEntityQuery('workflowSteps', args, ctx, info);
