// Vitest settings: tests run against the real resolvd_test database configured in .env.test.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Makes src/config/env.js load .env.test instead of .env.
    env: { NODE_ENV: 'test' },
    // Migrates and reseeds resolvd_test once per run, so every run starts from the same data.
    globalSetup: './tests/globalSetup.js',
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 15000,
    // Used by `npm run test:coverage` only. Reported, never enforced: a percentage target
    // rewards testing easy lines rather than the risky ones.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js', 'scripts/lib/**/*.js'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
