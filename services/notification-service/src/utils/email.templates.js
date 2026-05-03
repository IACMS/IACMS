/**
 * Email HTML Templates
 * Clean, professional templates for all transactional emails.
 */

const baseStyle = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #f4f6f9;
  margin: 0;
  padding: 0;
`;

const cardStyle = `
  max-width: 600px;
  margin: 40px auto;
  background: #ffffff;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
`;

const headerStyle = `
  background-color: #1a3c5e;
  padding: 32px 40px;
  text-align: center;
`;

const bodyStyle = `
  padding: 40px;
  color: #333333;
  line-height: 1.6;
`;

const footerStyle = `
  background-color: #f4f6f9;
  padding: 20px 40px;
  text-align: center;
  font-size: 12px;
  color: #888888;
`;

const buttonStyle = `
  display: inline-block;
  background-color: #1a3c5e;
  color: #ffffff !important;
  text-decoration: none;
  padding: 14px 32px;
  border-radius: 6px;
  font-size: 16px;
  font-weight: 600;
  margin: 24px 0;
`;

const codeBoxStyle = `
  background-color: #f4f6f9;
  border: 2px dashed #d0d7de;
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  margin: 24px 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 3px;
  color: #1a3c5e;
  font-family: 'Courier New', monospace;
`;

function layout(content) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="${baseStyle}">
      <div style="${cardStyle}">
        <div style="${headerStyle}">
          <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1px;">
            IACMS
          </h1>
          <p style="color: #a8c4e0; margin: 6px 0 0; font-size: 13px; letter-spacing: 2px; text-transform: uppercase;">
            Inter-Agency Case Management System
          </p>
        </div>
        <div style="${bodyStyle}">
          ${content}
        </div>
        <div style="${footerStyle}">
          <p>This is an automated message from IACMS. Please do not reply to this email.</p>
          <p>&copy; ${new Date().getFullYear()} IACMS Platform. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ─── Templates ────────────────────────────────────────────────────────────────

/**
 * Welcome email sent to new users created by an admin.
 * Contains their email, temporary password, and instructions.
 */
export function welcomeEmailTemplate({ firstName, tenantName, email, temporaryPassword }) {
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Welcome, ${firstName}!</h2>
    <p>
      Your account has been created on the <strong>${tenantName}</strong> workspace
      in the Inter-Agency Case Management System.
    </p>
    <p>Here are your login credentials:</p>

    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr>
        <td style="padding: 8px 12px; background: #f4f6f9; border-radius: 4px 0 0 0; font-weight: 600; color: #555; width: 120px;">Email</td>
        <td style="padding: 8px 12px; background: #f4f6f9; border-radius: 0 4px 0 0; color: #333;">${email}</td>
      </tr>
      <tr>
        <td style="padding: 8px 12px; border-top: 2px solid #fff; background: #f4f6f9; border-radius: 0 0 0 4px; font-weight: 600; color: #555;">Password</td>
        <td style="padding: 8px 12px; border-top: 2px solid #fff; background: #f4f6f9; border-radius: 0 0 4px 0;">
          <span style="${codeBoxStyle.replace('margin: 24px 0;', 'margin: 0;').replace('font-size: 24px;', 'font-size: 18px;').replace('letter-spacing: 3px;', 'letter-spacing: 2px;')}">
            ${temporaryPassword}
          </span>
        </td>
      </tr>
    </table>

    <div style="background: #fff8e1; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 0 6px 6px 0; margin: 24px 0;">
      <strong style="color: #92400e;">Important:</strong>
      <span style="color: #78350f;"> This is a temporary password. You will be required to change it when you log in for the first time.</span>
    </div>

    <p>
      Log in at:
      <a href="${process.env.APP_URL || 'http://localhost:5173'}" style="color: #1a3c5e; font-weight: 600;">
        ${process.env.APP_URL || 'http://localhost:5173'}
      </a>
    </p>

    <p style="color: #666; font-size: 14px;">
      If you did not expect this email, please contact your system administrator immediately.
    </p>
  `);
}

/**
 * Password reset email with a one-time link.
 * Link expires in 1 hour.
 */
export function passwordResetTemplate({ firstName, resetUrl }) {
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Password Reset Request</h2>
    <p>Hi ${firstName},</p>
    <p>
      We received a request to reset the password for your IACMS account.
      Click the button below to create a new password.
    </p>

    <div style="text-align: center;">
      <a href="${resetUrl}" style="${buttonStyle}">Reset My Password</a>
    </div>

    <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 0 6px 6px 0; margin: 24px 0;">
      <strong style="color: #991b1b;">This link expires in 1 hour.</strong>
    </div>

    <p>
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="word-break: break-all; background: #f4f6f9; padding: 12px; border-radius: 4px; font-size: 13px; color: #555;">
      ${resetUrl}
    </p>

    <p style="color: #666; font-size: 14px;">
      If you did not request a password reset, you can safely ignore this email.
      Your password will not be changed.
    </p>
  `);
}

/**
 * Email verification email with a one-time link.
 * Link expires in 24 hours.
 */
export function emailVerificationTemplate({ firstName, verificationLink }) {
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Verify Your Email Address</h2>
    <p>Hi ${firstName},</p>
    <p>
      Thank you for registering with IACMS. Please verify your email address
      by clicking the button below to activate your account.
    </p>

    <div style="text-align: center;">
      <a href="${verificationLink}" style="${buttonStyle}">Verify Email Address</a>
    </div>

    <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 0 6px 6px 0; margin: 24px 0;">
      <strong style="color: #1e40af;">This link expires in 24 hours.</strong>
    </div>

    <p>
      If the button doesn't work, copy and paste this link into your browser:
    </p>
    <p style="word-break: break-all; background: #f4f6f9; padding: 12px; border-radius: 4px; font-size: 13px; color: #555;">
      ${verificationLink}
    </p>

    <p style="color: #666; font-size: 14px;">
      If you did not create an account, you can safely ignore this email.
    </p>
  `);
}

/**
 * Confirmation email after a password change.
 */
export function passwordChangedTemplate({ firstName }) {
  const time = new Date().toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Password Changed Successfully</h2>
    <p>Hi ${firstName},</p>
    <p>
      Your IACMS account password was changed successfully on <strong>${time}</strong>.
    </p>

    <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; border-radius: 0 6px 6px 0; margin: 24px 0;">
      <strong style="color: #166534;">Your account is secure.</strong>
    </div>

    <p style="color: #666; font-size: 14px;">
      If you did not make this change, contact your system administrator immediately or use
      the <strong>Forgot Password</strong> option to regain access.
    </p>
  `);
}

function escapeHtml(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function caseCreatedTemplate({ firstName, caseNumber, title, tenantCode, caseUrl }) {
  const fn = escapeHtml(firstName || 'there');
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Case created</h2>
    <p>Hi ${fn},</p>
    <p>A new case has been created${tenantCode ? ` for tenant <strong>${escapeHtml(tenantCode)}</strong>` : ''}.</p>
    <p><strong>${escapeHtml(caseNumber)}</strong> — ${escapeHtml(title)}</p>
    <div style="text-align: center;">
      <a href="${caseUrl}" style="${buttonStyle}">Open case</a>
    </div>
  `);
}

export function caseAssignedTemplate({ firstName, caseNumber, title, tenantCode, caseUrl }) {
  const fn = escapeHtml(firstName || 'there');
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Case assigned to you</h2>
    <p>Hi ${fn},</p>
    <p>You have been assigned a case${tenantCode ? ` (${escapeHtml(tenantCode)})` : ''}.</p>
    <p><strong>${escapeHtml(caseNumber)}</strong> — ${escapeHtml(title)}</p>
    <div style="text-align: center;">
      <a href="${caseUrl}" style="${buttonStyle}">View case</a>
    </div>
  `);
}

export function caseUpdatedTemplate({ firstName, caseNumber, title, caseUrl }) {
  const fn = escapeHtml(firstName || 'there');
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Case updated</h2>
    <p>Hi ${fn},</p>
    <p>A case you are involved with was updated.</p>
    <p><strong>${escapeHtml(caseNumber)}</strong> — ${escapeHtml(title)}</p>
    <div style="text-align: center;">
      <a href="${caseUrl}" style="${buttonStyle}">Open case</a>
    </div>
  `);
}

export function workflowStateChangedTemplate({
  firstName,
  caseNumber,
  title,
  fromState,
  toState,
  tenantCode,
  caseUrl,
}) {
  const fn = escapeHtml(firstName || 'there');
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Workflow transition</h2>
    <p>Hi ${fn},</p>
    <p>
      Case <strong>${escapeHtml(caseNumber)}</strong> — ${escapeHtml(title)}${tenantCode ? ` (${escapeHtml(tenantCode)})` : ''}
      moved from <strong>${escapeHtml(fromState)}</strong> to <strong>${escapeHtml(toState)}</strong>.
    </p>
    <div style="text-align: center;">
      <a href="${caseUrl}" style="${buttonStyle}">Open case</a>
    </div>
  `);
}

export function referralCreatedReferrerTemplate({
  firstName,
  caseNumber,
  title,
  toTenantName,
  toTenantCode,
  caseUrl,
}) {
  const fn = escapeHtml(firstName || 'there');
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Referral sent</h2>
    <p>Hi ${fn},</p>
    <p>
      Your referral for case <strong>${escapeHtml(caseNumber)}</strong> — ${escapeHtml(title)} was submitted
      to <strong>${escapeHtml(toTenantName || toTenantCode || 'partner agency')}</strong>.
    </p>
    <div style="text-align: center;">
      <a href="${caseUrl}" style="${buttonStyle}">Open case</a>
    </div>
  `);
}

export function referralCreatedPartnerTemplate({
  firstName,
  caseNumber,
  title,
  fromTenantCode,
  reason,
  caseUrl,
}) {
  const fn = escapeHtml(firstName || 'there');
  const reasonHtml = reason ? `<p>Reason:</p><p style="background:#f4f6f9;padding:12px;border-radius:6px;">${escapeHtml(reason)}</p>` : '';
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">New case referral</h2>
    <p>Hi ${fn},</p>
    <p>
      <strong>${escapeHtml(fromTenantCode || 'Another agency')}</strong> referred a case to your organization.
    </p>
    <p><strong>${escapeHtml(caseNumber)}</strong> — ${escapeHtml(title)}</p>
    ${reasonHtml}
    <div style="text-align: center;">
      <a href="${caseUrl}" style="${buttonStyle}">Open case</a>
    </div>
  `);
}

export function referralAcceptedTemplate({ firstName, caseNumber, toTenantCode, caseUrl, perspective }) {
  const fn = escapeHtml(firstName || 'there');
  const partner = escapeHtml(toTenantCode || 'partner');
  const cn = escapeHtml(caseNumber);
  const body =
    perspective === 'accepter'
      ? `<p>You accepted the referral for case <strong>${cn}</strong>.</p>`
      : `<p>Case <strong>${cn}</strong> was accepted by <strong>${partner}</strong>.</p>`;
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Referral accepted</h2>
    <p>Hi ${fn},</p>
    ${body}
    <div style="text-align: center;">
      <a href="${caseUrl}" style="${buttonStyle}">Open case</a>
    </div>
  `);
}

export function referralRejectedTemplate({ firstName, caseNumber, toTenantCode, caseUrl, perspective }) {
  const fn = escapeHtml(firstName || 'there');
  const partner = escapeHtml(toTenantCode || 'partner');
  const cn = escapeHtml(caseNumber);
  const body =
    perspective === 'rejecter'
      ? `<p>You declined the referral for case <strong>${cn}</strong>.</p>`
      : `<p>Case <strong>${cn}</strong> referral was not accepted by <strong>${partner}</strong>.</p>`;
  return layout(`
    <h2 style="color: #1a3c5e; margin-top: 0;">Referral declined</h2>
    <p>Hi ${fn},</p>
    ${body}
    <div style="text-align: center;">
      <a href="${caseUrl}" style="${buttonStyle}">Open case</a>
    </div>
  `);
}
