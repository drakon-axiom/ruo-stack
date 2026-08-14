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
  server: { host: true, port: 3903 },
  build: {
    rollupOptions: {
      output: {
        // Pin the dependencies that never change on a deploy into their own
        // chunks. Without this they share the entry chunk, so editing one line
        // of app code re-hashes ~158 kB and every browser (and the edge asset
        // cache) refetches React and supabase-js along with it. Split out, a
        // normal deploy invalidates only the small app chunk.
        //
        // Route screens are already separate chunks via React.lazy in App.tsx --
        // this is only about what remains in the entry.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
