import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    // DB-integration tests self-skip unless RUN_DB_TESTS=1 (see test/integration).
    // Generous timeout: integration tests chain several round-trips to the
    // remote Supabase pooler (~1s each); offline unit tests are unaffected.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
