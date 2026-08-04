/**
 * Tenant visibility rules per PHASES §6.5 (explicit OR-scoped reads; write by currentTenantId).
 * Receiving agencies may read cases with a pending referral addressed to them (accept/reject).
 */
export function incomingReferralReadableCondition(callerTenantId) {
  return {
    referrals: {
      some: {
        toTenantId: callerTenantId,
        status: 'pending',
      },
    },
  };
}

export function readableCaseConditions(callerTenantId) {
  return {
    deletedAt: null,
    OR: [
      { tenantId: callerTenantId },
      { currentTenantId: callerTenantId },
      { originatingTenantId: callerTenantId },
      incomingReferralReadableCondition(callerTenantId),
    ],
  };
}

/** Agency that may mutate workflow state (execute transitions, close, etc.). */
export function mutableCaseConditions(callerTenantId) {
  return {
    deletedAt: null,
    OR: [
      { currentTenantId: callerTenantId },
      {
        tenantId: callerTenantId,
        OR: [{ currentTenantId: null }, { currentTenantId: callerTenantId }],
      },
    ],
  };
}

export function writableCaseWhere(caseId, callerTenantId) {
  return { id: caseId, ...mutableCaseConditions(callerTenantId) };
}
