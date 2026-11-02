/**
 * interaction.views.js
 * Lightweight, zero-dependency HTML templates for the OIDC interaction screens.
 * Designed with modern aesthetic, responsive card layout, and accessible form controls.
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

const SCOPE_DESCRIPTIONS = {
  openid: 'Verify your identity (OpenID Connect)',
  profile: 'Access your basic profile information (name, department)',
  email: 'View your verified email address',
  roles: 'Access your system roles and authorizations',
  offline_access: 'Maintain access in the background (refresh tokens)',
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

function baseLayout(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - IACMS Identity</title>
  <style>
    :root {
      --primary: #4f46e5;
      --primary-hover: #4338ca;
      --bg: #0f172a;
      --card-bg: #1e293b;
      --card-border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --danger-bg: #451a1a;
      --danger-border: #7f1d1d;
      --danger-text: #fca5a5;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
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
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      width: 100%;
      max-width: 440px;
      padding: 2.25rem;
    }
    .auth-header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .auth-badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 0.35rem 0.75rem;
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
      background: #0f172a;
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
      background: #334155;
      color: var(--text);
      margin-top: 0.75rem;
    }
    .btn-secondary:hover {
      background: #475569;
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
      background: #0f172a;
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      color: var(--text);
      font-size: 0.875rem;
      font-weight: 500;
      text-decoration: none;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .social-btn:hover {
      background: #1e293b;
      border-color: #64748b;
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
      background: rgba(15, 23, 42, 0.5);
    }
    .scope-item:last-child {
      border-bottom: none;
    }
    .scope-name {
      font-weight: 600;
      font-size: 0.875rem;
      color: #a5b4fc;
    }
    .scope-desc {
      font-size: 0.8125rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .auth-footer {
      text-align: center;
      margin-top: 1.75rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="auth-card">
    ${content}
    <div class="auth-footer">
      Secured by IACMS OpenID Connect Authorization Server
    </div>
  </div>
</body>
</html>`;
}

export function renderLoginForm({ uid, client, loginHint, error, providers = ['google', 'microsoft', 'github'] }) {
  const clientName = client?.client_name || client?.client_id || 'Application';

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
      <div class="auth-badge">IACMS Auth</div>
      <h1 class="auth-title">Sign in</h1>
      <p class="auth-subtitle">to continue to <strong>${escapeHtml(clientName)}</strong></p>
    </div>

    ${error ? `<div class="alert-error">${escapeHtml(error)}</div>` : ''}

    <form method="POST" action="/oauth/interaction/${escapeHtml(uid)}/login">
      <div class="form-group">
        <label class="form-label" for="email">Email address</label>
        <input class="form-input" type="email" id="email" name="email" value="${escapeHtml(loginHint || '')}" required autofocus autocomplete="username" />
      </div>

      <div class="form-group">
        <label class="form-label" for="password">Password</label>
        <input class="form-input" type="password" id="password" name="password" required autocomplete="current-password" />
      </div>

      <button type="submit" class="btn btn-primary">Sign in with Email</button>
      <a href="/oauth/interaction/${escapeHtml(uid)}/abort" class="btn btn-secondary">Cancel</a>
    </form>

    ${socialButtonsHtml}
  `;
  return baseLayout('Sign in', content);
}

export function renderConsentForm({ uid, client, missingScopes, accountEmail }) {
  const clientName = client?.client_name || client?.client_id || 'Application';
  const scopesHtml = (missingScopes || [])
    .map(
      (scope) => `
      <li class="scope-item">
        <div class="scope-name">${escapeHtml(scope)}</div>
        <div class="scope-desc">${escapeHtml(SCOPE_DESCRIPTIONS[scope] || 'Access ' + scope + ' information')}</div>
      </li>
    `
    )
    .join('');

  const content = `
    <div class="auth-header">
      <div class="auth-badge">Permission Request</div>
      <h1 class="auth-title">Authorize Application</h1>
      <p class="auth-subtitle"><strong>${escapeHtml(clientName)}</strong> would like to access your account ${accountEmail ? `(<strong>${escapeHtml(accountEmail)}</strong>)` : ''}:</p>
    </div>

    <ul class="scope-list">
      ${scopesHtml}
    </ul>

    <form method="POST" action="/oauth/interaction/${escapeHtml(uid)}/confirm">
      <button type="submit" class="btn btn-primary">Authorize &amp; Continue</button>
      <a href="/oauth/interaction/${escapeHtml(uid)}/abort" class="btn btn-secondary">Decline</a>
    </form>
  `;
  return baseLayout('Authorize Application', content);
}
