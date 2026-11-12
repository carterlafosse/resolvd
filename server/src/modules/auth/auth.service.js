// Auth business rules: organization sign-up, login with lockout, and loading the signed-in user.
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool } from '../../db/pool.js';
import { setOrg, withOrg, withTransaction } from '../../db/withOrg.js';
import { AppError } from '../../utils/AppError.js';
import { fieldError, isUniqueViolation } from '../../utils/pgErrors.js';
import { DEFAULT_CATEGORIES, DEFAULT_SLA_POLICIES } from '../organizations/defaults.js';
import * as usersQueries from '../users/users.queries.js';
import * as queries from './auth.queries.js';

export const BCRYPT_COST = 12;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

// A real bcrypt hash of a random value nobody knows, made once at startup. Comparing against
// it when the email is unknown takes as long as checking a real password, so response time
// doesn't reveal which emails have accounts. Generated, not hardcoded, so it can't match anything.
const DUMMY_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), BCRYPT_COST);

// One message for unknown email, inactive account and wrong password, so a response never
// reveals whether an email is registered.
function invalidCredentials() {
  return AppError.unauthorized('Invalid email or password', undefined, 'INVALID_CREDENTIALS');
}

// Unique constraints sign-up can hit, mapped to messages the form can show under the field.
export function emailTakenError() {
  return AppError.conflict(
    'That email is already registered',
    fieldError('email', 'That email is already registered'),
  );
}

function slugTakenError() {
  return AppError.conflict('That URL name is taken', fieldError('slug', 'That URL name is taken'));
}

// POST /api/auth/register-organization: a new org, its first admin and its defaults, all or nothing.
export async function registerOrganization({ organizationName, slug, name, email, password }) {
  // Hash before the transaction: bcrypt is deliberately slow, and a pooled connection
  // shouldn't sit idle inside an open transaction while it runs.
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    return await withTransaction(async (client) => {
      const orgId = await queries.createOrganization(client, organizationName, slug);
      // From here on RLS applies to the new org, exactly as in any other request.
      await setOrg(client, orgId);

      const user = await usersQueries.insertUser(client, {
        name,
        email,
        passwordHash,
        role: 'admin',
      });
      await queries.insertCategories(client, DEFAULT_CATEGORIES);
      await queries.insertSlaPolicies(client, DEFAULT_SLA_POLICIES);
      const organization = await queries.findCurrentOrganization(client);

      return { user, organization };
    });
  } catch (err) {
    // The whole transaction rolled back, so a taken email never leaves an orphan org behind.
    if (isUniqueViolation(err, 'users_email_lower_idx')) throw emailTakenError();
    if (isUniqueViolation(err, 'organizations_slug_key')) throw slugTakenError();
    throw err;
  }
}

// POST /api/auth/login. Each failed check throws, so only a fully valid login reaches withOrg.
export async function login({ email, password }) {
  const account = await queries.findUserForLogin(pool, email);

  if (!account || !account.is_active) {
    // Still run bcrypt, so these fail in the same time as a wrong password.
    await bcrypt.compare(password, account?.password_hash ?? DUMMY_HASH);
    throw invalidCredentials();
  }

  // Checked before the password, so guesses made during the lock can't succeed.
  if (account.locked_until && account.locked_until > new Date()) {
    throw AppError.unauthorized(
      'Account temporarily locked. Try again later.',
      undefined,
      'ACCOUNT_LOCKED',
    );
  }

  if (!(await bcrypt.compare(password, account.password_hash))) {
    // Must not run inside a transaction: throwing the 401 would roll the transaction back
    // and the failed attempt would never be counted, so the lockout would never trigger.
    await queries.recordLoginFailure(pool, account.id, MAX_FAILED_LOGINS, LOCK_MINUTES);
    throw invalidCredentials();
  }

  return withOrg(account.organization_id, async (client) => {
    const user = await queries.recordLoginSuccess(client, account.id);
    const organization = await queries.findCurrentOrganization(client);
    return { user, organization };
  });
}

// Used by authenticate on every request. The token only says who and which org; the role and
// active flag are read fresh, so a demotion or deactivation applies to the very next request.
export async function findSessionUser(userId, orgId) {
  const user = await withOrg(orgId, (client) => usersQueries.findUserById(client, userId));
  return user?.is_active ? user : null;
}

// GET /api/auth/me: the signed-in user plus their organization's name and slug.
export async function getCurrentUser(userId, orgId) {
  return withOrg(orgId, async (client) => ({
    user: await usersQueries.findUserById(client, userId),
    organization: await queries.findCurrentOrganization(client),
  }));
}
