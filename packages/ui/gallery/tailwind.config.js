/** @type {import('tailwindcss').Config} */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preset from '../tailwind-preset.js';

const here = dirname(fileURLToPath(import.meta.url));

export default {
  presets: [preset],
  content: [
    resolve(here, 'index.html'),
    resolve(here, 'main.tsx'),
    resolve(here, '../src/**/*.{ts,tsx}'),
  ],
};
