// Command-line runner: resets the database to the seed organizations using MIGRATION_DATABASE_URL.
import './lib/loadEnv.js';
import { seed } from './lib/seed.js';

await seed(process.env.MIGRATION_DATABASE_URL).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
