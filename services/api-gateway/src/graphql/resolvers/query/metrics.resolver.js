import { executeMetrics } from '../queryHelper.js';
export const metricsResolver = (_root, args, ctx) => executeMetrics(args, ctx);
