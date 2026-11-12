// Loads server/.env (or server/.env.test when NODE_ENV=test) for command-line scripts.
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const file = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';

// Real environment variables win over the file (dotenv doesn't override by default),
// which lets CI and one-off PowerShell commands supply values directly.
dotenv.config({ path: fileURLToPath(new URL(`../../${file}`, import.meta.url)), quiet: true });
