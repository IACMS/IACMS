/**
 * interaction.views.js
 * Zero-dependency, accessible, responsive HTML templates for OIDC interaction screens.
 * Designed to Auth0 Universal Login / Clerk visual standards.
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SCOPE_META = {
  openid: {
    label: 'Verify your identity',
    description: 'Confirms your account subject identifier with OpenID Connect',
    warning: false,
  },
  profile: {
    label: 'View your profile info',
    description: 'Name, username, and basic display details',
    warning: false,
  },
  email: {
    label: 'View your email address',
    description: 'Access your verified primary email address',
    warning: false,
  },
  roles: {
    label: 'See your roles in this app',
    description: 'Authorizations and access permissions scoped to this application',
    warning: false,
  },
  offline_access: {
    label: 'Stay signed in',
    description: 'Maintain access in the background without prompting you to log in repeatedly',
    warning: false,
  },
  'iam:admin': {
    label: 'IAM Administrator Access',
    description: 'Full administrative rights to configure identity systems, clients, roles, and organizations',
    warning: true,
  },
  'cases:read': {
    label: 'Read case records',
    description: 'View case dossiers, tasks, and historical notes',
    warning: false,
  },
  'cases:create': {
    label: 'Create new cases',
    description: 'Initiate new case workflows and register incidents',
    warning: false,
  },
  'cases:update': {
    label: 'Modify cases',
    description: 'Update case status, assignees, and execute workflow transitions',
    warning: false,
  },
  'files:upload': {
    label: 'Upload files and evidence',
    description: 'Attach documents and media to case files',
    warning: false,
  },
};

const SOCIAL_ICONS = {
  google: `<svg class="social-icon" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>`,
  microsoft: `<svg class="social-icon" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>`,
  github: `<svg class="social-icon" fill="currentColor" viewBox="0 0 24 24"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>`,
};

const SOCIAL_LABELS = {
  google: 'Sign in with Google',
  microsoft: 'Sign in with Microsoft',
  github: 'Sign in with GitHub',
};

function baseLayout(title, content, client = null) {
  const accentColor = client?.logo_color || '#4f46e5';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - IACMS Central Identity</title>
  <style>
    :root {
      --primary: ${escapeHtml(accentColor)};
      --primary-hover: #4338ca;
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --danger-bg: #451a1a;
      --danger-border: #7f1d1d;
      --danger-text: #fca5a5;
      --warning-bg: #422006;
      --warning-border: #854d0e;
      --warning-text: #fef08a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: radial-gradient(circle at 50% 0%, #1e1b4b 0%, var(--bg) 70%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .auth-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      width: 100%;
      max-width: 440px;
      padding: 2.25rem;
    }
    .auth-header {
      text-align: center;
      margin-bottom: 1.75rem;
    }
    .auth-logo {
      width: 48px;
      height: 48px;
      margin: 0 auto 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(79, 70, 229, 0.15);
      border: 1px solid rgba(79, 70, 229, 0.3);
      border-radius: 0.75rem;
      color: #818cf8;
    }
    .auth-badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 0.3rem 0.75rem;
      border-radius: 9999px;
      background: rgba(79, 70, 229, 0.15);
      color: #818cf8;
      margin-bottom: 0.75rem;
    }
    .auth-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -0.025em;
    }
    .auth-subtitle {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
      line-height: 1.4;
    }
    .alert-error {
      background: var(--danger-bg);
      border: 1px solid var(--danger-border);
      color: var(--danger-text);
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.875rem;
      margin-bottom: 1.25rem;
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    .form-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--text);
      margin-bottom: 0.5rem;
    }
    .form-input {
      width: 100%;
      padding: 0.75rem 1rem;
      background: #0b0f19;
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      color: var(--text);
      font-size: 0.9375rem;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .form-input:focus {
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.25);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 0.75rem 1.25rem;
      font-size: 0.9375rem;
      font-weight: 600;
      border-radius: 0.5rem;
      border: none;
      cursor: pointer;
      transition: background-color 0.15s ease, transform 0.05s ease;
      text-decoration: none;
    }
    .btn-primary {
      background: var(--primary);
      color: #ffffff;
    }
    .btn-primary:hover {
      background: var(--primary-hover);
    }
    .btn-primary:active {
      transform: scale(0.99);
    }
    .btn-secondary {
      background: #1f2937;
      color: var(--text);
      margin-top: 0.75rem;
      border: 1px solid #374151;
    }
    .btn-secondary:hover {
      background: #374151;
    }
    .divider {
      display: flex;
      align-items: center;
      text-align: center;
      margin: 1.5rem 0;
      color: var(--text-muted);
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid var(--card-border);
    }
    .divider span {
      padding: 0 0.75rem;
    }
    .social-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      width: 100%;
      padding: 0.75rem 1rem;
      margin-bottom: 0.75rem;
      background: #0b0f19;
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      color: var(--text);
      font-size: 0.875rem;
      font-weight: 500;
      text-decoration: none;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .social-btn:hover {
      background: #1f2937;
      border-color: #4b5563;
    }
    .social-icon {
      width: 1.25rem;
      height: 1.25rem;
      flex-shrink: 0;
    }
    .scope-list {
      list-style: none;
      margin: 1.25rem 0;
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      overflow: hidden;
    }
    .scope-item {
      padding: 0.875rem 1rem;
      border-bottom: 1px solid var(--card-border);
      background: rgba(11, 15, 25, 0.6);
    }
    .scope-item:last-child {
      border-bottom: none;
    }
    .scope-item.scope-warning {
      background: rgba(66, 32, 6, 0.4);
      border-left: 3px solid #eab308;
    }
    .scope-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .scope-name {
      font-weight: 600;
      font-size: 0.875rem;
      color: #93c5fd;
    }
    .scope-badge-warn {
      font-size: 0.6875rem;
      padding: 0.2rem 0.5rem;
      border-radius: 9999px;
      background: var(--warning-bg);
      border: 1px solid var(--warning-border);
      color: var(--warning-text);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .scope-desc {
      font-size: 0.8125rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
      line-height: 1.35;
    }
    .auth-footer {
      text-align: center;
      margin-top: 1.75rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .auth-footer a {
      color: #818cf8;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="auth-card">
    ${content}
    <div class="auth-footer">
      Secured by <strong>IACMS Central IAM</strong> &bull; OpenID Connect
    </div>
  </div>
</body>
</html>`;
}

export function renderLoginForm({ uid, client, loginHint, error, providers = ['google', 'microsoft', 'github'] }) {
  const clientName = client?.client_name || client?.client_id || 'IACMS Application';

  const socialButtonsHtml = Array.isArray(providers) && providers.length > 0
    ? `
      <div class="divider"><span>OR CONTINUE WITH</span></div>
      <div class="social-container">
        ${providers
          .map((p) => {
            const key = p.toLowerCase();
            const icon = SOCIAL_ICONS[key] || '';
            const label = SOCIAL_LABELS[key] || `Sign in with ${p}`;
            return `
              <a href="/auth/social/${escapeHtml(key)}?interaction=${escapeHtml(uid)}" class="social-btn">
                ${icon}
                <span>${escapeHtml(label)}</span>
              </a>
            `;
          })
          .join('')}
      </div>
    `
    : '';

  const content = `
    <div class="auth-header">
      <div class="auth-logo">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>
          <path d="M12 11v6"/>
          <path d="M12 8h.01"/>
        </svg>
      </div>
      <div class="auth-badge">Single Sign-On</div>
      <h1 class="auth-title">Sign in</h1>
      <p class="auth-subtitle">to continue to <strong>${escapeHtml(clientName)}</strong></p>
    </div>

    ${error ? `<div class="alert-error" role="alert">${escapeHtml(error)}</div>` : ''}

    <form method="POST" action="/oauth/interaction/${escapeHtml(uid)}/login">
      <div class="form-group">
        <label class="form-label" for="email">Username or Email</label>
        <input class="form-input" type="text" id="email" name="email" value="${escapeHtml(loginHint || '')}" required autofocus autocomplete="username" placeholder="name@agency.gov" />
      </div>

      <div class="form-group">
        <label class="form-label" for="password">Password</label>
        <input class="form-input" type="password" id="password" name="password" required autocomplete="current-password" placeholder="••••••••••••" />
      </div>

      <button type="submit" class="btn btn-primary">Sign In</button>
      <a href="/oauth/interaction/${escapeHtml(uid)}/abort" class="btn btn-secondary">Cancel</a>
    </form>

    ${socialButtonsHtml}
  `;
  return baseLayout('Sign in', content, client);
}

export function renderConsentForm({ uid, client, missingScopes, accountEmail }) {
  const clientName = client?.client_name || client?.client_id || 'Application';
  const scopesHtml = (missingScopes || [])
    .map((scope) => {
      const meta = SCOPE_META[scope] || {
        label: `Access ${scope}`,
        description: `Permissions for ${scope}`,
        warning: scope === 'iam:admin',
      };
      return `
        <li class="scope-item ${meta.warning ? 'scope-warning' : ''}">
          <div class="scope-header-row">
            <span class="scope-name">${escapeHtml(meta.label)}</span>
            ${meta.warning ? '<span class="scope-badge-warn">High Privilege</span>' : ''}
          </div>
          <div class="scope-desc">${escapeHtml(meta.description)} <span style="font-family: monospace; font-size: 0.75rem; opacity: 0.7;">(${escapeHtml(scope)})</span></div>
        </li>
      `;
    })
    .join('');

  const content = `
    <div class="auth-header">
      <div class="auth-badge">Scope Authorization</div>
      <h1 class="auth-title">Authorize Application</h1>
      <p class="auth-subtitle">
        <strong>${escapeHtml(clientName)}</strong> would like to access your account 
        ${accountEmail ? `(<strong>${escapeHtml(accountEmail)}</strong>)` : ''}:
      </p>
    </div>

    <ul class="scope-list">
      ${scopesHtml}
    </ul>

    <form method="POST" action="/oauth/interaction/${escapeHtml(uid)}/confirm">
      <button type="submit" class="btn btn-primary">Allow Access</button>
      <a href="/oauth/interaction/${escapeHtml(uid)}/abort" class="btn btn-secondary">Deny</a>
    </form>
  `;
  return baseLayout('Authorize Access', content, client);
}

export function renderNotMemberForm({ uid, client, organizationName, userEmail }) {
  const clientName = client?.client_name || client?.client_id || 'Application';
  const orgTitle = organizationName || 'the required organization';

  const content = `
    <div class="auth-header">
      <div class="auth-badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">Access Restricted</div>
      <h1 class="auth-title">Not an Organization Member</h1>
      <p class="auth-subtitle">
        Your account ${userEmail ? `(<strong>${escapeHtml(userEmail)}</strong>)` : ''} does not have an active membership in <strong>${escapeHtml(orgTitle)}</strong>.
      </p>
    </div>

    <div class="alert-error" style="background: rgba(30, 41, 59, 0.8); border-color: #334155; color: #cbd5e1; margin-bottom: 1.5rem;">
      <strong>${escapeHtml(clientName)}</strong> is restricted to members of <strong>${escapeHtml(orgTitle)}</strong>. Please contact your organization administrator to request an access invitation.
    </div>

    <a href="/oauth/interaction/${escapeHtml(uid)}" class="btn btn-primary">Sign in with different account</a>
    <a href="/oauth/interaction/${escapeHtml(uid)}/abort" class="btn btn-secondary">Return to Application</a>
  `;
  return baseLayout('Membership Required', content, client);
}

export function renderErrorForm({ title, message, errorDetails, clientName }) {
  const content = `
    <div class="auth-header">
      <div class="auth-badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">OIDC Error</div>
      <h1 class="auth-title">${escapeHtml(title || 'Authorization Error')}</h1>
      <p class="auth-subtitle">${escapeHtml(message || 'An error occurred during authentication.')}</p>
    </div>

    ${errorDetails ? `<div class="alert-error">${escapeHtml(errorDetails)}</div>` : ''}

    <p style="font-size: 0.8125rem; color: var(--text-muted); text-align: center; margin-bottom: 1.5rem;">
      For security reasons, unvalidated redirect requests cannot be followed. Please notify the administrator of ${escapeHtml(clientName || 'this application')}.
    </p>

    <button onclick="window.history.back()" class="btn btn-secondary">Go Back</button>
  `;
  return baseLayout(title || 'Error', content);
}
