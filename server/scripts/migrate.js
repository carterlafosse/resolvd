// Command-line runner: applies pending migrations using MIGRATION_DATABASE_URL (the owner role).
import './lib/loadEnv.js';
import { migrate } from './lib/migrate.js';

await migrate(process.env.MIGRATION_DATABASE_URL).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
