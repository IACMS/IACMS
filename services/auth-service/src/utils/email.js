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
async function sendEmail({ to, subject, html }) {
  try {
    const info = await getTransporter().sendMail({
      from: process.env.SMTP_FROM || '"IACMS Platform" <noreply@iacms.gov>',
      to,
      subject,
      html,
    });
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
 * Send confirmation email after password was changed successfully.
 */
export async function sendPasswordChangedEmail({ to, firstName }) {
  return sendEmail({
    to,
    subject: 'IACMS — Your Password Has Been Changed',
    html: passwordChangedTemplate({ firstName }),
  });
}
