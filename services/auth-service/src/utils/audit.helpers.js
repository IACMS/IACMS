/**
 * Canonical audit.log Kafka fields per shared/contracts/audit-event.contract.md
 */

/** @param {import('express').Request | undefined | null} req */
export function auditClient(req) {
  if (!req) return { ipAddress: undefined, userAgent: undefined };
  const rawIp = req.ip ?? req.socket?.remoteAddress ?? null;
  const ipAddress = typeof rawIp === 'string' ? rawIp : null;
  const uaHeader = req.headers?.['user-agent'];
  let userAgent = null;
  if (typeof uaHeader === 'string') userAgent = uaHeader.slice(0, 512);
  else if (Array.isArray(uaHeader) && uaHeader[0]) userAgent = String(uaHeader[0]).slice(0, 512);
  return { ipAddress, userAgent };
}

/** Merge `ipAddress` / `userAgent` onto an audit payload when Express `req` is present. */
export function withAuditClient(base, req) {
  const { ipAddress, userAgent } = auditClient(req);
  const out = { ...base };
  if (ipAddress != null) out.ipAddress = ipAddress;
  if (userAgent != null) out.userAgent = userAgent;
  return out;
}
