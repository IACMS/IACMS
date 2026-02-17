/**
 * Session Controller for API Gateway
 * Handles session-based authentication for web browsers
 */

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

    // Create session
    const { user, accessToken, refreshToken } = authData;

    req.session.user = {
      id: user.id,
      tenantId: user.tenant.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      tenant: user.tenant,
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
        tenant: user.tenant,
      },
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
    return res.json({
      authenticated: true,
      authMethod: 'session',
      user: {
        id: req.session.user.id,
        email: req.session.user.email,
        firstName: req.session.user.firstName,
        lastName: req.session.user.lastName,
        tenant: req.session.user.tenant,
      },
      session: {
        createdAt: req.session.createdAt,
        lastAccessed: req.session.lastAccessed,
      },
    });
  }

  if (req.user && req.authMethod === 'jwt') {
    return res.json({
      authenticated: true,
      authMethod: 'jwt',
      user: {
        id: req.user.id,
        email: req.user.email,
        tenantId: req.user.tenantId,
      },
    });
  }

  res.json({
    authenticated: false,
    authMethod: null,
    user: null,
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
