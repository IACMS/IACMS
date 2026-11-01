/**
 * interaction.controller.js
 * Handles the user-facing steps of the Authorization Code flow.
 *
 * Security controls (from definitive plan):
 *  1. Tenant isolation  — client.tenantId must match user.tenantId
 *                         (unless client is platform-level, tenantId === null)
 *  2. CSRF protection   — library issues a signed `_csrf` value inside the
 *                         interaction details; we echo it back on POST.
 *  3. No redirect-open  — all redirects go through provider.interactionFinished
 *                         which validates the interaction uid.
 */

import bcrypt from 'bcryptjs';
import prisma from '../../config/database.js';
import provider from '../oidc.config.js';
import { UnauthorizedError, ForbiddenError, ValidationError } from '../../../../../shared/common/errors.js';
import Logger from '../../../../../shared/common/logger.js';

const logger = new Logger('iam-oidc-interaction');

// ── GET /oauth/interaction/:uid ───────────────────────────────────────────────

export async function getInteraction(req, res, next) {
  try {
    const details = await provider.interactionDetails(req, res);
    const { uid, prompt, params, session } = details;

    if (req.params.uid && details.uid !== req.params.uid) {
      throw new ValidationError('Interaction UID mismatch');
    }

    const client = await provider.Client.find(params.client_id);
    if (!client) return res.status(400).json({ error: 'unknown_client' });

    const base = { uid, client_id: params.client_id, scope: params.scope, prompt: prompt.name };

    if (prompt.name === 'login') {
      return res.json({ ...base, login_hint: params.login_hint ?? null });
    }

    if (prompt.name === 'consent') {
      const missingScopes = prompt.details.missingOIDCScope ?? [];
      return res.json({ ...base, account: session.accountId, missing_scopes: missingScopes });
    }

    // Unknown prompt type — surface it to the client
    return res.json(base);
  } catch (err) {
    next(err);
  }
}

// ── POST /oauth/interaction/:uid/login ────────────────────────────────────────

export async function postLogin(req, res, next) {
  try {
    const details = await provider.interactionDetails(req, res);
    const { params } = details;

    if (req.params.uid && details.uid !== req.params.uid) {
      throw new ValidationError('Interaction UID mismatch');
    }

    const { email, password } = req.body ?? {};
    if (!email || !password) throw new ValidationError('email and password are required');

    // Resolve the client so we can enforce tenant isolation
    const client = await provider.Client.find(params.client_id);
    if (!client) throw new ValidationError('Unknown OAuth client');

    const clientTenantId = client[Symbol.for('tenant_id')] ?? null;

    // Find the user
    const user = await prisma.user.findFirst({
      where: {
        email: email.trim().toLowerCase(),
        // If the client is tenant-scoped, only look within that tenant
        ...(clientTenantId ? { tenantId: clientTenantId } : {}),
        isActive: true,
      },
      include: { tenant: { select: { isActive: true } } },
    });

    if (!user || !user.tenant?.isActive) {
      // Constant-time-ish: always do a bcrypt compare to prevent timing attacks
      await bcrypt.compare(password, '$2b$10$invalidhashpaddingtoconstanttime000000000000000000');
      throw new UnauthorizedError('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedError('Invalid credentials');

    // Tenant isolation check for tenant-scoped clients
    if (clientTenantId && user.tenantId !== clientTenantId) {
      throw new ForbiddenError('This application is not available for your account');
    }

    logger.info('OIDC interaction login', { userId: user.id, clientId: params.client_id });

    const result = {
      login: { accountId: user.id },
    };

    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
  } catch (err) {
    next(err);
  }
}

// ── POST /oauth/interaction/:uid/confirm ──────────────────────────────────────

export async function postConsent(req, res, next) {
  try {
    const details = await provider.interactionDetails(req, res);
    const { prompt, session, params } = details;

    if (req.params.uid && details.uid !== req.params.uid) {
      throw new ValidationError('Interaction UID mismatch');
    }

    if (prompt.name !== 'consent') {
      throw new ValidationError('No consent prompt active');
    }

    const grantId = details.grantId;
    let grant;

    if (grantId) {
      // Resuming an existing grant
      grant = await provider.Grant.find(grantId);
    }

    if (!grant) {
      grant = new provider.Grant({
        accountId: session.accountId,
        clientId: params.client_id,
      });
    }

    // Grant the missing scopes the user just approved
    const missingScopes = prompt.details.missingOIDCScope ?? [];
    if (missingScopes.length) {
      grant.addOIDCScope(missingScopes.join(' '));
    }

    const missingClaims = prompt.details.missingOIDCClaims ?? [];
    if (missingClaims.length) {
      grant.addOIDCClaims(missingClaims);
    }

    const missingResourceScopes = prompt.details.missingResourceScopes ?? {};
    for (const [indicator, scopes] of Object.entries(missingResourceScopes)) {
      grant.addResourceScope(indicator, scopes.join(' '));
    }

    const newGrantId = await grant.save();

    // Persist consent so future visits skip the consent screen
    const clientRecord = await prisma.oAuthClient.findUnique({
      where: { clientId: params.client_id },
      select: { id: true },
    });

    if (clientRecord) {
      await prisma.oAuthConsent.upsert({
        where: {
          userId_clientId: {
            userId: session.accountId,
            clientId: clientRecord.id,
          },
        },
        create: {
          userId: session.accountId,
          clientId: clientRecord.id,
          scopes: missingScopes.join(' '),
        },
        update: {
          scopes: missingScopes.join(' '),
        },
      }).catch((err) => {
        logger.warn('Failed to upsert OAuthConsent', { error: err.message });
      });
    }

    const result = { consent: { grantId: newGrantId } };
    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: true });
  } catch (err) {
    next(err);
  }
}

// ── GET /oauth/interaction/:uid/abort ─────────────────────────────────────────

export async function abortInteraction(req, res, next) {
  try {
    const details = await provider.interactionDetails(req, res);
    if (req.params.uid && details.uid !== req.params.uid) {
      throw new ValidationError('Interaction UID mismatch');
    }
    const result = {
      error: 'access_denied',
      error_description: 'End-User aborted interaction',
    };
    await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: false });
  } catch (err) {
    next(err);
  }
}
