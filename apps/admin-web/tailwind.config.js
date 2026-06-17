/** @type {import('tailwindcss').Config} */
// RUOStack palette (navy/teal/white) over the Pepify dark surface tokens.
// Teal is the brand accent; a DISTINCT green is kept for success/status so
// status never reads as the accent.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#1F2A44',
        teal: { DEFAULT: '#1D9E75', bright: '#25c089' },
        success: '#28c76f',
        bg: '#080b14',
        bg2: '#0d1220',
        card: '#121829',
        card2: '#161d31',
        line: '#222a40',
        line2: '#2c3550',
        text: '#e8ecf5',
        muted: '#9aa3bd',
        faint: '#6b7490',
        amber: '#ff9f43',
        danger: '#ea5455',
      },
      borderRadius: { DEFAULT: '14px', card: '12px', pill: '999px' },
      fontFamily: {
        sans: ['"Segoe UI"', '-apple-system', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
