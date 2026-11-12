// Loads and validates environment variables once at startup, so bad config fails fast and clearly.
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const file = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';

// Real environment variables win over the file (dotenv doesn't override by default),
// which is how Render, CI and one-off PowerShell commands supply values.
dotenv.config({ path: fileURLToPath(new URL(`../../${file}`, import.meta.url)), quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  CLIENT_ORIGIN: z.url(),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  // Only key names and rule messages are printed, never the values, so secrets stay out of logs.
  // console is used because the logger itself depends on this config.
  console.error(`Invalid environment configuration (check server/${file}):`);
  for (const [key, messages] of Object.entries(z.flattenError(result.error).fieldErrors)) {
    console.error(`  ${key}: ${messages.join('; ')}`);
  }
  process.exit(1);
}

export const env = result.data;
export const isProd = env.NODE_ENV === 'production';
