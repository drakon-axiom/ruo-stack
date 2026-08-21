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
    // DB-integration tests (RUN_DB_TESTS=1) run against ONE real, shared
    // database — never a disposable per-file schema. Two integration files
    // that touch the same live rows (seed-plans.test.ts and
    // plan-price.test.ts both mutate pro/volume's single active `plan_price`
    // row) race each other under Vitest's default parallel file execution,
    // silently corrupting shared state — exactly the "silently deactivated
    // the real production price rows" failure mode plan-price.test.ts's
    // header comment warns about. Force test FILES to run one at a time
    // whenever DB tests are in play; a plain `pnpm test` (RUN_DB_TESTS
    // unset, every integration suite self-skipping) keeps full parallelism
    // since nothing shared is actually touched.
    fileParallelism: process.env.RUN_DB_TESTS !== '1',
  },
});
