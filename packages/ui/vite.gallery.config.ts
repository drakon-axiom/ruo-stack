import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Serves the component harness used by the responsive regression gate.
export default defineConfig({
  root: 'gallery',
  plugins: [react()],
  server: { host: true, port: 4177, strictPort: true },
});
