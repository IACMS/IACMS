import * as store from '../services/notification.store.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('notification:case-consumer');

/**
 * Handle case.assigned event
 * Expected payload: { caseId, assignedTo, tenantId, assignmentType, caseNumber }
 */
export async function handleCaseAssigned(data) {
  try {
    const recipientId = data.assignedTo || data.assigneeId || data.userId;
    if (!recipientId) return;

    const caseNum = data.caseNumber || (data.caseId ? data.caseId.slice(0, 8) : '');
    const title = 'New Case Assigned';
    const body = caseNum
      ? `You have been assigned to Case #${caseNum}.`
      : 'You have been assigned to a new case.';

    logger.info('Dispatching case assignment notification', { caseId: data.caseId, recipientId });

    await store.createNotification({
      recipientId,
      type: 'CASE_ASSIGNED',
      title,
      body,
      data: {
        caseId: data.caseId,
        caseNumber: data.caseNumber,
        tenantId: data.tenantId,
        assignmentType: data.assignmentType,
        url: `/cases/${data.caseId}`,
      },
    });
  } catch (err) {
    logger.error('Failed to handle case.assigned event', { error: err.message });
  }
}

/**
 * Handle case.transitioned event (status / workflow step changes)
 * Expected payload: { caseId, tenantId, transitionId, fromStepId, toStepId, actorId, comment, caseNumber, assignedTo }
 */
export async function handleCaseTransitioned(data) {
  try {
    const recipientId = data.assignedTo;
    // Skip if no assigned user or if the actor who triggered the transition is the assignee
    if (!recipientId || recipientId === data.actorId) return;

    const caseNum = data.caseNumber || (data.caseId ? data.caseId.slice(0, 8) : '');
    const title = 'Case Status Updated';
    const body = caseNum
      ? `Case #${caseNum} has transitioned to a new workflow stage.`
      : 'A case assigned to you has transitioned to a new workflow stage.';

    logger.info('Dispatching case transitioned notification', { caseId: data.caseId, recipientId });

    await store.createNotification({
      recipientId,
      type: 'CASE_TRANSITIONED',
      title,
      body,
      data: {
        caseId: data.caseId,
        caseNumber: data.caseNumber,
        tenantId: data.tenantId,
        transitionId: data.transitionId,
        url: `/cases/${data.caseId}`,
      },
    });
  } catch (err) {
    logger.error('Failed to handle case.transitioned event', { error: err.message });
  }
}

/**
 * Handle case.created event
 * Expected payload: { caseId, tenantId, caseNumber, actorId, assignedTo }
 */
export async function handleCaseCreated(data) {
  try {
    const recipientId = data.assignedTo;
    if (!recipientId || recipientId === data.actorId) return;

    const caseNum = data.caseNumber || (data.caseId ? data.caseId.slice(0, 8) : '');
    const title = 'New Case Created';
    const body = caseNum
      ? `Case #${caseNum} was created and assigned to you.`
      : 'A new case has been created and assigned to you.';

    logger.info('Dispatching case created notification', { caseId: data.caseId, recipientId });

    await store.createNotification({
      recipientId,
      type: 'CASE_ASSIGNED',
      title,
      body,
      data: {
        caseId: data.caseId,
        caseNumber: data.caseNumber,
        tenantId: data.tenantId,
        url: `/cases/${data.caseId}`,
      },
    });
  } catch (err) {
    logger.error('Failed to handle case.created event', { error: err.message });
  }
}

/**
 * Handle referral.created event
 * Expected payload: { referralId, caseId, toTenantId, fromTenantId, referredBy, assignedTo }
 */
export async function handleReferralCreated(data) {
  try {
    const recipientId = data.assignedTo;
    if (!recipientId) return; // If unassigned, tenant-level list handles it

    const title = 'Incoming Case Referral';
    const body = `A new referral has been received for Case #${data.caseId ? data.caseId.slice(0, 8) : ''}.`;

    logger.info('Dispatching referral created notification', { referralId: data.referralId, recipientId });

    await store.createNotification({
      recipientId,
      type: 'REFERRAL_CREATED',
      title,
      body,
      data: {
        referralId: data.referralId,
        caseId: data.caseId,
        url: '/referrals',
      },
    });
  } catch (err) {
    logger.error('Failed to handle referral.created event', { error: err.message });
  }
}

/**
 * Handle referral.accepted event
 * Expected payload: { referralId, caseId, fromTenantId, toTenantId, acceptedBy, referredBy }
 */
export async function handleReferralAccepted(data) {
  try {
    const recipientId = data.referredBy;
    if (!recipientId || recipientId === data.acceptedBy) return;

    const title = 'Referral Approved';
    const body = `Your referral request for Case #${data.caseId ? data.caseId.slice(0, 8) : ''} has been approved and accepted.`;

    logger.info('Dispatching referral accepted notification', { referralId: data.referralId, recipientId });

    await store.createNotification({
      recipientId,
      type: 'REFERRAL_ACCEPTED',
      title,
      body,
      data: {
        referralId: data.referralId,
        caseId: data.caseId,
        url: '/referrals',
      },
    });
  } catch (err) {
    logger.error('Failed to handle referral.accepted event', { error: err.message });
  }
}

/**
 * Handle referral.rejected event
 * Expected payload: { referralId, caseId, originatingTenantId, rejectedBy, referredBy }
 */
export async function handleReferralRejected(data) {
  try {
    const recipientId = data.referredBy;
    if (!recipientId || recipientId === data.rejectedBy) return;

    const title = 'Referral Rejected';
    const body = `Your referral request for Case #${data.caseId ? data.caseId.slice(0, 8) : ''} was rejected.`;

    logger.info('Dispatching referral rejected notification', { referralId: data.referralId, recipientId });

    await store.createNotification({
      recipientId,
      type: 'REFERRAL_REJECTED',
      title,
      body,
      data: {
        referralId: data.referralId,
        caseId: data.caseId,
        url: '/referrals',
      },
    });
  } catch (err) {
    logger.error('Failed to handle referral.rejected event', { error: err.message });
  }
}
