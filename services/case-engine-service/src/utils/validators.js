export function tenantIdHeader(req) {
  const tid = req.headers['x-tenant-id'];
  if (!tid || typeof tid !== 'string') return null;
  return tid.trim();
}

export function parseUuidList(ids) {
  if (!ids) return [];
  if (!Array.isArray(ids)) throw new Error('Must be array of UUID strings');
  return ids.map(String);
}
