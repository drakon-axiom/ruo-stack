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
  build: {
    rollupOptions: {
      output: {
        // See apps/brand-web/vite.config.ts for the reasoning. No supabase entry
        // here: admin-web authenticates against the API's own admin JWT and does
        // not depend on @supabase/supabase-js at all.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
