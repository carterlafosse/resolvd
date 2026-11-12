// Users business rules: who can list users, creating users, and protecting the org's admins.
import bcrypt from 'bcryptjs';
import { withOrg } from '../../db/withOrg.js';
import { AppError } from '../../utils/AppError.js';
import { fieldError, isUniqueViolation } from '../../utils/pgErrors.js';
import { BCRYPT_COST, emailTakenError } from '../auth/auth.service.js';
import * as queries from './users.queries.js';

// Rules:
// - Technicians and admins can list users; only admins see emails and account details.
// - Only admins create or edit other users. Another org's user id is simply not found (404).
// - An admin can't demote or deactivate themselves.
// - The org always keeps at least one active admin.
// - Role and active changes apply on the user's next request (authenticate reads the database).

export function listUsers(actor, filters) {
  return withOrg(actor.orgId, (client) =>
    queries.listUsers(client, filters, { full: actor.role === 'admin' }),
  );
}

export async function createUser(actor, { name, email, role, department, password }) {
  // Hashed before the transaction so a connection isn't held open during slow bcrypt work.
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  try {
    return await withOrg(actor.orgId, (client) =>
      queries.insertUser(client, { name, email, role, department, passwordHash }),
    );
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_lower_idx')) throw emailTakenError();
    throw err;
  }
}

export function updateUser(actor, userId, changes) {
  const demotes = changes.role !== undefined && changes.role !== 'admin';
  const deactivates = changes.isActive === false;

  return withOrg(actor.orgId, async (client) => {
    // Admin rows are locked before the target so every request locks in the same order.
    const activeAdminIds =
      changes.role !== undefined || changes.isActive !== undefined
        ? await queries.lockActiveAdmins(client)
        : [];

    const target = await queries.findUserForUpdate(client, userId);
    if (!target) throw AppError.notFound('User not found');

    if (target.id === actor.id && (demotes || deactivates)) {
      throw AppError.badRequest(
        "You can't remove your own admin role or deactivate your own account",
        undefined,
        'CANNOT_CHANGE_SELF',
      );
    }
    const isOnlyActiveAdmin = activeAdminIds.length === 1 && activeAdminIds[0] === target.id;
    if ((demotes || deactivates) && isOnlyActiveAdmin) {
      throw AppError.badRequest(
        'The organization must keep at least one active admin',
        undefined,
        'LAST_ADMIN',
      );
    }

    return queries.updateUser(client, userId, changes);
  });
}

// PATCH /api/users/me: any signed-in user's own name, notification setting and password.
export async function updateMe(actor, { name, emailNotifications, currentPassword, newPassword }) {
  const changes = { name, emailNotifications };
  if (newPassword !== undefined) {
    // Hashed before the transaction, like createUser.
    changes.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  }

  return withOrg(actor.orgId, async (client) => {
    const me = await queries.findUserForUpdate(client, actor.id);
    if (newPassword !== undefined && !(await bcrypt.compare(currentPassword, me.password_hash))) {
      // 400, not 401: the session is fine, and a 401 would sign the user out in the front end.
      throw AppError.badRequest(
        'Current password is incorrect',
        fieldError('currentPassword', 'Current password is incorrect'),
        'INVALID_PASSWORD',
      );
    }
    return queries.updateUser(client, actor.id, changes);
  });
}
