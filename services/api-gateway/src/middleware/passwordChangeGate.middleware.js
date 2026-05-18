/**
 * Blocks `/api/v1/*` traffic when `req.user.mustChangePassword` is still true **after**
 * authentication has reconciled the flag with the auth-service DB (see `authenticate`).
 */

const ALLOW = [
  { method: 'POST', path: '/auth/change-password' },
  { method: 'GET', path: '/auth/password-status' },
];

export function enforcePasswordChanged(req, res, next) {
  if (!req.user?.mustChangePassword) return next();

  const ok = ALLOW.some((a) => a.method === req.method && req.path === a.path);
  if (ok) return next();

  return res.status(403).json({
    error: {
      code: 'PASSWORD_CHANGE_REQUIRED',
      message: 'You must change your password before continuing.',
    },
  });
}
