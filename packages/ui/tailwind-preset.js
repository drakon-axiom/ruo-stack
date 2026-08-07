/** @type {import('tailwindcss').Config} */

/* Shared by apps/brand-web and apps/admin-web. Colours resolve to the CSS
 * custom properties in src/tokens.css, which is what makes light mode free —
 * components reference var(--surface-1) and .dark swaps the value.
 *
 * Why color-mix() rather than a bare `var(--accent)`:
 * Tailwind v3 SILENTLY DROPS opacity-modified utilities when a colour is a bare
 * CSS variable. `border-accent/40` produced no rule at all — not a warning, not
 * invalid CSS, simply nothing, so the border rendered colourless. Wrapping in
 * color-mix() with the <alpha-value> placeholder makes both `bg-accent` and
 * `bg-accent/40` emit correct CSS. Verified against tailwindcss 3.4 before use.
 */
const v = (name) =>
  `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: v('--canvas'),
        'surface-1': v('--surface-1'),
        'surface-2': v('--surface-2'),
        'surface-3': v('--surface-3'),
        field: v('--field'),
        line: {
          subtle: v('--border-subtle'),
          DEFAULT: v('--border-default'),
          strong: v('--border-strong'),
        },
        content: {
          DEFAULT: v('--text'),
          muted: v('--text-muted'),
          faint: v('--text-faint'),
        },
        accent: {
          DEFAULT: v('--accent'),
          hover: v('--accent-hover'),
          solid: v('--accent-solid'),
          // Tints are already a color-mix against the surface; they are used
          // plainly (bg-accent-tint) and never with an opacity modifier.
          tint: 'var(--accent-tint)',
        },
        success: { DEFAULT: v('--success'), tint: 'var(--success-tint)' },
        warning: { DEFAULT: v('--warning'), tint: 'var(--warning-tint)' },
        danger: { DEFAULT: v('--danger'), tint: 'var(--danger-tint)' },
        info: { DEFAULT: v('--info'), tint: 'var(--info-tint)' },
      },
      boxShadow: {
        e1: 'var(--elev-1), var(--inner-highlight)',
        e2: 'var(--elev-2)',
        e3: 'var(--elev-3)',
        accent: 'var(--elev-accent)',
      },
      backgroundImage: {
        'surface-raised': 'var(--surface-1-gradient)',
      },
      fontSize: {
        '2xs': ['11px', '16px'],
        xs: ['12px', '18px'],
        sm: ['13px', '20px'],
        base: ['14px', '22px'],
        lg: ['16px', '24px'],
        xl: ['20px', '28px'],
        '2xl': ['24px', '32px'],
        '3xl': ['30px', '38px'],
        '4xl': ['38px', '46px'],
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '12px', pill: '999px' },
      ringColor: { focus: 'var(--ring)' },
      transitionDuration: { fast: '120ms', pop: '180ms', sheet: '240ms' },
    },
  },
  plugins: [],
};
