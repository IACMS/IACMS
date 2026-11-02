/**
 * social.controller.js
 * Handles HTTP requests for social/federated identity flows:
 *  - GET /auth/social/:provider           → initiate OAuth redirect
 *  - GET /auth/social/:provider/callback  → handle IdP callback & token/session bridge
 *  - POST /auth/social/:provider/callback → support POST-based callbacks
 *  - POST /auth/social/:provider/link     → initiate authenticated account linking
 *  - DELETE /auth/social/:provider        → unlink a provider
 *  - GET /auth/social/identities          → list user's linked social identities
 */

import providerInstance from '../oidc.config.js';
import {
  buildAuthorizationUrl,
  exchangeCodeAndFetchProfile,
  processSocialLogin,
  verifySocialState,
  unlinkSocialProvider,
  listUserIdentities,
  getActiveProviders,
} from './social.service.js';
import { generateTokens } from '../../utils/auth.helpers.js';
import { ValidationError, UnauthorizedError } from '../../../../../shared/common/errors.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('iam-social-controller');

function getBaseCallbackUrl(req, providerName) {
  const issuer = process.env.OIDC_ISSUER || `${req.protocol}://${req.get('host')}`;
  return `${issuer.replace(/\/$/, '')}/auth/social/${providerName.toLowerCase()}/callback`;
}

// ── GET /auth/social/:provider ───────────────────────────────────────────────

export async function initiateAuth(req, res, next) {
  try {
    const { provider } = req.params;
    const { interaction, tenant_code, redirect_uri, action } = req.query;

    const allowed = ['google', 'microsoft', 'github'];
    if (!allowed.includes(provider.toLowerCase())) {
      throw new ValidationError(`Unsupported social provider "${provider}". Allowed: ${allowed.join(', ')}`);
    }

    const callbackUrl = getBaseCallbackUrl(req, provider);

    const statePayload = {
      provider: provider.toLowerCase(),
      interactionUid: interaction || null,
      tenantCode: tenant_code || null,
      clientRedirectUri: redirect_uri || null,
      action: action === 'link' ? 'link' : 'login',
      userId: action === 'link' ? (req.user?.id || req.headers['x-user-id'] || null) : null,
    };

    if (action === 'link' && !statePayload.userId) {
      throw new UnauthorizedError('User authentication required to link social provider');
    }

    const authUrl = await buildAuthorizationUrl(provider, {
      statePayload,
      redirectUri: callbackUrl,
    });

    // Check if client expects JSON (e.g. mobile apps / SPAs)
    if (req.accepts('json') && !req.accepts('html')) {
      return res.json({ redirectUrl: authUrl });
    }

    return res.redirect(authUrl);
  } catch (err) {
    next(err);
  }
}

// ── GET / POST /auth/social/:provider/callback ──────────────────────────────

export async function handleCallback(req, res, next) {
  try {
    const { provider } = req.params;
    const data = req.method === 'POST' ? req.body : req.query;
    const { code, state, error, error_description } = data || {};

    if (error) {
      logger.warn('Upstream social provider returned error', { provider, error, error_description });
      throw new UnauthorizedError(`Authentication failed with ${provider}: ${error_description || error}`);
    }

    if (!code) {
      throw new ValidationError('Authorization code missing from provider callback');
    }

    // 1. Verify state signature & unpack
    const statePayload = verifySocialState(state);
    if (statePayload.provider !== provider.toLowerCase()) {
      throw new ValidationError('Provider mismatch in callback state');
    }

    const callbackUrl = getBaseCallbackUrl(req, provider);

    // 2. Exchange code with upstream IdP and retrieve verified profile
    const profile = await exchangeCodeAndFetchProfile(provider, {
      code,
      redirectUri: callbackUrl,
      tenantId: statePayload.tenantId || null,
    });

    // 3. Process social login / JIT provisioning / account linking
    const { user, isNew, linked } = await processSocialLogin({
      profile,
      state: statePayload,
    });

    // ── Route Result based on Flow Context ───────────────────────────────────

    // Context A: Initiated from OIDC interaction screen (/oauth/interaction/:uid)
    if (statePayload.interactionUid) {
      logger.info('Completing OIDC interaction via social login', {
        userId: user.id,
        interactionUid: statePayload.interactionUid,
        provider,
      });

      // Resume OIDC interaction by logging in the user
      const result = { login: { accountId: user.id } };
      return await providerInstance.interactionFinished(req, res, result, {
        mergeWithLastSubmission: false,
      });
    }

    // Context B: Account linking completed
    if (linked) {
      if (statePayload.clientRedirectUri) {
        const dest = new URL(statePayload.clientRedirectUri);
        dest.searchParams.set('linked', provider);
        return res.redirect(dest.toString());
      }
      return res.json({
        message: `${provider} account successfully linked`,
        provider,
        userId: user.id,
      });
    }

    // Context C: Direct API / SPA Social Login
    const roleIds = user.userRoles ? user.userRoles.map((ur) => ur.roleId) : [];
    const { accessToken, refreshToken } = generateTokens(user, roleIds);

    if (statePayload.clientRedirectUri) {
      const dest = new URL(statePayload.clientRedirectUri);
      dest.searchParams.set('access_token', accessToken);
      dest.searchParams.set('refresh_token', refreshToken);
      dest.searchParams.set('token_type', 'Bearer');
      return res.redirect(dest.toString());
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: roleIds,
        tenant: {
          id: user.tenant.id,
          name: user.tenant.name,
          code: user.tenant.code,
        },
      },
      accessToken,
      refreshToken,
      isNewUser: !!isNew,
    });
  } catch (err) {
    const wantsHtml = typeof req.accepts === 'function' && req.accepts(['html', 'json']) === 'html';
    if (wantsHtml) {
      return res.status(err.statusCode || err.status || 400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Authentication Error - IACMS</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; border: 1px solid #334155; padding: 2rem; border-radius: 1rem; max-width: 440px; text-align: center; }
            .btn { display: inline-block; background: #4f46e5; color: white; padding: 0.75rem 1.25rem; border-radius: 0.5rem; text-decoration: none; margin-top: 1.5rem; }
            h2 { color: #fca5a5; margin-bottom: 0.5rem; }
            p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Authentication Failed</h2>
            <p>${err.message || 'An error occurred during social authentication.'}</p>
            <a href="/" class="btn">Return to Sign In</a>
          </div>
        </body>
        </html>
      `);
    }
    next(err);
  }
}

// ── POST /auth/social/:provider/link ─────────────────────────────────────────

export async function linkProvider(req, res, next) {
  try {
    const { provider } = req.params;
    const userId = req.user?.id || req.headers['x-user-id'];

    if (!userId) throw new UnauthorizedError('Authentication required');

    const callbackUrl = getBaseCallbackUrl(req, provider);

    const statePayload = {
      provider: provider.toLowerCase(),
      action: 'link',
      userId,
      tenantId: req.user?.tenantId || req.headers['x-tenant-id'] || null,
      clientRedirectUri: req.body?.redirect_uri || null,
    };

    const authUrl = await buildAuthorizationUrl(provider, {
      statePayload,
      redirectUri: callbackUrl,
    });

    res.json({ redirectUrl: authUrl });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /auth/social/:provider ────────────────────────────────────────────

export async function unlinkProvider(req, res, next) {
  try {
    const { provider } = req.params;
    const userId = req.user?.id || req.headers['x-user-id'];

    if (!userId) throw new UnauthorizedError('Authentication required');

    const result = await unlinkSocialProvider(userId, provider);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ── GET /auth/social/identities ──────────────────────────────────────────────

export async function getLinkedProviders(req, res, next) {
  try {
    const userId = req.user?.id || req.headers['x-user-id'];
    if (!userId) throw new UnauthorizedError('Authentication required');

    const identities = await listUserIdentities(userId);
    res.json({ identities });
  } catch (err) {
    next(err);
  }
}

// ── GET /auth/social/providers ───────────────────────────────────────────────

export async function getAvailableProviders(req, res, next) {
  try {
    const tenantId = req.query.tenantId || req.headers['x-tenant-id'] || null;
    const providers = await getActiveProviders(tenantId);
    res.json({ providers });
  } catch (err) {
    next(err);
  }
}
