/**
 * Email Consumer Handlers
 *
 * These functions are registered as Kafka event handlers in server.js.
 * Each handler receives the event payload published by auth-service and
 * dispatches the appropriate transactional email.
 */

import {
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendVerificationEmail,
  sendCaseCreatedEmail,
  sendCaseAssignedEmail,
  sendCaseUpdatedEmail,
  sendWorkflowStateChangedEmail,
  sendReferralCreatedReferrerEmail,
  sendReferralCreatedPartnerEmail,
  sendReferralAcceptedEmail,
  sendReferralRejectedEmail,
} from '../utils/email.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('notification:email');

/**
 * Handle user.created events.
 *
 * Only sends a welcome email when the user was created by an admin
 * (source === 'admin'). Self-registered users do not receive this email.
 *
 * Expected payload:
 *   { userId, email, firstName, tenantName, tenantCode, temporaryPassword, source }
 */
export async function handleUserCreated(data) {
  if (data.source !== 'admin' || !data.temporaryPassword) {
    return;
  }

  logger.info('Sending welcome email', { userId: data.userId, email: data.email });

  await sendWelcomeEmail({
    to: data.email,
    firstName: data.firstName,
    tenantName: data.tenantName,
    temporaryPassword: data.temporaryPassword,
  });
}

/**
 * Handle password.reset.requested events.
 *
 * Expected payload:
 *   { email, firstName, resetToken, tenantCode }
 */
export async function handlePasswordResetRequested(data) {
  logger.info('Sending password reset email', { email: data.email });

  await sendPasswordResetEmail({
    to: data.email,
    firstName: data.firstName,
    resetToken: data.resetToken,
    tenantCode: data.tenantCode,
  });
}

/**
 * Handle password.changed events.
 * Triggered after both resetPassword and changePassword flows.
 *
 * Expected payload:
 *   { email, firstName }
 */
export async function handlePasswordChanged(data) {
  logger.info('Sending password changed confirmation', { email: data.email });

  await sendPasswordChangedEmail({
    to: data.email,
    firstName: data.firstName,
  });
}

/**
 * Handle email.verification.requested events.
 * Sent on registration and when the user requests a resend.
 *
 * Expected payload:
 *   { userId, email, firstName, verificationToken, tenantCode }
 */
export async function handleEmailVerificationRequested(data) {
  logger.info('Sending verification email', { userId: data.userId, email: data.email });

  await sendVerificationEmail({
    to: data.email,
    firstName: data.firstName,
    verificationToken: data.verificationToken,
    tenantCode: data.tenantCode,
  });
}

export async function handleCaseCreated(data) {
  if (!data?.caseId || !data?.creatorEmail) return;
  logger.info('Case created notification', { caseId: data.caseId });
  const cc = data.assigneeEmail && data.assigneeEmail !== data.creatorEmail ? data.assigneeEmail : undefined;
  await sendCaseCreatedEmail({
    to: data.creatorEmail,
    cc,
    firstName: data.creatorFirstName,
    caseNumber: data.caseNumber,
    title: data.title,
    tenantCode: data.tenantCode,
    caseId: data.caseId,
  });
}

export async function handleCaseAssigned(data) {
  if (!data?.caseId || !data?.assigneeEmail) return;
  logger.info('Case assigned notification', { caseId: data.caseId });
  await sendCaseAssignedEmail({
    to: data.assigneeEmail,
    firstName: data.assigneeFirstName,
    caseNumber: data.caseNumber,
    title: data.caseTitle,
    tenantCode: data.tenantCode,
    caseId: data.caseId,
  });
}

export async function handleCaseUpdated(data) {
  if (!data?.caseId) return;
  logger.info('Case updated notification', { caseId: data.caseId });
  const { caseId, creatorEmail, assigneeEmail, creatorFirstName, assigneeFirstName, caseNumber, title } = data;
  if (creatorEmail) {
    await sendCaseUpdatedEmail({
      to: creatorEmail,
      firstName: creatorFirstName,
      caseNumber,
      title,
      caseId,
    });
  }
  if (assigneeEmail && assigneeEmail !== creatorEmail) {
    await sendCaseUpdatedEmail({
      to: assigneeEmail,
      firstName: assigneeFirstName,
      caseNumber,
      title,
      caseId,
    });
  }
}

export async function handleWorkflowStateChanged(data) {
  if (!data?.caseId || !data?.transitionerEmail) return;
  logger.info('Workflow state notification', { caseId: data.caseId });
  await sendWorkflowStateChangedEmail({
    to: data.transitionerEmail,
    firstName: data.transitionerFirstName,
    caseNumber: data.caseNumber,
    title: data.caseTitle,
    fromState: data.from,
    toState: data.to,
    tenantCode: data.tenantCode,
    caseId: data.caseId,
  });
}

export async function handleReferralCreated(data) {
  if (!data?.referralId || !data?.caseId) return;
  logger.info('Referral created notification', { referralId: data.referralId });
  if (data.referrerEmail) {
    await sendReferralCreatedReferrerEmail({
      to: data.referrerEmail,
      firstName: data.referrerFirstName,
      caseNumber: data.caseNumber,
      title: data.caseTitle,
      toTenantName: data.toTenantName,
      toTenantCode: data.toTenantCode,
      caseId: data.caseId,
    });
  }
  if (data.partnerContactEmail && data.partnerContactEmail !== data.referrerEmail) {
    await sendReferralCreatedPartnerEmail({
      to: data.partnerContactEmail,
      firstName: data.partnerContactFirstName,
      caseNumber: data.caseNumber,
      title: data.caseTitle,
      fromTenantCode: data.fromTenantCode,
      reason: data.referralReason,
      caseId: data.caseId,
    });
  }
}

export async function handleReferralAccepted(data) {
  if (!data?.referralId) return;
  logger.info('Referral accepted notification', { referralId: data.referralId });
  if (data.referrerEmail) {
    await sendReferralAcceptedEmail({
      to: data.referrerEmail,
      firstName: data.referrerFirstName,
      caseNumber: data.caseNumber,
      toTenantCode: data.toTenantCode,
      caseId: data.caseId,
      perspective: 'referrer',
    });
  }
  if (data.accepterEmail && data.accepterEmail !== data.referrerEmail) {
    await sendReferralAcceptedEmail({
      to: data.accepterEmail,
      firstName: data.accepterFirstName,
      caseNumber: data.caseNumber,
      toTenantCode: data.toTenantCode,
      caseId: data.caseId,
      perspective: 'accepter',
    });
  }
}

export async function handleReferralRejected(data) {
  if (!data?.referralId) return;
  logger.info('Referral rejected notification', { referralId: data.referralId });
  if (data.referrerEmail) {
    await sendReferralRejectedEmail({
      to: data.referrerEmail,
      firstName: data.referrerFirstName,
      caseNumber: data.caseNumber,
      toTenantCode: data.toTenantCode,
      caseId: data.caseId,
      perspective: 'referrer',
    });
  }
  if (data.rejecterEmail && data.rejecterEmail !== data.referrerEmail) {
    await sendReferralRejectedEmail({
      to: data.rejecterEmail,
      firstName: data.rejecterFirstName,
      caseNumber: data.caseNumber,
      toTenantCode: data.toTenantCode,
      caseId: data.caseId,
      perspective: 'rejecter',
    });
  }
}
