// Applies the numbered SQL files in db/migrations that haven't run yet, in name order.
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const MIGRATIONS_DIR = new URL('../../db/migrations/', import.meta.url);

export async function migrate(connectionString, { log = console.log } = {}) {
  if (!connectionString) {
    throw new Error('MIGRATION_DATABASE_URL is not set. Add it to server/.env (see .env.example).');
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Zero-padded names (001_, 002_, ...) make alphabetical order the same as numeric order.
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      log('Database is up to date. No pending migrations.');
      return [];
    }

    for (const file of pending) {
      const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8');
      log(`Applying ${file}`);

      // The file and its schema_migrations row commit together, so a failed migration
      // leaves no half-built tables and is retried on the next run.
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`, { cause: err });
      }
    }

    log(`Applied ${pending.length} migration(s).`);
    return pending;
  } finally {
    await client.end();
  }
}
