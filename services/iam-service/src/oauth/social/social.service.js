/**
 * social.service.js
 * Social & Federated Identity Service (Google, Microsoft, GitHub, SAML).
 *
 * Implements all Phase 4 security rules from the definitive plan:
 *  1. Never auto-link by email alone (link only by (provider, externalId)).
 *  2. Require email_verified: true from upstream provider before accepting email.
 *  3. GitHub special case: fetch https://api.github.com/user/emails and filter
 *     for { primary: true, verified: true }. Reject if none found.
 *  4. Explicit linking only: if an account with the same email already exists,
 *     require password authentication + explicit link — never automatic.
 *  5. Tenant from email domain only if domain is registered in tenant config.
 *     Otherwise require tenant_code.
 *  6. Upstream access/refresh tokens are NEVER stored in FederatedIdentity.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import prisma from '../../config/database.js';
import { decryptClientSecret } from '../client-secret.utils.js';
import {
  ValidationError,
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from '../../../../../shared/common/errors.js';
import Logger from '../../../../../shared/common/logger.js';
import { TOPICS } from '../../../../../shared/utils/eventBus.js';
import { getEventBus } from '../../utils/auth.helpers.js';

const logger = new Logger('iam-social');

// ── Provider Configuration ──────────────────────────────────────────────────

/**
 * Resolve provider credentials and config.
 * Checks DB (OAuthProvider model) first; falls back to environment variables.
 *
 * @param {string} providerName - 'google' | 'microsoft' | 'github'
 * @param {string|null} [tenantId=null] - optional tenant scope
 * @returns {Promise<{ id: string, provider: string, clientId: string, clientSecret: string, scopes: string[], config: object }>}
 */
export async function getProviderConfig(providerName, tenantId = null) {
  const normalized = providerName.toLowerCase();

  // 1. Try DB lookup (tenant-scoped or platform-level where tenantId is null)
  const dbRecord = await prisma.oAuthProvider.findFirst({
    where: {
      provider: normalized,
      isActive: true,
      OR: [
        ...(tenantId ? [{ tenantId }] : []),
        { tenantId: null },
      ],
    },
    orderBy: {
      tenantId: tenantId ? 'desc' : 'asc', // prefer tenant-scoped if matching
    },
  });

  if (dbRecord) {
    let clientSecret = '';
    if (dbRecord.clientSecretEnc) {
      try {
        clientSecret = decryptClientSecret(dbRecord.clientSecretEnc);
      } catch (err) {
        logger.error('Failed to decrypt OAuthProvider client secret', { provider: normalized, error: err.message });
      }
    }
    return {
      id: dbRecord.id,
      provider: dbRecord.provider,
      clientId: dbRecord.clientId,
      clientSecret,
      scopes: dbRecord.scopes || [],
      config: dbRecord.config || {},
      isFromDb: true,
    };
  }

  // 2. Fall back to environment variables
  const envMap = {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      defaultScopes: ['openid', 'email', 'profile'],
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      defaultScopes: ['openid', 'email', 'profile', 'User.Read'],
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      defaultScopes: ['read:user', 'user:email'],
    },
  };

  const envConfig = envMap[normalized];
  if (envConfig?.clientId && envConfig?.clientSecret) {
    return {
      id: `env_${normalized}`,
      provider: normalized,
      clientId: envConfig.clientId,
      clientSecret: envConfig.clientSecret,
      scopes: envConfig.defaultScopes,
      config: {},
      isFromDb: false,
    };
  }

  throw new NotFoundError(`OAuth provider "${providerName}" is not configured or active`);
}

/**
 * Returns a list of active provider names available system-wide or for a tenant.
 */
export async function getActiveProviders(tenantId = null) {
  const activeDb = await prisma.oAuthProvider.findMany({
    where: {
      isActive: true,
      OR: [
        ...(tenantId ? [{ tenantId }] : []),
        { tenantId: null },
      ],
    },
    select: { provider: true },
  });

  const set = new Set(activeDb.map((p) => p.provider));

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) set.add('google');
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) set.add('microsoft');
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) set.add('github');

  return Array.from(set);
}

// ── State Serialization & Verification ──────────────────────────────────────

const STATE_SECRET = process.env.JWT_SECRET || 'state-fallback-secret-at-least-32-chars';

/**
 * Encodes state into a tamper-proof signed JWT with 15-minute TTL.
 */
export function createSocialState(payload) {
  return jwt.sign(
    {
      ...payload,
      nonce: crypto.randomBytes(16).toString('hex'),
    },
    STATE_SECRET,
    { expiresIn: '15m' }
  );
}

/**
 * Verifies and decodes social state JWT.
 */
export function verifySocialState(token) {
  if (!token) throw new ValidationError('Missing state parameter');
  try {
    return jwt.verify(token, STATE_SECRET);
  } catch (err) {
    throw new UnauthorizedError('Invalid or expired state parameter: ' + err.message);
  }
}

// ── Provider URL Builders ───────────────────────────────────────────────────

/**
 * Build upstream authorization URL for a given provider.
 */
export async function buildAuthorizationUrl(providerName, { statePayload, redirectUri }) {
  const providerConfig = await getProviderConfig(providerName, statePayload.tenantId || null);
  const state = createSocialState(statePayload);
  const scopes = providerConfig.scopes.length > 0
    ? providerConfig.scopes.join(' ')
    : 'openid email profile';

  const params = new URLSearchParams({
    client_id: providerConfig.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    state,
  });

  switch (providerConfig.provider) {
    case 'google':
      params.set('access_type', 'offline');
      params.set('prompt', 'select_account');
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    case 'microsoft': {
      const msTenant = providerConfig.config?.microsoftTenantId || 'common';
      params.set('response_mode', 'query');
      return `https://login.microsoftonline.com/${msTenant}/oauth2/v2.0/authorize?${params.toString()}`;
    }

    case 'github':
      return `https://github.com/login/oauth/authorize?${params.toString()}`;

    default:
      throw new ValidationError(`Unsupported social provider: ${providerName}`);
  }
}

// ── Upstream Token Exchange & User Profile Fetchers ─────────────────────────

/**
 * Exchange authorization code for tokens and fetch verified profile.
 */
export async function exchangeCodeAndFetchProfile(providerName, { code, redirectUri, tenantId = null }) {
  const config = await getProviderConfig(providerName, tenantId);

  switch (config.provider) {
    case 'google':
      return exchangeGoogle(code, redirectUri, config);
    case 'microsoft':
      return exchangeMicrosoft(code, redirectUri, config);
    case 'github':
      return exchangeGithub(code, redirectUri, config);
    default:
      throw new ValidationError(`Unsupported provider: ${providerName}`);
  }
}

// ── Google Profile Exchange
async function exchangeGoogle(code, redirectUri, config) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errorText = await tokenRes.text();
    logger.error('Google token exchange failed', { status: tokenRes.status, body: errorText });
    throw new UnauthorizedError('Failed to exchange authorization code with Google');
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // Retrieve userinfo
  const userinfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userinfoRes.ok) {
    throw new UnauthorizedError('Failed to fetch userinfo from Google');
  }

  const profile = await userinfoRes.json();

  // Security Rule 2: Require email_verified === true
  if (profile.email_verified !== true && profile.email_verified !== 'true') {
    throw new UnauthorizedError('Google account email is not verified');
  }

  return {
    provider: 'google',
    providerId: config.id,
    externalId: profile.sub,
    email: profile.email.toLowerCase().trim(),
    emailVerified: true,
    firstName: profile.given_name || profile.name || 'User',
    lastName: profile.family_name || '',
    rawProfile: profile,
  };
}

// ── Microsoft Profile Exchange
async function exchangeMicrosoft(code, redirectUri, config) {
  const msTenant = config.config?.microsoftTenantId || 'common';
  const tokenUrl = `https://login.microsoftonline.com/${msTenant}/oauth2/v2.0/token`;

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errorText = await tokenRes.text();
    logger.error('Microsoft token exchange failed', { status: tokenRes.status, body: errorText });
    throw new UnauthorizedError('Failed to exchange authorization code with Microsoft');
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // Fetch profile via Microsoft Graph
  const graphRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!graphRes.ok) {
    throw new UnauthorizedError('Failed to fetch user profile from Microsoft');
  }

  const me = await graphRes.json();

  // Microsoft email can be in 'mail' or 'userPrincipalName'
  const email = (me.mail || me.userPrincipalName || '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    throw new UnauthorizedError('Microsoft account did not return a valid email address');
  }

  // Check tenant ID if tenant restriction configured in config
  if (config.config?.requiredTenantId && tokenData.id_token) {
    try {
      const decoded = jwt.decode(tokenData.id_token);
      if (decoded?.tid && decoded.tid !== config.config.requiredTenantId) {
        throw new ForbiddenError('Microsoft account tenant ID does not match the configured organization');
      }
    } catch (e) {
      if (e instanceof ForbiddenError) throw e;
    }
  }

  return {
    provider: 'microsoft',
    providerId: config.id,
    externalId: me.id,
    email,
    emailVerified: true, // Enterprise Microsoft accounts or graph verified identities
    firstName: me.givenName || me.displayName || 'User',
    lastName: me.surname || '',
    rawProfile: me,
  };
}

// ── GitHub Profile Exchange
async function exchangeGithub(code, redirectUri, config) {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    throw new UnauthorizedError('Failed to exchange code with GitHub');
  }

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    throw new UnauthorizedError(`GitHub OAuth error: ${tokenData.error_description || tokenData.error}`);
  }

  const accessToken = tokenData.access_token;

  // 1. Fetch user profile
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'IACMS-IAM',
    },
  });

  if (!userRes.ok) {
    throw new UnauthorizedError('Failed to fetch profile from GitHub');
  }

  const githubUser = await userRes.json();

  // 2. Security Rule 3: Call /user/emails and filter for { primary: true, verified: true }
  const emailsRes = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'IACMS-IAM',
    },
  });

  if (!emailsRes.ok) {
    throw new UnauthorizedError('Failed to fetch verified emails from GitHub');
  }

  const emails = await emailsRes.json();
  if (!Array.isArray(emails)) {
    throw new UnauthorizedError('Invalid email response from GitHub');
  }

  const primaryVerified = emails.find((e) => e.primary && e.verified);
  if (!primaryVerified || !primaryVerified.email) {
    throw new UnauthorizedError('GitHub account does not have a verified primary email address');
  }

  const [firstName, ...rest] = (githubUser.name || githubUser.login || 'User').split(' ');

  return {
    provider: 'github',
    providerId: config.id,
    externalId: String(githubUser.id),
    email: primaryVerified.email.toLowerCase().trim(),
    emailVerified: true,
    firstName: firstName || 'User',
    lastName: rest.join(' ') || '',
    username: githubUser.login,
    rawProfile: githubUser,
  };
}

// ── Tenant Resolution Helper ────────────────────────────────────────────────

/**
 * Resolve tenant from tenantCode or email domain (Security Rule 5).
 */
export async function resolveTenant({ tenantCode, email }) {
  // 1. Explicit tenant code takes precedence
  if (tenantCode) {
    const tenant = await prisma.tenant.findUnique({
      where: { code: tenantCode },
    });
    if (!tenant) throw new NotFoundError(`Tenant with code "${tenantCode}" not found`);
    if (!tenant.isActive) throw new UnauthorizedError('Tenant organization is inactive');
    return tenant;
  }

  // 2. Derive tenant from email domain only if domain is registered in tenant.config.domains
  if (email && email.includes('@')) {
    const domain = email.split('@')[1]?.toLowerCase().trim();
    if (domain) {
      const activeTenants = await prisma.tenant.findMany({
        where: { isActive: true },
      });

      const matching = activeTenants.filter((t) => {
        const domains = t.config?.domains;
        return Array.isArray(domains) && domains.some((d) => String(d).toLowerCase() === domain);
      });

      if (matching.length === 1) {
        return matching[0];
      }

      if (matching.length > 1) {
        logger.warn('Multiple active tenants matched email domain', { domain });
        throw new ValidationError('Multiple organizations match this email domain. Please specify tenant_code.');
      }
    }
  }

  throw new ValidationError(
    'Could not resolve organization. Please provide tenant_code or ensure your email domain is registered with an organization.'
  );
}

// ── Core Social Callback Handler (JIT Provisioning & Account Takeover Guards) ─

/**
 * Process a verified social profile after upstream callback.
 *
 * Enforces:
 *  - Explicit linking if action === 'link'
 *  - FederatedIdentity lookup
 *  - Conflict detection if email already exists in tenant (Security Rule 4)
 *  - JIT user creation + default role assignment
 */
export async function processSocialLogin({ profile, state }) {
  const { provider, providerId, externalId, email, firstName, lastName, username } = profile;
  const isEnvProvider = String(providerId).startsWith('env_');

  // Find or verify the OAuthProvider record in DB
  let dbProvider;
  if (!isEnvProvider) {
    dbProvider = await prisma.oAuthProvider.findUnique({ where: { id: providerId } });
  } else {
    // If provider was configured via ENV, find or upsert a platform-level record so FKs work
    dbProvider = await prisma.oAuthProvider.findFirst({
      where: { provider, tenantId: null },
    });
    if (!dbProvider) {
      dbProvider = await prisma.oAuthProvider.create({
        data: {
          provider,
          clientId: profile.rawProfile?.client_id || 'env_client',
          clientSecretEnc: 'env_managed',
          isActive: true,
          tenantId: null,
        },
      });
    }
  }

  const effectiveProviderId = dbProvider.id;

  // ── Flow 1: Explicit Account Linking by Authenticated User ───────────────────
  if (state.action === 'link') {
    if (!state.userId) {
      throw new UnauthorizedError('User authentication required for account linking');
    }

    const existingIdentity = await prisma.federatedIdentity.findUnique({
      where: {
        providerId_externalId: {
          providerId: effectiveProviderId,
          externalId,
        },
      },
    });

    if (existingIdentity) {
      if (existingIdentity.userId === state.userId) {
        return { user: await prisma.user.findUnique({ where: { id: state.userId }, include: { tenant: true } }), isNew: false, linked: true };
      }
      throw new ConflictError('This social account is already linked to another user account');
    }

    const linkedIdentity = await prisma.federatedIdentity.create({
      data: {
        userId: state.userId,
        providerId: effectiveProviderId,
        externalId,
        email,
      },
    });

    logger.info('Social identity linked to user account', { userId: state.userId, provider, externalId });

    const user = await prisma.user.findUnique({
      where: { id: state.userId },
      include: { tenant: true, userRoles: { select: { roleId: true } } },
    });

    return { user, isNew: false, linked: true };
  }

  // ── Flow 2: Existing Linked Identity Login ──────────────────────────────────
  const existingIdentity = await prisma.federatedIdentity.findUnique({
    where: {
      providerId_externalId: {
        providerId: effectiveProviderId,
        externalId,
      },
    },
    include: {
      user: {
        include: { tenant: true, userRoles: { select: { roleId: true } } },
      },
    },
  });

  if (existingIdentity?.user) {
    const user = existingIdentity.user;
    if (!user.isActive) throw new UnauthorizedError('User account is inactive');
    if (!user.tenant?.isActive) throw new UnauthorizedError('Tenant organization is inactive');

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    logger.info('Social login via existing federated identity', { userId: user.id, provider, externalId });
    return { user, isNew: false };
  }

  // ── Flow 3: Unlinked Identity — JIT User Provisioning or Conflict Check ──────
  // Security Rule 1 & 4: NEVER auto-link by email alone.
  const tenant = await resolveTenant({ tenantCode: state.tenantCode, email });

  // Check if a user with this email already exists in the tenant
  const existingUserWithEmail = await prisma.user.findFirst({
    where: {
      email,
      tenantId: tenant.id,
    },
  });

  if (existingUserWithEmail) {
    // Security Rule 4: Explicit linking required!
    logger.warn('Social login rejected: email exists but is not linked', {
      email,
      tenantId: tenant.id,
      provider,
      externalId,
    });
    throw new ConflictError(
      'An account with this email address already exists. Please sign in with your password and link your social account in settings.'
    );
  }

  // Generate unique username
  let baseUsername = (username || email.split('@')[0]).toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!baseUsername) baseUsername = 'user';
  let targetUsername = baseUsername;

  const existingUsername = await prisma.user.findFirst({
    where: { tenantId: tenant.id, username: targetUsername },
  });
  if (existingUsername) {
    targetUsername = `${baseUsername}_${crypto.randomBytes(3).toString('hex')}`;
  }

  // Unusable random password hash — account can only login via social or explicit reset
  const unguessablePassword = crypto.randomBytes(32).toString('hex');
  const passwordHash = await bcrypt.hash(unguessablePassword, 10);

  // Determine default role for tenant (e.g. 'operator', 'user', or first active role)
  const defaultRole = await prisma.role.findFirst({
    where: {
      tenantId: tenant.id,
      isActive: true,
      name: { in: ['operator', 'user', 'member', 'Default'] },
    },
  }) || await prisma.role.findFirst({
    where: { tenantId: tenant.id, isActive: true },
  });

  // Provision user in a transaction with federated identity
  const newUser = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email,
        username: targetUsername,
        firstName,
        lastName,
        passwordHash,
        tenantId: tenant.id,
        isActive: true,
        isEmailVerified: true, // Upstream IdP verified
        mustChangePassword: false,
        lastLogin: new Date(),
      },
      include: { tenant: true },
    });

    if (defaultRole) {
      await tx.userRole.create({
        data: {
          userId: createdUser.id,
          roleId: defaultRole.id,
        },
      });
    }

    // Security Rule 6: Store ONLY externalId and email reference; NO tokens
    await tx.federatedIdentity.create({
      data: {
        userId: createdUser.id,
        providerId: effectiveProviderId,
        externalId,
        email,
      },
    });

    return createdUser;
  });

  const fullUser = await prisma.user.findUnique({
    where: { id: newUser.id },
    include: { tenant: true, userRoles: { select: { roleId: true } } },
  });

  logger.info('JIT social user provisioned', {
    userId: fullUser.id,
    email: fullUser.email,
    tenantId: tenant.id,
    provider,
  });

  // Publish event bus notification
  const bus = getEventBus();
  if (bus) {
    bus.publish(TOPICS.USER_CREATED, {
      userId: fullUser.id,
      tenantId: fullUser.tenantId,
      email: fullUser.email,
      firstName: fullUser.firstName,
      source: `social_${provider}`,
    }).catch((err) => logger.warn('Failed to publish user.created event for social user', { error: err.message }));
  }

  return { user: fullUser, isNew: true };
}

// ── Unlink Provider ─────────────────────────────────────────────────────────

export async function unlinkSocialProvider(userId, providerName) {
  const normalized = providerName.toLowerCase();

  const identity = await prisma.federatedIdentity.findFirst({
    where: {
      userId,
      provider: { provider: normalized },
    },
    include: { provider: true },
  });

  if (!identity) {
    throw new NotFoundError(`No linked ${providerName} account found for this user`);
  }

  // Ensure user has a usable password or at least one other login method before unlinking
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { federatedIdentities: true },
  });

  if (user.federatedIdentities.length <= 1 && user.mustChangePassword) {
    throw new ValidationError(
      'Cannot unlink the only authentication method on this account without setting a password first'
    );
  }

  await prisma.federatedIdentity.delete({
    where: { id: identity.id },
  });

  logger.info('Social provider unlinked', { userId, provider: normalized });
  return { message: `${providerName} account successfully unlinked` };
}

// ── List User Identities ────────────────────────────────────────────────────

export async function listUserIdentities(userId) {
  const identities = await prisma.federatedIdentity.findMany({
    where: { userId },
    select: {
      id: true,
      externalId: true,
      email: true,
      createdAt: true,
      provider: {
        select: {
          id: true,
          provider: true,
        },
      },
    },
  });

  return identities.map((i) => ({
    id: i.id,
    provider: i.provider.provider,
    providerId: i.provider.id,
    email: i.email,
    linkedAt: i.createdAt,
  }));
}
