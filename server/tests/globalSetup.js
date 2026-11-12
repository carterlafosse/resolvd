// Runs once before all test files: brings resolvd_test up to date and resets it to the seed data.
// Runs in Vitest's main process (not a test worker), so it loads .env.test itself.

export default async function setup() {
  process.env.NODE_ENV = 'test';
  // Dynamic imports so NODE_ENV is set before loadEnv decides which file to read.
  await import('../scripts/lib/loadEnv.js');
  const { migrate } = await import('../scripts/lib/migrate.js');
  const { seed } = await import('../scripts/lib/seed.js');

  const quiet = () => {};
  await migrate(process.env.MIGRATION_DATABASE_URL, { log: quiet });
  await seed(process.env.MIGRATION_DATABASE_URL, { log: quiet, table: quiet });
}
