import jwt from 'jsonwebtoken';
import config from '../config.js';

/**
 * JWT authentication middleware.
 * Extracts token from Authorization header, verifies it, and attaches
 * the decoded user payload (including tenant_id) to req.user.
 */
export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Authentication required' } });
  }

  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, config.jwt.secret);
    next();
  } catch {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
}

/**
 * Role-based authorization middleware.
 * Must be used after authenticate().
 * @param  {...string} roles - Allowed roles (e.g., 'owner', 'manager')
 */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: { message: 'Insufficient permissions' } });
    }
    next();
  };
}
