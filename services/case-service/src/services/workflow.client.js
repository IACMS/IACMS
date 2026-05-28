const BASE = process.env.WORKFLOW_SERVICE_URL || 'http://localhost:3004';

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`workflow client ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Canonical workflow projection (matches shared/contracts workflow-full.fixture).
 */
export async function fetchWorkflowFull(workflowId, tenantId, userHeaders = {}) {
  const hdr = { 'x-tenant-id': tenantId, ...userHeaders };
  return fetchJson(`${BASE}/workflows/${workflowId}/full`, hdr);
}

/** Highest published workflow for tenant + key */
export async function fetchPublishedWorkflow(key, tenantId, userHeaders = {}) {
  const q = `?key=${encodeURIComponent(key)}&tenantId=${encodeURIComponent(tenantId)}`;
  return fetchJson(`${BASE}/workflows/published${q}`, {
    'x-tenant-id': tenantId,
    ...userHeaders,
  });
}
