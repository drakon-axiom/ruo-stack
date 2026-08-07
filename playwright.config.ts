import { defineConfig } from '@playwright/test';

/* Drives the @ruostack/ui component harness rather than either app: every
 * meaningful app screen is behind auth, so a browser hitting the real app can
 * only reach the login page — which exercises none of the shell or table
 * behaviour this suite exists to protect. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'list' : 'line',
  use: { baseURL: 'http://localhost:4177' },
  webServer: {
    command: 'pnpm --filter @ruostack/ui gallery',
    url: 'http://localhost:4177',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
