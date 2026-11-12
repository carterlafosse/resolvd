// Auth business rules: organization sign-up, login with lockout, and loading the signed-in user.
import bcrypt from 'bcryptjs';
import { setOrg, withTransaction } from '../../db/withOrg.js';
import { AppError } from '../../utils/AppError.js';
import { fieldError, isUniqueViolation } from '../../utils/pgErrors.js';
import { DEFAULT_CATEGORIES, DEFAULT_SLA_POLICIES } from '../organizations/defaults.js';
import * as usersQueries from '../users/users.queries.js';
import * as queries from './auth.queries.js';

export const BCRYPT_COST = 12;

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
