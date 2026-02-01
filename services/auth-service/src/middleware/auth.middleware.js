import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../../../shared/common/errors.js';

const JWT_SECRET = process.env.JWT_SECRET || 'iacms-dev-secret-key-change-in-production';

/**
 * Authenticate JWT token
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return next(new UnauthorizedError('Token required'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

