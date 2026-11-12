// Categories business rules: everyone in the org can read them; only admins add or rename.
import { withOrg } from '../../db/withOrg.js';
import { AppError } from '../../utils/AppError.js';
import { fieldError, isUniqueViolation } from '../../utils/pgErrors.js';
import * as queries from './categories.queries.js';

// Categories are renamed, never deleted, so existing tickets always keep a valid category.

function nameTakenError() {
  return AppError.conflict(
    'A category with that name already exists',
    fieldError('name', 'A category with that name already exists'),
  );
}

// Turns the UNIQUE (organization_id, name) violation into a clear 409.
async function withNameCheck(work) {
  try {
    return await work();
  } catch (err) {
    if (isUniqueViolation(err, 'categories_organization_id_name_key')) throw nameTakenError();
    throw err;
  }
}

export function listCategories(actor) {
  return withOrg(actor.orgId, (client) => queries.listCategories(client));
}

export function createCategory(actor, { name }) {
  return withNameCheck(() =>
    withOrg(actor.orgId, (client) => queries.insertCategory(client, name)),
  );
}

export function renameCategory(actor, categoryId, { name }) {
  return withNameCheck(() =>
    withOrg(actor.orgId, async (client) => {
      const category = await queries.renameCategory(client, categoryId, name);
      if (!category) throw AppError.notFound('Category not found');
      return category;
    }),
  );
}
