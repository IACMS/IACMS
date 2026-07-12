/**
 * Session Controller for API Gateway
 * Handles session-based authentication for web browsers
 */

import { getUserPermissionsWithAvailability } from '../middleware/rbac.middleware.js';
import { fetchMustChangePasswordFromAuth } from '../utils/authPasswordStatus.js';

const rbacServiceUrl = () => process.env.RBAC_SERVICE_URL || 'http://localhost:3002';

/**
 * Session Login
 * POST /api/v1/session/login
 */
export async function sessionLogin(req, res, next) {
  try {
    const { email, password, tenantCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and password are required',
        },
      });
    }

    // Forward credentials to auth service
    const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
    
    const authResponse = await fetch(`${authServiceUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, tenantCode }),
    });

    const authData = await authResponse.json();

    if (!authResponse.ok) {
      return res.status(authResponse.status).json(authData);
    }

    const { user, accessToken, refreshToken } = authData;

    const mustPw = Boolean(user.mustChangePassword);
    let permissions = [];
    let rbacAvailable = true;

    if (!mustPw) {
      const resolved = await getUserPermissionsWithAvailability(user.id, user.tenant.id, rbacServiceUrl());
      permissions = resolved.permissions;
      rbacAvailable = resolved.rbacAvailable;

      if (!rbacAvailable) {
        return res.status(503).json({
          error: {
            code: 'POLICY_UNAVAILABLE',
            message:
              'Authorization service is temporarily unavailable. Please try again in a moment.',
          },
        });
      }
    }

    req.session.user = {
      id: user.id,
      tenantId: user.tenant.id,
      departmentId: user.departmentId ?? null,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      tenant: user.tenant,
      roles: Array.isArray(user.roles) ? user.roles : [],
      mustChangePassword: mustPw,
    };
    req.session.createdAt = new Date().toISOString();
    req.session.lastAccessed = new Date().toISOString();

    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`Session created for user ${user.email}`);

    res.json({
      message: 'Login successful',
      authMethod: 'session',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        departmentId: user.departmentId ?? null,
        tenant: user.tenant,
        mustChangePassword: mustPw,
      },
      permissions,
      tokens: { accessToken, refreshToken },
    });
  } catch (error) {
    console.error('Session login error:', error);
    if (error.cause?.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Authentication service is unavailable',
        },
      });
    }
    next(error);
  }
}

/**
 * Session Logout
 * POST /api/v1/session/logout
 */
export async function sessionLogout(req, res, next) {
  try {
    if (!req.session || !req.session.user) {
      return res.status(200).json({ message: 'No active session' });
    }

    const userEmail = req.session.user.email;

    await new Promise((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.clearCookie('iacms.sid', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    console.log(`Session destroyed for user ${userEmail}`);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Session logout error:', error);
    next(error);
  }
}

/**
 * Session Status
 * GET /api/v1/session/status
 */
export async function sessionStatus(req, res) {
  if (req.session && req.session.user) {
    const u = req.session.user;
    const dbMustChange = await fetchMustChangePasswordFromAuth(u.id, u.tenantId);
    const mustChangePassword =
      dbMustChange !== null ? dbMustChange : Boolean(u.mustChangePassword);

    let permissions = [];
    let rbacAvailable = true;
    if (!mustChangePassword) {
      try {
        const resolved = await getUserPermissionsWithAvailability(u.id, u.tenantId, rbacServiceUrl());
        permissions = resolved.permissions;
        rbacAvailable = resolved.rbacAvailable;
      } catch {
        permissions = [];
        rbacAvailable = false;
      }
    }

    return res.json({
      authenticated: true,
      authMethod: 'session',
      user: {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        tenantId: u.tenantId,
        departmentId: u.departmentId ?? null,
        tenant: u.tenant,
        mustChangePassword,
      },
      permissions,
      rbac: { available: rbacAvailable },
      session: {
        createdAt: req.session.createdAt,
        lastAccessed: req.session.lastAccessed,
      },
    });
  }

  if (req.user && req.authMethod === 'jwt') {
    const dbMustChange = await fetchMustChangePasswordFromAuth(req.user.id, req.user.tenantId);
    const mustChangePassword =
      dbMustChange !== null ? dbMustChange : Boolean(req.user.mustChangePassword);

    let permissions = [];
    let rbacAvailable = true;
    if (!mustChangePassword) {
      try {
        const resolved = await getUserPermissionsWithAvailability(
          req.user.id,
          req.user.tenantId,
          rbacServiceUrl(),
        );
        permissions = resolved.permissions;
        rbacAvailable = resolved.rbacAvailable;
      } catch {
        permissions = [];
        rbacAvailable = false;
      }
    }

    return res.json({
      authenticated: true,
      authMethod: 'jwt',
      user: {
        id: req.user.id,
        email: req.user.email,
        tenantId: req.user.tenantId,
        departmentId: req.user.departmentId ?? null,
        mustChangePassword,
      },
      permissions,
      rbac: { available: rbacAvailable },
    });
  }

  res.json({
    authenticated: false,
    authMethod: null,
    user: null,
    permissions: [],
    rbac: { available: true },
  });
}

/**
 * Session Refresh
 * POST /api/v1/session/refresh
 */
export async function sessionRefresh(req, res, next) {
  try {
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        error: {
          code: 'NO_SESSION',
          message: 'No active session to refresh',
        },
      });
    }

    req.session.lastAccessed = new Date().toISOString();

    await new Promise((resolve, reject) => {
      req.session.touch((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.json({
      message: 'Session refreshed',
      session: {
        createdAt: req.session.createdAt,
        lastAccessed: req.session.lastAccessed,
      },
    });
  } catch (error) {
    console.error('Session refresh error:', error);
    next(error);
  }
}
