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
  sendAgencyApprovedEmail,
} from '../utils/email.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('notification:email');

/**
 * Handle user.created events.
 *
 * Sends a welcome email with a temporary password when:
 * - a tenant user was created by an org admin (`source === 'admin'`), or
 * - platform registered a new org and its first administrator (`source === 'tenant_register'`).
 *
 * Self-service registration (`source === 'register'`) does not send this email here.
 *
 * Expected payload:
 *   { userId, email, firstName, tenantName, tenantCode, temporaryPassword, source }
 */
export async function handleUserCreated(data) {
  const welcomeEligible =
    (data.source === 'admin' || data.source === 'tenant_register') &&
    typeof data.temporaryPassword === 'string' &&
    data.temporaryPassword.length > 0;

  if (!welcomeEligible) return;

  logger.info('Sending welcome email', { userId: data.userId, email: data.email });

  await sendWelcomeEmail({
    to: data.email,
    firstName: data.firstName,
    tenantName: data.tenantName,
    tenantCode: data.tenantCode,
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

/**
 * Handle tenant.approved events.
 * Sent when a platform admin approves a self-registered agency.
 *
 * Expected payload:
 *   { tenantId, tenantName, tenantCode, email, firstName }
 */
export async function handleTenantApproved(data) {
  logger.info('Sending agency approval email', { tenantId: data.tenantId, email: data.email });

  await sendAgencyApprovedEmail({
    to: data.email,
    firstName: data.firstName,
    tenantName: data.tenantName,
    tenantCode: data.tenantCode,
  });
}
