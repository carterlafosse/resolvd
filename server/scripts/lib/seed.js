// Resets the dev/test database to two known organizations (Acme Corp and Globex) with users and defaults.
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { SEED_ORGS, USERS } from '../../db/seeds/users.js';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SLA_POLICIES,
} from '../../src/modules/organizations/defaults.js';

const BCRYPT_COST = 12;

export async function seed(
  connectionString,
  { password = process.env.SEED_PASSWORD, log = console.log, table = console.table } = {},
) {
  if (!connectionString) {
    throw new Error('MIGRATION_DATABASE_URL is not set. Add it to server/.env (see .env.example).');
  }
  if (!password) {
    throw new Error(
      'SEED_PASSWORD is not set. Add it to server/.env; every seed user signs in with it.',
    );
  }
  // TRUNCATE wipes every org, so never let this near production by accident.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production. This script deletes all data.');
  }

  // Every seed user shares the demo password, so one hash (one slow bcrypt run) is enough.
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // Connects as the owner role, which bypasses RLS, so no org needs to be set.
  const client = new pg.Client({ connectionString });
  await client.connect();
  const created = [];

  try {
    await client.query('BEGIN');
    await client.query(`
      TRUNCATE organizations, users, categories, sla_policies, tickets, ticket_comments, ticket_events
      RESTART IDENTITY CASCADE
    `);

    for (const [orgKey, org] of Object.entries(SEED_ORGS)) {
      const { rows } = await client.query(
        'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
        [org.name, org.slug],
      );
      const orgId = rows[0].id;

      for (const user of Object.values(USERS[orgKey])) {
        await client.query(
          `INSERT INTO users (organization_id, name, email, password_hash, role, department)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orgId, user.name, user.email, passwordHash, user.role, user.department],
        );
        created.push({
          organization: org.name,
          name: user.name,
          email: user.email,
          role: user.role,
        });
      }

      await client.query(
        'INSERT INTO categories (organization_id, name) SELECT $1, unnest($2::text[])',
        [orgId, DEFAULT_CATEGORIES],
      );

      for (const policy of DEFAULT_SLA_POLICIES) {
        await client.query(
          `INSERT INTO sla_policies (organization_id, priority, response_minutes, resolution_minutes)
           VALUES ($1, $2, $3, $4)`,
          [orgId, policy.priority, policy.responseMinutes, policy.resolutionMinutes],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }

  log(`Seeded ${Object.keys(SEED_ORGS).length} organizations and ${created.length} users.`);
  log('Every seed user signs in with SEED_PASSWORD from server/.env.');
  table(created);
  return created;
}
