import cases from './cases.allowlist.js';
import workflows from './workflows.allowlist.js';
import workflowSteps from './workflowSteps.allowlist.js';
import referrals from './referrals.allowlist.js';
import assignments from './assignments.allowlist.js';
import auditLogs from './auditLogs.allowlist.js';
import departments from './departments.allowlist.js';
import metrics from './metrics.allowlist.js';
import { InvalidQueryError } from '../../../../../shared/common/errors.js';

const registry = new Map([
  ['cases', cases],
  ['workflows', workflows],
  ['workflowSteps', workflowSteps],
  ['referrals', referrals],
  ['assignments', assignments],
  ['auditLogs', auditLogs],
  ['departments', departments],
  ['metrics', metrics],
]);

export default registry;

export function getAllowlist(entity) {
  const al = registry.get(entity);
  if (!al) throw new InvalidQueryError(`Unknown entity: ${entity}`);
  return al;
}
