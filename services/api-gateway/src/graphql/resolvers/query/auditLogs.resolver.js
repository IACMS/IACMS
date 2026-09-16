import { executeEntityQuery } from '../queryHelper.js';
export const auditLogsResolver = (_root, args, ctx, info) => executeEntityQuery('auditLogs', args, ctx, info);
