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
