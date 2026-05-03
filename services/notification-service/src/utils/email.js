/**
 * Email Utility — Mailtrap SMTP
 *
 * Sends transactional emails via nodemailer using Mailtrap sandbox in development.
 * In production, swap SMTP credentials for a real provider (SendGrid, SES, etc.).
 */

import nodemailer from 'nodemailer';
import {
  welcomeEmailTemplate,
  passwordResetTemplate,
  passwordChangedTemplate,
  emailVerificationTemplate,
  caseCreatedTemplate,
  caseAssignedTemplate,
  caseUpdatedTemplate,
  workflowStateChangedTemplate,
  referralCreatedReferrerTemplate,
  referralCreatedPartnerTemplate,
  referralAcceptedTemplate,
  referralRejectedTemplate,
} from './email.templates.js';
import Logger from '../../../../shared/common/logger.js';

const logger = new Logger('email');

// Lazy-created transporter (created once on first send)
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'sandbox.smtp.mailtrap.io',
    port: parseInt(process.env.SMTP_PORT || '2525', 10),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

/**
 * Send a single email.
 * Never throws — logs the error and returns false so callers don't crash.
 */
async function sendEmail({ to, subject, html, cc }) {
  try {
    const mail = {
      from: process.env.SMTP_FROM || '"IACMS Platform" <noreply@iacms.gov>',
      to,
      subject,
      html,
    };
    if (cc) mail.cc = cc;
    const info = await getTransporter().sendMail(mail);
    logger.info('Email sent', { to, subject, messageId: info.messageId });
    return true;
  } catch (error) {
    logger.error('Failed to send email', { to, subject, error: error.message });
    return false;
  }
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Send welcome email with temporary password to a newly created user.
 * Called by the admin createUser flow.
 */
export async function sendWelcomeEmail({ to, firstName, tenantName, temporaryPassword }) {
  return sendEmail({
    to,
    subject: `Welcome to IACMS — ${tenantName}`,
    html: welcomeEmailTemplate({ firstName, tenantName, email: to, temporaryPassword }),
  });
}

/**
 * Send password reset email with a one-time token link.
 */
export async function sendPasswordResetEmail({ to, firstName, resetToken, tenantCode }) {
  const resetUrl = `${process.env.APP_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}&tenant=${tenantCode}`;
  return sendEmail({
    to,
    subject: 'IACMS — Password Reset Request',
    html: passwordResetTemplate({ firstName, resetUrl }),
  });
}

/**
 * Send email verification link to a newly registered user.
 */
export async function sendVerificationEmail({ to, firstName, verificationToken, tenantCode }) {
  const verificationLink = `${process.env.APP_URL || 'http://localhost:5173'}/verify-email?token=${verificationToken}&tenant=${tenantCode}`;
  return sendEmail({
    to,
    subject: 'IACMS — Please Verify Your Email Address',
    html: emailVerificationTemplate({ firstName, verificationLink }),
  });
}

/**
 * Send confirmation email after password was changed successfully.
 */
export async function sendPasswordChangedEmail({ to, firstName }) {
  return sendEmail({
    to,
    subject: 'IACMS — Your Password Has Been Changed',
    html: passwordChangedTemplate({ firstName }),
  });
}

function clientCaseUrl(caseId) {
  const base = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/cases/${encodeURIComponent(caseId)}`;
}

export async function sendCaseCreatedEmail(payload) {
  const { to, cc, firstName, caseNumber, title, tenantCode, caseId } = payload;
  return sendEmail({
    to,
    cc,
    subject: `IACMS — Case ${caseNumber} created`,
    html: caseCreatedTemplate({
      firstName,
      caseNumber,
      title,
      tenantCode,
      caseUrl: clientCaseUrl(caseId),
    }),
  });
}

export async function sendCaseAssignedEmail(payload) {
  const { to, firstName, caseNumber, title, tenantCode, caseId } = payload;
  return sendEmail({
    to,
    subject: `IACMS — Assigned: ${caseNumber}`,
    html: caseAssignedTemplate({
      firstName,
      caseNumber,
      title,
      tenantCode,
      caseUrl: clientCaseUrl(caseId),
    }),
  });
}

export async function sendCaseUpdatedEmail(payload) {
  const { to, firstName, caseNumber, title, caseId } = payload;
  return sendEmail({
    to,
    subject: `IACMS — Case ${caseNumber} updated`,
    html: caseUpdatedTemplate({ firstName, caseNumber, title, caseUrl: clientCaseUrl(caseId) }),
  });
}

export async function sendWorkflowStateChangedEmail(payload) {
  const { to, firstName, caseNumber, title, fromState, toState, tenantCode, caseId } = payload;
  return sendEmail({
    to,
    subject: `IACMS — Case ${caseNumber}: ${fromState} → ${toState}`,
    html: workflowStateChangedTemplate({
      firstName,
      caseNumber,
      title,
      fromState,
      toState,
      tenantCode,
      caseUrl: clientCaseUrl(caseId),
    }),
  });
}

export async function sendReferralCreatedReferrerEmail(payload) {
  const { to, firstName, caseNumber, title, toTenantName, toTenantCode, caseId } = payload;
  return sendEmail({
    to,
    subject: `IACMS — Referral sent (${caseNumber})`,
    html: referralCreatedReferrerTemplate({
      firstName,
      caseNumber,
      title,
      toTenantName,
      toTenantCode,
      caseUrl: clientCaseUrl(caseId),
    }),
  });
}

export async function sendReferralCreatedPartnerEmail(payload) {
  const { to, firstName, caseNumber, title, fromTenantCode, reason, caseId } = payload;
  return sendEmail({
    to,
    subject: `IACMS — New referral: ${caseNumber}`,
    html: referralCreatedPartnerTemplate({
      firstName,
      caseNumber,
      title,
      fromTenantCode,
      reason,
      caseUrl: clientCaseUrl(caseId),
    }),
  });
}

export async function sendReferralAcceptedEmail(payload) {
  const { to, firstName, caseNumber, toTenantCode, caseId, perspective } = payload;
  return sendEmail({
    to,
    subject: `IACMS — Referral accepted (${caseNumber})`,
    html: referralAcceptedTemplate({
      firstName,
      caseNumber,
      toTenantCode,
      caseUrl: clientCaseUrl(caseId),
      perspective,
    }),
  });
}

export async function sendReferralRejectedEmail(payload) {
  const { to, firstName, caseNumber, toTenantCode, caseId, perspective } = payload;
  return sendEmail({
    to,
    subject: `IACMS — Referral declined (${caseNumber})`,
    html: referralRejectedTemplate({
      firstName,
      caseNumber,
      toTenantCode,
      caseUrl: clientCaseUrl(caseId),
      perspective,
    }),
  });
}
