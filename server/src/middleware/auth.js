// authenticate (who is calling, from the session cookie) and requireRole (may their role do this).
import { findSessionUser } from '../modules/auth/auth.service.js';
import { SESSION_COOKIE, verifySessionToken } from '../modules/auth/session.js';
import { AppError } from '../utils/AppError.js';

function sessionExpired() {
  return AppError.unauthorized('Session expired. Please sign in again.');
}

// Sets req.user = { id, orgId, role, name, email } or responds 401.
export async function authenticate(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) throw AppError.unauthorized();

  let payload;
  try {
    payload = verifySessionToken(token);
  } catch {
    throw sessionExpired();
  }
  // A valid signature on an unexpected payload shape is still not a usable session.
  if (!Number.isInteger(payload.sub) || !Number.isInteger(payload.org)) throw sessionExpired();

  // The role is never taken from the token: it's read from the database on every request,
  // so changing a role or deactivating a user takes effect immediately.
  const user = await findSessionUser(payload.sub, payload.org);
  if (!user) throw sessionExpired();

  req.user = {
    id: user.id,
    orgId: user.organization_id,
    role: user.role,
    name: user.name,
    email: user.email,
  };
  next();
}

// Use after authenticate. 403, not 404: the caller can see the route, their role just can't use it.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) throw AppError.forbidden();
    next();
  };
}
