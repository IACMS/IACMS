/**
 * Tenant visibility rules per PHASES §6.5 (explicit OR-scoped reads; write by currentTenantId).
 */
export function readableCaseConditions(callerTenantId) {
  return {
    OR: [
      { tenantId: callerTenantId },
      { currentTenantId: callerTenantId },
      { originatingTenantId: callerTenantId },
    ],
    deletedAt: null,
  };
}

export function writableCaseWhere(caseId, callerTenantId) {
  return { id: caseId, currentTenantId: callerTenantId, deletedAt: null };
}
