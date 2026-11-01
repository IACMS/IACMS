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

export function renderLoginForm({ uid, client, loginHint, error }) {
  const clientName = client?.client_name || client?.client_id || 'Application';
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

      <button type="submit" class="btn btn-primary">Sign in</button>
      <a href="/oauth/interaction/${escapeHtml(uid)}/abort" class="btn btn-secondary">Cancel</a>
    </form>
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
