// Session tokens: signs and verifies the JWT and sets or clears the resolvd_token cookie.
import jwt from 'jsonwebtoken';
import { env, isProd } from '../../config/env.js';

// Shared with ScreenGuide AI: the cookie name and the { sub, org } payload must not change.
export const SESSION_COOKIE = 'resolvd_token';
const SESSION_HOURS = 8;

// httpOnly: page scripts can't read the token, so an XSS bug can't steal the session.
// secure in production: only sent over HTTPS. sameSite lax: not sent on cross-site POSTs,
// which blocks CSRF from other websites while normal links into the app still work.
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/',
};

export function signSessionToken(user) {
  return jwt.sign({ sub: user.id, org: user.organization_id }, env.JWT_SECRET, {
    expiresIn: `${SESSION_HOURS}h`,
  });
}

// Throws if the token is expired, tampered with, or signed some other way. Pinning the
// algorithm stops a forged token from choosing a weaker one.
export function verifySessionToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
}

export function setSessionCookie(res, user) {
  res.cookie(SESSION_COOKIE, signSessionToken(user), {
    ...cookieOptions,
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
  });
}

// Browsers only delete a cookie when the path and flags match the ones it was set with.
export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}
