import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Load env from the monorepo root .env (only VITE_-prefixed vars reach the client).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  // host:true binds 0.0.0.0 so the dev server is reachable over the LAN/Tailscale.
  server: { host: true, port: 3902 },
});
