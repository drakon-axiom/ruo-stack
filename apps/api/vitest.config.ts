import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    // DB-integration tests self-skip unless RUN_DB_TESTS=1 (see test/integration).
  },
});
