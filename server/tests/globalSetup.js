// Runs once before all test files: brings resolvd_test up to date and resets it to the seed data.
// Runs in Vitest's main process (not a test worker), so it loads .env.test itself.

// The seed truncates every table, so a .env.test copied from .env by mistake would wipe the
// development data. Only database names ending in _test are accepted.
function assertTestDatabase(name) {
  const url = process.env[name];
  if (!url) {
    throw new Error(
      `${name} is not set. Create server/.env.test from server/.env.test.example ` +
        '(CI sets it as an environment variable instead).',
    );
  }
  const database = new URL(url).pathname.slice(1);
  if (!database.endsWith('_test')) {
    throw new Error(
      `${name} points at "${database}". Tests reset the database they run against, ` +
        'so they only run against a database whose name ends in _test (resolvd_test).',
    );
  }
}

export default async function setup() {
  process.env.NODE_ENV = 'test';
  // Dynamic imports so NODE_ENV is set before loadEnv decides which file to read.
  await import('../scripts/lib/loadEnv.js');
  assertTestDatabase('DATABASE_URL');
  assertTestDatabase('MIGRATION_DATABASE_URL');

  const { migrate } = await import('../scripts/lib/migrate.js');
  const { seed } = await import('../scripts/lib/seed.js');

  const quiet = () => {};
  await migrate(process.env.MIGRATION_DATABASE_URL, { log: quiet });
  await seed(process.env.MIGRATION_DATABASE_URL, { log: quiet, table: quiet });
}
