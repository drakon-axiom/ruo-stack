/** @type {import('tailwindcss').Config} */
// All theme values live in @ruostack/ui so the two apps cannot drift apart.
import preset from '@ruostack/ui/tailwind-preset';

export default {
  presets: [preset],
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
