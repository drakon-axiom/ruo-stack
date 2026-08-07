import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the Tailwind config absolutely: PostCSS resolves a relative `config`
// against process.cwd(), which differs depending on whether this is run from
// the repo root or from packages/ui, and a wrong path fails silently by
// emitting no utilities at all.
const here = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: resolve(here, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
