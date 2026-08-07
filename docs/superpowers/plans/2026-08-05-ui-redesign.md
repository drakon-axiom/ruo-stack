# RUOStack UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both front ends' ad-hoc styling with one shared, responsive, accessible design system, and migrate all 33 screens onto it.

**Architecture:** A new source-only workspace package `@ruostack/ui` holds CSS-custom-property tokens, a Tailwind preset both apps consume, and every shared component. Both apps drop their duplicated Tailwind configs and their hand-rolled shells. Screens migrate onto a single `DataTable` that renders a real table on desktop and stacked cards on phones. No compatibility shim: the legacy `@layer components` blocks survive until every screen is migrated, then are deleted in one task.

**Tech Stack:** React 18, Vite 5, Tailwind 3.4, TypeScript 5.6, Radix UI, lucide-react, cmdk, Fontsource, Vitest 2.1.5 + Testing Library + jsdom, Playwright.

## Global Constraints

- **Package pattern:** `@ruostack/ui` is source-only — `"main": "./src/index.ts"`, no build step, exactly like `packages/shared` and `packages/payments`. Do not add a bundler to it.
- **Node:** `>=20` per `engines`; CI runs Node 22 (pnpm 11.3.0 requires `node:sqlite`).
- **Package manager:** pnpm 11.3.0. Workspace deps use `"workspace:*"`.
- **Test runner:** Vitest `^2.1.5` (match the version already in `packages/payments`). Each package exposes `"test": "vitest run"` so root `pnpm -r test` picks it up.
- **Tokens are CSS custom properties.** Components reference semantic Tailwind names that resolve to `var(--…)`. Never hard-code a hex value in a component.
- **No arbitrary font sizes.** `text-[13.5px]` and friends are forbidden; use the scale in Task 1.
- **Contrast floor:** every token pair ≥ 4.5:1 in both themes, enforced by `scripts/check-contrast.mjs` in CI.
- **Reduced motion:** one global `@media (prefers-reduced-motion: reduce)` block; never per component.
- **Presentation only.** No API, Prisma, routing-semantics, or auth changes. `@ruostack/ui` imports no app code and no `@ruostack/shared` domain types.
- **Exact token values** are in `docs/superpowers/specs/2026-08-05-ui-redesign-design.md` §5 and reproduced in Task 1. `--accent-solid` is `#13805F` (not `#158A68`, which fails AA at 4.31:1).
- **Branch:** `feat/ui-redesign`, already created.

---

## File Structure

**New package — `packages/ui/`**

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | Package wiring |
| `tailwind-preset.js` | Maps CSS vars → Tailwind theme; consumed by both apps |
| `src/tokens.css` | `:root` + `.dark` custom properties, base layer, reduced-motion block |
| `src/index.ts` | Public barrel |
| `src/icons.ts` | Curated lucide re-exports — the only lucide import site |
| `src/lib/cn.ts` | `clsx` + `tailwind-merge` class joiner |
| `src/hooks/useTheme.tsx` | `ThemeProvider` + `useTheme` |
| `src/hooks/useMediaQuery.ts` | Breakpoint hook used by `DataTable` |
| `src/primitives/*.tsx` | Button, Badge, StatusPill, Card, KpiTile, Input, Textarea, Select, Checkbox, Switch, Field, EmptyState, Skeleton, Spinner |
| `src/overlays/*.tsx` | Dialog, Drawer, DropdownMenu, Popover, Tooltip |
| `src/data/*.tsx` | DataTable, Tabs, Toolbar, Pagination |
| `src/nav/*.tsx` | AppShell, Sidebar, IconRail, BottomTabs, PageHeader, CommandPalette |
| `src/feedback/*.tsx` | Toaster, InlineAlert |

**Modified**

| File | Change |
|---|---|
| `pnpm-workspace.yaml` | No change needed — `packages/*` already globs it |
| `scripts/check-contrast.mjs` | **Create** — token contrast gate |
| `.github/workflows/ci.yml` | Add contrast gate step |
| `apps/*/tailwind.config.js` | Collapse onto the preset |
| `apps/*/src/index.css` | Import tokens; legacy `@layer components` deleted in Task 24 |
| `apps/*/src/components/Shell.tsx` | Replaced by `AppShell` |
| `apps/admin-web/src/components/ui.tsx` | **Deleted** in Task 10 |
| 33 screens + `ProvisioningWizard` | Migrated in Tasks 11–23 |

---

## Task 1: Package skeleton, tokens, preset, and the CI contrast gate

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/tailwind-preset.js`, `packages/ui/src/tokens.css`, `packages/ui/src/index.ts`, `packages/ui/src/lib/cn.ts`
- Create: `scripts/check-contrast.mjs`
- Modify: `.github/workflows/ci.yml`, root `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `@ruostack/ui` resolvable as a workspace package; `cn(...classes: ClassValue[]): string`; Tailwind colour names `canvas`, `surface-1|2|3`, `line-subtle|line|line-strong`, `content|content-muted|content-faint`, `accent|accent-hover|accent-solid|accent-tint`, `success|warning|danger|info` (+ `-tint`); shadows `shadow-e1|e2|e3|accent`; font sizes `text-2xs|xs|sm|base|lg|xl|2xl|3xl|4xl`; `npm run lint:contrast`

- [ ] **Step 1: Create the package manifest**

`packages/ui/package.json`:

```json
{
  "name": "@ruostack/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./tokens.css": "./src/tokens.css",
    "./tailwind-preset": "./tailwind-preset.js"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4"
  },
  "peerDependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
```

- [ ] **Step 2: Create the package tsconfig**

`packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "types": []
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the token stylesheet**

`packages/ui/src/tokens.css` — values copied verbatim from spec §5.1/5.2:

```css
:root {
  --canvas: #F6F8FC;
  --surface-1: #FFFFFF;
  --surface-2: #FFFFFF;
  --surface-3: #EDF1F7;
  --border-subtle: #E4E9F2;
  --border-default: #DDE3EE;
  --border-strong: #C7D0E0;
  --text: #131A2B;
  --text-muted: #55607A;
  --text-faint: #656F88;
  --accent: #0F7A5C;
  --accent-hover: #0C6349;
  --accent-solid: #13805F;
  --success: #1F7A43;
  --warning: #8A5B10;
  --danger: #C13540;
  --info: #1F5FD0;
  --ring: #0F7A5C;

  --accent-tint: color-mix(in srgb, var(--accent) 12%, var(--surface-1));
  --success-tint: color-mix(in srgb, var(--success) 12%, var(--surface-1));
  --warning-tint: color-mix(in srgb, var(--warning) 12%, var(--surface-1));
  --danger-tint: color-mix(in srgb, var(--danger) 12%, var(--surface-1));
  --info-tint: color-mix(in srgb, var(--info) 12%, var(--surface-1));

  /* Light: elevation is shadow-only, no inner highlight. */
  --elev-1: 0 1px 2px rgb(19 26 43 / .04), 0 4px 12px -4px rgb(19 26 43 / .08);
  --elev-2: 0 8px 24px -8px rgb(19 26 43 / .16);
  --elev-3: 0 24px 56px -16px rgb(19 26 43 / .22);
  --elev-accent: 0 6px 16px -6px rgb(19 128 95 / .45);
  --surface-1-gradient: var(--surface-1);
  --inner-highlight: 0 0 0 0 transparent;
}

.dark {
  --canvas: #0A0E16;
  --surface-1: #111725;
  --surface-2: #171E2E;
  --surface-3: #1E2739;
  --border-subtle: #232C40;
  --border-default: #2E3850;
  --border-strong: #3B4763;
  --text: #E9EDF6;
  --text-muted: #98A2BA;
  --text-faint: #7C87A3;
  --accent: #17A67D;
  --accent-hover: #2ACB9A;
  --accent-solid: #13805F;
  --success: #5BC46F;
  --warning: #E7AC4A;
  --danger: #F0656B;
  --info: #5B9CF6;
  --ring: #2ACB9A;

  --accent-tint: color-mix(in srgb, var(--accent) 14%, var(--surface-1));
  --success-tint: color-mix(in srgb, var(--success) 14%, var(--surface-1));
  --warning-tint: color-mix(in srgb, var(--warning) 14%, var(--surface-1));
  --danger-tint: color-mix(in srgb, var(--danger) 14%, var(--surface-1));
  --info-tint: color-mix(in srgb, var(--info) 14%, var(--surface-1));

  --elev-1: 0 8px 18px -10px rgb(0 0 0 / .9);
  --elev-2: 0 14px 32px -12px rgb(0 0 0 / .95);
  --elev-3: 0 28px 64px -20px rgb(0 0 0 / .95);
  --elev-accent: 0 6px 16px -6px rgb(23 166 125 / .75);
  --surface-1-gradient: linear-gradient(180deg, var(--surface-2), var(--surface-1));
  --inner-highlight: inset 0 1px 0 rgb(255 255 255 / .055);
}

@layer base {
  html { color-scheme: light; }
  html.dark { color-scheme: dark; }
  body {
    margin: 0;
    background: var(--canvas);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }
  /* Every interactive element gets a visible focus ring. Replaces the
     `outline-none` + border-colour-only pattern the old CSS used. */
  :where(a, button, input, select, textarea, [tabindex]):focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 4: Write the Tailwind preset**

`packages/ui/tailwind-preset.js`:

```js
/** Shared by apps/brand-web and apps/admin-web. Colours resolve to the CSS
 *  custom properties in src/tokens.css, which is what makes light mode free. */
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        'surface-1': 'var(--surface-1)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        line: {
          subtle: 'var(--border-subtle)',
          DEFAULT: 'var(--border-default)',
          strong: 'var(--border-strong)',
        },
        content: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
          faint: 'var(--text-faint)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          solid: 'var(--accent-solid)',
          tint: 'var(--accent-tint)',
        },
        success: { DEFAULT: 'var(--success)', tint: 'var(--success-tint)' },
        warning: { DEFAULT: 'var(--warning)', tint: 'var(--warning-tint)' },
        danger: { DEFAULT: 'var(--danger)', tint: 'var(--danger-tint)' },
        info: { DEFAULT: 'var(--info)', tint: 'var(--info-tint)' },
      },
      boxShadow: {
        e1: 'var(--elev-1), var(--inner-highlight)',
        e2: 'var(--elev-2)',
        e3: 'var(--elev-3)',
        accent: 'var(--elev-accent)',
      },
      backgroundImage: { 'surface-raised': 'var(--surface-1-gradient)' },
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
```

- [ ] **Step 5: Write the class joiner and barrel**

`packages/ui/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
```

`packages/ui/src/index.ts`:

```ts
export { cn } from './lib/cn.js';
```

- [ ] **Step 6: Write the contrast gate**

`scripts/check-contrast.mjs` — parses the real token values out of `tokens.css` so the gate cannot drift from the stylesheet:

```js
#!/usr/bin/env node
// Fails CI if any RUOStack token pair drops below WCAG AA (4.5:1) in either theme.
// Values are read from packages/ui/src/tokens.css so this can never disagree
// with what actually ships.
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../packages/ui/src/tokens.css', import.meta.url), 'utf8');

function block(selector) {
  const m = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`Could not find ${selector} block in tokens.css`);
  const out = {};
  for (const [, k, v] of m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[k] = v;
  return out;
}

const lum = (hex) => {
  const [r, g, b] = hex.replace('#', '').match(/../g).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const FG = ['text', 'text-muted', 'text-faint', 'accent', 'success', 'warning', 'danger', 'info'];
const BG = ['surface-1', 'canvas'];
const MIN = 4.5;

let failures = 0;
for (const [theme, sel] of [['LIGHT', ':root'], ['DARK', '\\.dark']]) {
  const t = block(sel);
  console.log(`\n=== ${theme} ===`);
  for (const bg of BG) {
    for (const fg of FG) {
      if (!t[fg] || !t[bg]) throw new Error(`Missing token ${fg} or ${bg} in ${theme}`);
      const r = ratio(t[fg], t[bg]);
      const ok = r >= MIN;
      if (!ok) failures++;
      console.log(`  ${`${fg} / ${bg}`.padEnd(24)} ${r.toFixed(2).padStart(5)}:1  ${ok ? 'PASS' : '** FAIL **'}`);
    }
  }
  // The primary button always renders a white label on --accent-solid.
  const btn = ratio('#FFFFFF', t['accent-solid']);
  const okBtn = btn >= MIN;
  if (!okBtn) failures++;
  console.log(`  ${'white / accent-solid'.padEnd(24)} ${btn.toFixed(2).padStart(5)}:1  ${okBtn ? 'PASS' : '** FAIL **'}`);
}

console.log(failures === 0 ? '\nAll token pairs meet WCAG AA.\n' : `\n${failures} pair(s) below ${MIN}:1\n`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 7: Run the gate to verify it passes**

Run: `node scripts/check-contrast.mjs`
Expected: PASS for all pairs in both themes, exit 0. Dark `text-faint / surface-1` should read `4.99:1`; `white / accent-solid` should read `4.91:1` in both themes.

- [ ] **Step 8: Prove the gate actually fails on a bad value**

Temporarily change `--accent-solid` in the `.dark` block of `tokens.css` to `#158A68`, then run `node scripts/check-contrast.mjs`.
Expected: `white / accent-solid  4.31:1  ** FAIL **`, exit 1.
**Revert the change back to `#13805F`** and re-run to confirm exit 0.

- [ ] **Step 9: Wire the gate into CI and root scripts**

Add to root `package.json` scripts, after `lint:stripe-guard`:

```json
"lint:contrast": "node scripts/check-contrast.mjs",
```

In `.github/workflows/ci.yml`, add a step to the `checks` job immediately after the `Payments-isolation guard` step:

```yaml
      # Design tokens must meet WCAG AA in both themes.
      - name: Token contrast gate
        run: pnpm lint:contrast
```

- [ ] **Step 10: Install and typecheck**

Run: `pnpm install && pnpm --filter @ruostack/ui typecheck`
Expected: install succeeds, typecheck clean.

- [ ] **Step 11: Commit**

```bash
git add packages/ui scripts/check-contrast.mjs package.json pnpm-lock.yaml .github/workflows/ci.yml
git commit -m "Add @ruostack/ui package with tokens, Tailwind preset, and a CI contrast gate"
```

---

## Task 2: Test harness and theme provider

**Files:**
- Create: `packages/ui/vitest.config.ts`, `packages/ui/src/test/setup.ts`
- Create: `packages/ui/src/hooks/useTheme.tsx`, `packages/ui/src/hooks/useTheme.test.tsx`
- Create: `packages/ui/src/hooks/useMediaQuery.ts`
- Modify: `packages/ui/package.json`, `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn` (Task 1)
- Produces:
  - `type Theme = 'light' | 'dark' | 'system'`
  - `<ThemeProvider storageKey={string}>` — resolves `system` from `prefers-color-scheme`, toggles `.dark` on `<html>`
  - `useTheme(): { theme: Theme; resolved: 'light' | 'dark'; setTheme(t: Theme): void }`
  - `useMediaQuery(query: string): boolean`

- [ ] **Step 1: Add test dependencies**

Add to `packages/ui/package.json` `devDependencies`:

```json
"@testing-library/react": "^16.0.1",
"@testing-library/user-event": "^14.5.2",
"@testing-library/jest-dom": "^6.6.3",
"jsdom": "^25.0.1"
```

Run: `pnpm install`

- [ ] **Step 2: Configure Vitest**

`packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

Add `"@vitejs/plugin-react": "^4.3.3"` to `devDependencies` and run `pnpm install`.

`packages/ui/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';

// jsdom has no matchMedia; components and hooks depend on it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
```

- [ ] **Step 3: Write the failing theme test**

`packages/ui/src/hooks/useTheme.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './useTheme.js';

function Probe() {
  const { theme, resolved, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setTheme('light')}>light</button>
    </div>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('defaults to system when nothing is stored', () => {
    render(<ThemeProvider storageKey="t"><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
  });

  it('preserves an existing stored value as an explicit override', () => {
    localStorage.setItem('t', 'dark');
    render(<ThemeProvider storageKey="t"><Probe /></ThemeProvider>);
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('setTheme persists and flips the html class', () => {
    localStorage.setItem('t', 'dark');
    render(<ThemeProvider storageKey="t"><Probe /></ThemeProvider>);
    act(() => { screen.getByText('light').click(); });
    expect(localStorage.getItem('t')).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/ui test`
Expected: FAIL — cannot resolve `./useTheme.js`.

- [ ] **Step 5: Implement the theme provider**

`packages/ui/src/hooks/useTheme.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

interface ThemeCtx { theme: Theme; resolved: Resolved; setTheme: (t: Theme) => void }

const Ctx = createContext<ThemeCtx | null>(null);

const isTheme = (v: string | null): v is Theme => v === 'light' || v === 'dark' || v === 'system';

export function ThemeProvider({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  // Migration: brand-web already persists 'light' | 'dark' under `ruostack_theme`
  // and defaults dark. An existing value is honoured as an explicit override so
  // returning users do not get a surprise theme flip; only an absent value
  // falls through to the OS preference.
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey);
    return isTheme(stored) ? stored : 'system';
  });

  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: Resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, [resolved]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(storageKey, t);
  }, [storageKey]);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/ui test`
Expected: 3 tests PASS.

- [ ] **Step 7: Add the media-query hook**

`packages/ui/src/hooks/useMediaQuery.ts`:

```ts
import { useEffect, useState } from 'react';

/** SSR-safe; used by DataTable to pick table vs card rendering. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
```

Export both from `src/index.ts`:

```ts
export { cn } from './lib/cn.js';
export { ThemeProvider, useTheme, type Theme } from './hooks/useTheme.js';
export { useMediaQuery } from './hooks/useMediaQuery.js';
```

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm --filter @ruostack/ui test && pnpm --filter @ruostack/ui typecheck`
Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "Add UI test harness, ThemeProvider with localStorage migration, and useMediaQuery"
```

---

## Task 3: Icon module and Button

**Files:**
- Create: `packages/ui/src/icons.ts`, `packages/ui/src/primitives/Button.tsx`, `packages/ui/src/primitives/Button.test.tsx`
- Modify: `packages/ui/package.json`, `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn`
- Produces:
  - `icons.ts` re-exports `type LucideIcon` plus the named icons used across the apps
  - `<Button variant?: 'primary'|'ghost'|'danger' size?: 'sm'|'md' loading?: boolean icon?: LucideIcon>` extending `ButtonHTMLAttributes<HTMLButtonElement>`

- [ ] **Step 1: Add lucide**

Add `"lucide-react": "^0.460.0"` to `packages/ui/package.json` `dependencies`, then `pnpm install`.

- [ ] **Step 2: Create the curated icon module**

`packages/ui/src/icons.ts` — the single lucide import site so the set stays tree-shaken and consistent:

```ts
export type { LucideIcon } from 'lucide-react';
export {
  LayoutDashboard, Package, Truck, ShieldAlert, AlertTriangle, Users, BookUser,
  Wallet, Store, FlaskConical, FileCheck2, Palette, Ship, Calculator,
  MessagesSquare, Gift, UsersRound, Settings, Bell, Search, Menu, X, Check, Circle,
  ChevronDown, ChevronRight, ChevronLeft, Plus, Sun, Moon, Monitor, LogOut,
  MoreHorizontal, PanelLeftClose, PanelLeftOpen, Loader2, Inbox, Megaphone,
  ScrollText, ClipboardList, Scale, GitCompareArrows, ListChecks, BarChart3,
} from 'lucide-react';
```

- [ ] **Step 3: Write the failing Button test**

`packages/ui/src/primitives/Button.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button.js';

describe('Button', () => {
  it('renders its label and fires onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>New order</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'New order' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('uses the solid accent for the primary variant', () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-accent-solid');
  });

  it('is disabled and announces busy while loading', () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('meets the 44px mobile tap target', () => {
    render(<Button>Tap</Button>);
    expect(screen.getByRole('button')).toHaveClass('min-h-11');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/ui test Button`
Expected: FAIL — cannot resolve `./Button.js`.

- [ ] **Step 5: Implement Button**

`packages/ui/src/primitives/Button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';
import { Loader2, type LucideIcon } from '../icons.js';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: LucideIcon;
}

const VARIANT = {
  primary: 'bg-accent-solid text-white shadow-accent hover:brightness-110',
  ghost: 'border border-line text-content-muted hover:text-content hover:bg-surface-3',
  danger: 'border border-danger/50 text-danger hover:bg-danger-tint',
} as const;

const SIZE = {
  // min-h-11 is 44px — the mobile tap-target floor.
  sm: 'min-h-11 px-3.5 text-xs md:min-h-0 md:py-1.5',
  md: 'min-h-11 px-4 text-sm md:min-h-0 md:py-2',
} as const;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon: Icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-pill font-semibold',
        'transition-[background,color,filter] duration-fast disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : Icon ? <Icon aria-hidden className="h-4 w-4" /> : null}
      {children}
    </button>
  );
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/ui test Button`
Expected: 4 tests PASS.

- [ ] **Step 7: Export and commit**

Add to `src/index.ts`:

```ts
export { Button, type ButtonProps } from './primitives/Button.js';
export * from './icons.js';
```

```bash
pnpm --filter @ruostack/ui test && pnpm --filter @ruostack/ui typecheck
git add packages/ui pnpm-lock.yaml
git commit -m "Add curated lucide icon module and the Button primitive"
```

---

## Task 4: Surface primitives — Card, KpiTile, Badge, StatusPill, EmptyState, Skeleton

**Files:**
- Create: `packages/ui/src/primitives/Card.tsx`, `KpiTile.tsx`, `Badge.tsx`, `StatusPill.tsx`, `EmptyState.tsx`, `Skeleton.tsx`
- Create: `packages/ui/src/primitives/surfaces.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn`, `Button`
- Produces:
  - `<Card as?: ElementType className?: string>` — elevation-1 surface
  - `<KpiTile label: string value: ReactNode tone?: 'default'|'warning'|'accent'>`
  - `<Badge tone?: 'neutral'|'accent'|'success'|'warning'|'danger'|'info'>`
  - `<StatusPill value: string>` — maps snake_case status to tone + human label
  - `<EmptyState title: string hint?: string action?: ReactNode>`
  - `<Skeleton className?: string>`, `<SkeletonRows count: number>`

- [ ] **Step 1: Write the failing test**

`packages/ui/src/primitives/surfaces.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card.js';
import { KpiTile } from './KpiTile.js';
import { StatusPill } from './StatusPill.js';
import { EmptyState } from './EmptyState.js';

describe('surface primitives', () => {
  it('Card carries elevation 1 and the raised gradient', () => {
    render(<Card data-testid="c">body</Card>);
    const el = screen.getByTestId('c');
    expect(el).toHaveClass('shadow-e1');
    expect(el).toHaveClass('bg-surface-raised');
  });

  it('KpiTile renders value and label', () => {
    render(<KpiTile label="Orders today" value={18} />);
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('Orders today')).toBeInTheDocument();
  });

  it('KpiTile applies the warning tone to its figure', () => {
    render(<KpiTile label="Action required" value={2} tone="warning" />);
    expect(screen.getByText('2')).toHaveClass('text-warning');
  });

  it('StatusPill humanises snake_case and picks a tone', () => {
    render(<StatusPill value="out_of_stock" />);
    const pill = screen.getByText('out of stock');
    expect(pill).toHaveClass('text-danger');
  });

  it('EmptyState renders title, hint and action', () => {
    render(<EmptyState title="No orders yet" hint="Create your first order." action={<button>New</button>} />);
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first order.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/ui test surfaces`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement Card and KpiTile**

`packages/ui/src/primitives/Card.tsx`:

```tsx
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-card border border-line-subtle bg-surface-raised shadow-e1',
          'dark:border-t-line',
          className,
        )}
        {...rest}
      />
    );
  },
);
```

`packages/ui/src/primitives/KpiTile.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Card } from './Card.js';

const TONE = {
  default: 'text-content',
  warning: 'text-warning',
  accent: 'text-accent',
} as const;

export function KpiTile({
  label, value, tone = 'default',
}: { label: string; value: ReactNode; tone?: keyof typeof TONE }) {
  return (
    <Card className="p-4">
      <div className={cn('text-3xl font-extrabold tabular-nums tracking-tight', TONE[tone])}>{value}</div>
      <div className="mt-0.5 text-xs text-content-muted">{label}</div>
    </Card>
  );
}
```

- [ ] **Step 4: Implement Badge and StatusPill**

`packages/ui/src/primitives/Badge.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-3 text-content-muted',
  accent: 'border-accent/40 bg-accent-tint text-accent',
  success: 'border-success/40 bg-success-tint text-success',
  warning: 'border-warning/40 bg-warning-tint text-warning',
  danger: 'border-danger/40 bg-danger-tint text-danger',
  info: 'border-info/40 bg-info-tint text-info',
};

export function Badge({
  tone = 'neutral', className, children,
}: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-xs font-medium', TONE[tone], className)}>
      {children}
    </span>
  );
}
```

`packages/ui/src/primitives/StatusPill.tsx`:

```tsx
import { Badge, type BadgeTone } from './Badge.js';

// Covers every status string the two apps render today.
const TONE: Record<string, BadgeTone> = {
  in_stock: 'success', active: 'success', delivered: 'success', shipped: 'success',
  approved: 'success', paid: 'success', resolved: 'success',
  soon: 'warning', pending: 'warning', processing: 'warning',
  ready_for_fulfillment: 'accent', awaiting_funds: 'warning', open: 'warning',
  out_of_stock: 'danger', suspended: 'danger', cancelled: 'danger',
  rejected: 'danger', failed: 'danger',
};

export function StatusPill({ value }: { value: string }) {
  return <Badge tone={TONE[value] ?? 'neutral'}>{value.replace(/_/g, ' ')}</Badge>;
}
```

- [ ] **Step 5: Implement EmptyState and Skeleton**

`packages/ui/src/primitives/EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Card } from './Card.js';

export function EmptyState({
  title, hint, action,
}: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="text-lg font-semibold text-content">{title}</div>
      {hint && <div className="max-w-md text-sm text-content-muted">{hint}</div>}
      {action}
    </Card>
  );
}
```

`packages/ui/src/primitives/Skeleton.tsx`:

```tsx
import { cn } from '../lib/cn.js';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded bg-surface-3', className)} />;
}

export function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/ui test surfaces`
Expected: 5 tests PASS.

- [ ] **Step 7: Export and commit**

Add to `src/index.ts`:

```ts
export { Card } from './primitives/Card.js';
export { KpiTile } from './primitives/KpiTile.js';
export { Badge, type BadgeTone } from './primitives/Badge.js';
export { StatusPill } from './primitives/StatusPill.js';
export { EmptyState } from './primitives/EmptyState.js';
export { Skeleton, SkeletonRows } from './primitives/Skeleton.js';
```

```bash
pnpm --filter @ruostack/ui test && pnpm --filter @ruostack/ui typecheck
git add packages/ui && git commit -m "Add Card, KpiTile, Badge, StatusPill, EmptyState and Skeleton primitives"
```

---

## Task 5: Form primitives — Field, Input, Textarea, Select, Checkbox, Switch

**Files:**
- Create: `packages/ui/src/primitives/Field.tsx`, `Input.tsx`, `Textarea.tsx`, `Select.tsx`, `Checkbox.tsx`, `Switch.tsx`
- Create: `packages/ui/src/primitives/forms.test.tsx`
- Modify: `packages/ui/src/index.ts`, `packages/ui/package.json`

**Interfaces:**
- Consumes: `cn`, `Check`/`ChevronDown` icons
- Produces:
  - `<Field label: string htmlFor?: string hint?: string error?: string required?: boolean>` — renders `<label>`, associates hint/error via `aria-describedby`
  - `<Input>` / `<Textarea>` extending the native props, adding `invalid?: boolean`
  - `<Select options: {value: string; label: string}[] value onValueChange placeholder?>` (Radix Select)
  - `<Checkbox checked onCheckedChange label: string>` (Radix Checkbox)
  - `<Switch checked onCheckedChange label: string>` (Radix Switch)

- [ ] **Step 1: Add Radix form deps**

Add to `packages/ui/package.json` `dependencies`, then `pnpm install`:

```json
"@radix-ui/react-select": "^2.1.2",
"@radix-ui/react-checkbox": "^1.1.2",
"@radix-ui/react-switch": "^1.1.1"
```

- [ ] **Step 2: Write the failing test**

`packages/ui/src/primitives/forms.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field } from './Field.js';
import { Input } from './Input.js';
import { Checkbox } from './Checkbox.js';

describe('form primitives', () => {
  it('Field associates its label with the control', () => {
    render(<Field label="Recipient name" htmlFor="rn"><Input id="rn" /></Field>);
    expect(screen.getByLabelText('Recipient name')).toBeInTheDocument();
  });

  it('Field exposes an error to screen readers and marks the control invalid', () => {
    render(<Field label="Email" htmlFor="em" error="Required"><Input id="em" invalid /></Field>);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(input.getAttribute('aria-describedby')).toContain('em-error');
  });

  it('Input does not suppress the focus outline', () => {
    render(<Input aria-label="x" />);
    expect(screen.getByLabelText('x')).not.toHaveClass('outline-none');
  });

  it('Checkbox toggles', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} label="Remember me" />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Remember me' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/ui test forms`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement Field, Input, Textarea**

`packages/ui/src/primitives/Field.tsx`:

```tsx
import type { ReactNode } from 'react';

export function Field({
  label, htmlFor, hint, error, required, children,
}: {
  label: string; htmlFor?: string; hint?: string; error?: string;
  required?: boolean; children: ReactNode;
}) {
  return (
    <div className="mb-3">
      <label htmlFor={htmlFor} className="mb-1 block text-2xs font-medium uppercase tracking-[0.1em] text-content-faint">
        {label}
        {required && <span aria-hidden className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="mt-1 text-xs text-content-faint">{hint}</p>
      )}
      {error && (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="mt-1 text-xs text-danger">{error}</p>
      )}
    </div>
  );
}
```

`packages/ui/src/primitives/Input.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, id, ...rest }, ref,
) {
  return (
    <input
      ref={ref}
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && id ? `${id}-error` : undefined}
      className={cn(
        'min-h-11 w-full rounded-[10px] border bg-surface-1 px-3 text-base text-content',
        'placeholder:text-content-faint transition-colors duration-fast md:min-h-0 md:py-2 md:text-sm',
        invalid ? 'border-danger' : 'border-line focus:border-accent',
        className,
      )}
      {...rest}
    />
  );
});
```

`packages/ui/src/primitives/Textarea.tsx`:

```tsx
import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, id, ...rest }, ref,
) {
  return (
    <textarea
      ref={ref}
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid && id ? `${id}-error` : undefined}
      className={cn(
        'w-full rounded-[10px] border bg-surface-1 px-3 py-2 text-sm text-content',
        'placeholder:text-content-faint transition-colors duration-fast',
        invalid ? 'border-danger' : 'border-line focus:border-accent',
        className,
      )}
      {...rest}
    />
  );
});
```

- [ ] **Step 5: Implement Select, Checkbox, Switch**

`packages/ui/src/primitives/Select.tsx`:

```tsx
import * as RS from '@radix-ui/react-select';
import { cn } from '../lib/cn.js';
import { Check, ChevronDown } from '../icons.js';

export interface SelectOption { value: string; label: string }

export function Select({
  options, value, onValueChange, placeholder = 'Select…', id, className,
}: {
  options: SelectOption[]; value: string; onValueChange: (v: string) => void;
  placeholder?: string; id?: string; className?: string;
}) {
  return (
    <RS.Root value={value} onValueChange={onValueChange}>
      <RS.Trigger
        id={id}
        className={cn(
          'inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-[10px]',
          'border border-line bg-surface-1 px-3 text-base text-content md:min-h-0 md:py-2 md:text-sm',
          className,
        )}
      >
        <RS.Value placeholder={placeholder} />
        <ChevronDown aria-hidden className="h-4 w-4 text-content-faint" />
      </RS.Trigger>
      <RS.Portal>
        <RS.Content className="z-50 overflow-hidden rounded-[10px] border border-line bg-surface-2 shadow-e2" position="popper" sideOffset={4}>
          <RS.Viewport className="p-1">
            {options.map((o) => (
              <RS.Item
                key={o.value}
                value={o.value}
                className="flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-sm text-content-muted outline-none data-[highlighted]:bg-surface-3 data-[highlighted]:text-content"
              >
                <RS.ItemText>{o.label}</RS.ItemText>
                <RS.ItemIndicator><Check aria-hidden className="h-4 w-4 text-accent" /></RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  );
}
```

`packages/ui/src/primitives/Checkbox.tsx`:

```tsx
import * as RC from '@radix-ui/react-checkbox';
import { Check } from '../icons.js';

export function Checkbox({
  checked, onCheckedChange, label, id,
}: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-content">
      <RC.Root
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="grid h-5 w-5 place-items-center rounded-[6px] border border-line bg-surface-1 data-[state=checked]:border-accent-solid data-[state=checked]:bg-accent-solid"
      >
        <RC.Indicator><Check aria-hidden className="h-3.5 w-3.5 text-white" /></RC.Indicator>
      </RC.Root>
      {label}
    </label>
  );
}
```

`packages/ui/src/primitives/Switch.tsx`:

```tsx
import * as RSw from '@radix-ui/react-switch';

export function Switch({
  checked, onCheckedChange, label, id,
}: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-content">
      <RSw.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-6 w-10 rounded-pill border border-line bg-surface-3 transition-colors duration-fast data-[state=checked]:border-accent-solid data-[state=checked]:bg-accent-solid"
      >
        <RSw.Thumb className="block h-4 w-4 translate-x-1 rounded-full bg-white transition-transform duration-fast data-[state=checked]:translate-x-5" />
      </RSw.Root>
      {label}
    </label>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/ui test forms`
Expected: 4 tests PASS.

- [ ] **Step 7: Export and commit**

Add to `src/index.ts`:

```ts
export { Field } from './primitives/Field.js';
export { Input, type InputProps } from './primitives/Input.js';
export { Textarea, type TextareaProps } from './primitives/Textarea.js';
export { Select, type SelectOption } from './primitives/Select.js';
export { Checkbox } from './primitives/Checkbox.js';
export { Switch } from './primitives/Switch.js';
```

```bash
pnpm --filter @ruostack/ui test && pnpm --filter @ruostack/ui typecheck
git add packages/ui pnpm-lock.yaml
git commit -m "Add accessible form primitives on Radix Select, Checkbox and Switch"
```

---

## Task 6: Overlays — Dialog, Drawer, DropdownMenu, Popover, Tooltip

**Files:**
- Create: `packages/ui/src/overlays/Dialog.tsx`, `Drawer.tsx`, `DropdownMenu.tsx`, `Popover.tsx`, `Tooltip.tsx`
- Create: `packages/ui/src/overlays/Drawer.test.tsx`
- Modify: `packages/ui/src/index.ts`, `packages/ui/package.json`

**Interfaces:**
- Consumes: `cn`, `X` icon, `Button`
- Produces:
  - `<Dialog open onOpenChange title: string description?: string footer?: ReactNode>` — centred modal
  - `<Drawer open onOpenChange title: string footer?: ReactNode>` — right side-sheet on desktop, bottom sheet below `md`
  - `<DropdownMenu trigger: ReactNode items: {label: string; onSelect: () => void; danger?: boolean}[]>`
  - `<Popover trigger: ReactNode>`, `<Tooltip label: string>`

- [ ] **Step 1: Add Radix overlay deps**

Add to `dependencies` and `pnpm install`:

```json
"@radix-ui/react-dialog": "^1.1.2",
"@radix-ui/react-dropdown-menu": "^2.1.2",
"@radix-ui/react-popover": "^1.1.2",
"@radix-ui/react-tooltip": "^1.1.4"
```

- [ ] **Step 2: Write the failing Drawer test**

This is the regression test for the accessibility defect in the old hand-rolled `Drawer` (`admin-web/src/components/ui.tsx:59`), which had no focus trap, no Escape handling, and no dialog role.

`packages/ui/src/overlays/Drawer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from './Drawer.js';

describe('Drawer', () => {
  it('exposes a labelled dialog when open', () => {
    render(<Drawer open onOpenChange={() => {}} title="Order detail"><p>body</p></Drawer>);
    expect(screen.getByRole('dialog', { name: 'Order detail' })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<Drawer open={false} onOpenChange={() => {}} title="Order detail"><p>body</p></Drawer>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(<Drawer open onOpenChange={onOpenChange} title="Order detail"><p>body</p></Drawer>);
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('moves focus into the dialog', async () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Order detail">
        <button>Inside</button>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/ui test Drawer`
Expected: FAIL — cannot resolve `./Drawer.js`.

- [ ] **Step 4: Implement Drawer and Dialog**

`packages/ui/src/overlays/Drawer.tsx`:

```tsx
import * as RD from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { X } from '../icons.js';

/** Right side-sheet on desktop; bottom sheet below md. Radix supplies the
 *  focus trap, Escape handling, scroll lock and focus restoration. */
export function Drawer({
  open, onOpenChange, title, footer, children,
}: {
  open: boolean; onOpenChange: (v: boolean) => void;
  title: string; footer?: ReactNode; children: ReactNode;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <RD.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border border-line bg-surface-2 shadow-e3
                     md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-full md:max-w-md md:rounded-none md:border-l"
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <RD.Title className="text-lg font-semibold text-content">{title}</RD.Title>
            <RD.Close aria-label="Close" className="rounded-md p-1 text-content-faint hover:text-content">
              <X aria-hidden className="h-4 w-4" />
            </RD.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="border-t border-line px-5 py-4">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
```

`packages/ui/src/overlays/Dialog.tsx`:

```tsx
import * as RD from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { X } from '../icons.js';

export function Dialog({
  open, onOpenChange, title, description, footer, children,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string;
  description?: string; footer?: ReactNode; children: ReactNode;
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <RD.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-surface-2 shadow-e3">
          <div className="flex items-start justify-between border-b border-line px-5 py-4">
            <div>
              <RD.Title className="text-lg font-semibold text-content">{title}</RD.Title>
              {description && <RD.Description className="mt-1 text-sm text-content-muted">{description}</RD.Description>}
            </div>
            <RD.Close aria-label="Close" className="rounded-md p-1 text-content-faint hover:text-content">
              <X aria-hidden className="h-4 w-4" />
            </RD.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
```

- [ ] **Step 5: Implement DropdownMenu, Popover, Tooltip**

`packages/ui/src/overlays/DropdownMenu.tsx`:

```tsx
import * as RM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean }

export function DropdownMenu({ trigger, items }: { trigger: ReactNode; items: MenuItem[] }) {
  return (
    <RM.Root>
      <RM.Trigger asChild>{trigger}</RM.Trigger>
      <RM.Portal>
        <RM.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-[10px] border border-line bg-surface-2 p-1 shadow-e2">
          {items.map((it) => (
            <RM.Item
              key={it.label}
              onSelect={it.onSelect}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-3',
                it.danger ? 'text-danger' : 'text-content-muted data-[highlighted]:text-content',
              )}
            >
              {it.label}
            </RM.Item>
          ))}
        </RM.Content>
      </RM.Portal>
    </RM.Root>
  );
}
```

`packages/ui/src/overlays/Popover.tsx`:

```tsx
import * as RP from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

export function Popover({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <RP.Root>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content align="end" sideOffset={6} className="z-50 rounded-[10px] border border-line bg-surface-2 p-3 shadow-e2">
          {children}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
```

`packages/ui/src/overlays/Tooltip.tsx`:

```tsx
import * as RT from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RT.Provider delayDuration={200}>{children}</RT.Provider>;
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content side="right" sideOffset={8} className="z-50 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-content shadow-e2">
          {label}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/ui test Drawer`
Expected: 4 tests PASS — including the focus-trap and Escape cases the old Drawer failed.

- [ ] **Step 7: Export and commit**

Add to `src/index.ts`:

```ts
export { Dialog } from './overlays/Dialog.js';
export { Drawer } from './overlays/Drawer.js';
export { DropdownMenu, type MenuItem } from './overlays/DropdownMenu.js';
export { Popover } from './overlays/Popover.js';
export { Tooltip, TooltipProvider } from './overlays/Tooltip.js';
```

```bash
pnpm --filter @ruostack/ui test && pnpm --filter @ruostack/ui typecheck
git add packages/ui pnpm-lock.yaml
git commit -m "Add Radix-backed overlays with focus trap and Escape handling"
```

---

## Task 7: Tabs, Toolbar, PageHeader, InlineAlert, Toaster

**Files:**
- Create: `packages/ui/src/data/Tabs.tsx`, `packages/ui/src/data/Toolbar.tsx`
- Create: `packages/ui/src/nav/PageHeader.tsx`
- Create: `packages/ui/src/feedback/InlineAlert.tsx`, `packages/ui/src/feedback/Toaster.tsx`
- Create: `packages/ui/src/data/Tabs.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn`, `Button`, `Card`
- Produces:
  - `<Tabs<T extends string> tabs: {key: T; label: string; count?: number}[] active: T onChange: (k: T) => void>` — horizontally scrollable on mobile
  - `<Toolbar>` — flex-wrap container for filters/search above a table
  - `<PageHeader title: string subtitle?: string action?: ReactNode breadcrumbs?: {label: string; to?: string}[]>`
  - `<InlineAlert tone: 'accent'|'success'|'warning'|'danger'|'info' action?: ReactNode>`
  - `<Toaster />` + `toast(message: string, tone?: 'success'|'danger'|'info'): void`

- [ ] **Step 1: Write the failing Tabs test**

`packages/ui/src/data/Tabs.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from './Tabs.js';

describe('Tabs', () => {
  const tabs = [
    { key: 'all' as const, label: 'All', count: 12 },
    { key: 'shipped' as const, label: 'Shipped', count: 3 },
  ];

  it('marks the active tab with aria-selected', () => {
    render(<Tabs tabs={tabs} active="all" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Shipped/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the tab key', async () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} active="all" onChange={onChange} />);
    await userEvent.click(screen.getByRole('tab', { name: /Shipped/ }));
    expect(onChange).toHaveBeenCalledWith('shipped');
  });

  it('scrolls horizontally rather than wrapping on narrow viewports', () => {
    render(<Tabs tabs={tabs} active="all" onChange={() => {}} />);
    expect(screen.getByRole('tablist')).toHaveClass('overflow-x-auto');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/ui test Tabs`
Expected: FAIL — cannot resolve `./Tabs.js`.

- [ ] **Step 3: Implement Tabs and Toolbar**

`packages/ui/src/data/Tabs.tsx`:

```tsx
import { cn } from '../lib/cn.js';

export interface TabDef<T extends string> { key: T; label: string; count?: number }

export function Tabs<T extends string>({
  tabs, active, onChange,
}: { tabs: TabDef<T>[]; active: T; onChange: (k: T) => void }) {
  return (
    <div role="tablist" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cn(
              'shrink-0 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors duration-fast',
              on ? 'border-accent-solid bg-accent-solid text-white' : 'border-line bg-surface-3 text-content-muted hover:text-content',
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

`packages/ui/src/data/Toolbar.tsx`:

```tsx
import type { ReactNode } from 'react';

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}
```

- [ ] **Step 4: Implement PageHeader**

`packages/ui/src/nav/PageHeader.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from '../icons.js';

export interface Crumb { label: string; to?: string }

export function PageHeader({
  title, subtitle, action, breadcrumbs,
}: { title: string; subtitle?: string; action?: ReactNode; breadcrumbs?: Crumb[] }) {
  return (
    <div className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-xs text-content-faint">
          {breadcrumbs.map((c, i) => (
            <span key={c.label} className="flex items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden className="h-3 w-3" />}
              {c.to ? <Link to={c.to} className="hover:text-content">{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-content">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-content-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
```

Add `"react-router-dom": "^6.28.0"` to `packages/ui/package.json` `peerDependencies` and `devDependencies`, then `pnpm install`.

- [ ] **Step 5: Implement InlineAlert and Toaster**

`packages/ui/src/feedback/InlineAlert.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

const TONE = {
  accent: 'border-accent/40 bg-accent-tint text-accent',
  success: 'border-success/40 bg-success-tint text-success',
  warning: 'border-warning/40 bg-warning-tint text-warning',
  danger: 'border-danger/40 bg-danger-tint text-danger',
  info: 'border-info/40 bg-info-tint text-info',
} as const;

export function InlineAlert({
  tone = 'info', action, children,
}: { tone?: keyof typeof TONE; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-[10px] border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between', TONE[tone])}>
      <span>{children}</span>
      {action}
    </div>
  );
}
```

`packages/ui/src/feedback/Toaster.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn.js';

type Tone = 'success' | 'danger' | 'info';
interface Toast { id: number; message: string; tone: Tone }

let push: ((t: Toast) => void) | null = null;
let nextId = 0;

export function toast(message: string, tone: Tone = 'info') {
  push?.({ id: nextId++, message, tone });
}

const TONE: Record<Tone, string> = {
  success: 'border-success/40 bg-success-tint text-success',
  danger: 'border-danger/40 bg-danger-tint text-danger',
  info: 'border-line bg-surface-2 text-content',
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    push = (t) => {
      setItems((cur) => [...cur, t]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), 4000);
    };
    return () => { push = null; };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] flex flex-col items-center gap-2 md:inset-x-auto md:bottom-6 md:right-6 md:items-end"
    >
      {items.map((t) => (
        <div key={t.id} className={cn('pointer-events-auto rounded-[10px] border px-4 py-2.5 text-sm shadow-e2', TONE[t.tone])}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/ui test Tabs`
Expected: 3 tests PASS.

- [ ] **Step 7: Export and commit**

```ts
export { Tabs, type TabDef } from './data/Tabs.js';
export { Toolbar } from './data/Toolbar.js';
export { PageHeader, type Crumb } from './nav/PageHeader.js';
export { InlineAlert } from './feedback/InlineAlert.js';
export { Toaster, toast } from './feedback/Toaster.js';
```

```bash
pnpm --filter @ruostack/ui test && pnpm --filter @ruostack/ui typecheck
git add packages/ui pnpm-lock.yaml
git commit -m "Add Tabs, Toolbar, PageHeader, InlineAlert and Toaster"
```

---

## Task 8: DataTable

The core of the mobile fix. One component replaces 22 hand-rolled tables.

**Files:**
- Create: `packages/ui/src/data/DataTable.tsx`, `packages/ui/src/data/DataTable.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn`, `Card`, `EmptyState`, `SkeletonRows`, `useMediaQuery`
- Produces:

```ts
interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  priority?: 'primary' | 'secondary' | 'meta';   // default 'secondary'
  align?: 'left' | 'right';                      // default 'left'
  mono?: boolean;
  minWidth?: number;                             // scroll mode only
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;                    // required — visually hidden
  mode?: 'cards' | 'scroll';          // mobile rendering, default 'cards'
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}
```

- [ ] **Step 1: Write the failing test**

`packages/ui/src/data/DataTable.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from './DataTable.js';

interface Row { id: string; name: string; charge: string }

const ROWS: Row[] = [
  { id: '1', name: 'M. Reyes', charge: '$128.00' },
  { id: '2', name: 'J. Chen', charge: '$96.00' },
];

const COLUMNS: Column<Row>[] = [
  { key: 'name', header: 'Recipient', cell: (r) => r.name, priority: 'primary' },
  { key: 'charge', header: 'Charge', cell: (r) => r.charge, align: 'right', mono: true },
];

/** Drives the md breakpoint that DataTable reads via useMediaQuery. */
function setViewport(isDesktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('DataTable', () => {
  beforeEach(() => setViewport(true));

  it('renders a real table with a caption and column scopes on desktop', () => {
    render(<DataTable caption="Recent orders" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.getByRole('table', { name: 'Recent orders' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Recipient' })).toHaveAttribute('scope', 'col');
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2
  });

  it('renders cards instead of a table below md', () => {
    setViewport(false);
    render(<DataTable caption="Recent orders" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('M. Reyes')).toBeInTheDocument();
    // Non-primary columns render as label/value pairs in card mode.
    expect(screen.getAllByText('Charge')).toHaveLength(2);
  });

  it('shows the empty state when there are no rows', () => {
    render(<DataTable caption="Recent orders" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} empty={<div>No orders yet</div>} />);
    expect(screen.getByText('No orders yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a loading status instead of rows while loading', () => {
    render(<DataTable caption="Recent orders" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} loading />);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('fires onRowClick from a keyboard-reachable row', async () => {
    const onRowClick = vi.fn();
    render(<DataTable caption="Recent orders" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByText('M. Reyes'));
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/ui test DataTable`
Expected: FAIL — cannot resolve `./DataTable.js`.

- [ ] **Step 3: Implement DataTable**

`packages/ui/src/data/DataTable.tsx`:

```tsx
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Card } from '../primitives/Card.js';
import { SkeletonRows } from '../primitives/Skeleton.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  priority?: 'primary' | 'secondary' | 'meta';
  align?: 'left' | 'right';
  mono?: boolean;
  minWidth?: number;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  mode?: 'cards' | 'scroll';
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}

const cellClass = <T,>(c: Column<T>) =>
  cn('px-4 py-3', c.align === 'right' && 'text-right', c.mono && 'font-mono tabular-nums');

export function DataTable<T>({
  columns, rows, rowKey, caption, mode = 'cards', loading = false, empty, onRowClick,
}: DataTableProps<T>) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (loading) return <Card><SkeletonRows count={5} /></Card>;
  if (rows.length === 0) return <>{empty ?? null}</>;

  // --- Mobile card mode -----------------------------------------------------
  if (!isDesktop && mode === 'cards') {
    const primary = columns.find((c) => c.priority === 'primary') ?? columns[0]!;
    const meta = columns.filter((c) => c.priority === 'meta');
    const rest = columns.filter((c) => c !== primary && c.priority !== 'meta');

    return (
      <div className="space-y-2">
        {rows.map((row) => (
          <Card
            key={rowKey(row)}
            {...(onRowClick && {
              role: 'button',
              tabIndex: 0,
              onClick: () => onRowClick(row),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); }
              },
            })}
            className={cn('p-4', onRowClick && 'cursor-pointer')}
          >
            <div className="text-base font-semibold text-content">{primary.cell(row)}</div>
            {meta.length > 0 && (
              <div className="mt-0.5 text-xs text-content-muted">
                {meta.map((c) => <span key={c.key} className="mr-2">{c.cell(row)}</span>)}
              </div>
            )}
            <dl className="mt-3 space-y-1.5">
              {rest.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-3">
                  <dt className="text-2xs uppercase tracking-[0.1em] text-content-faint">{c.header}</dt>
                  <dd className={cn('text-sm text-content', c.mono && 'font-mono tabular-nums')}>{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    );
  }

  // --- Table mode (desktop, and mobile when mode="scroll") ------------------
  return (
    <Card className={cn('overflow-hidden', !isDesktop && 'overflow-x-auto')}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                style={c.minWidth ? { minWidth: c.minWidth } : undefined}
                className={cn(
                  'px-4 py-3 text-2xs uppercase tracking-[0.1em] text-content-faint',
                  c.align === 'right' && 'text-right',
                  // Pin the identity column while the rest scrolls horizontally.
                  !isDesktop && i === 0 && 'sticky left-0 bg-surface-2',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              {...(onRowClick && {
                tabIndex: 0,
                onClick: () => onRowClick(row),
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === 'Enter') onRowClick(row);
                },
              })}
              className={cn(
                'border-b border-line-subtle last:border-0 transition-colors duration-fast',
                onRowClick && 'cursor-pointer hover:bg-surface-3',
              )}
            >
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={cn(cellClass(c), !isDesktop && i === 0 && 'sticky left-0 bg-surface-1')}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/ui test DataTable`
Expected: 5 tests PASS.

- [ ] **Step 5: Export and commit**

```ts
export { DataTable, type Column, type DataTableProps } from './data/DataTable.js';
```

```bash
pnpm --filter @ruostack/ui test && pnpm --filter @ruostack/ui typecheck
git add packages/ui && git commit -m "Add DataTable rendering a real table on desktop and cards on phones"
```

---

## Task 9: Navigation shell — Sidebar, IconRail, BottomTabs, CommandPalette, AppShell

**Files:**
- Create: `packages/ui/src/nav/AppShell.tsx`, `Sidebar.tsx`, `BottomTabs.tsx`, `CommandPalette.tsx`
- Create: `packages/ui/src/nav/AppShell.test.tsx`
- Modify: `packages/ui/src/index.ts`, `packages/ui/package.json`

**Interfaces:**
- Consumes: `cn`, icons, `Tooltip`, `Dialog`, `useTheme`, `Button`
- Produces:

```ts
interface NavItem { to: string; label: string; icon: LucideIcon }
interface NavGroup { group: string; items: NavItem[] }

interface AppShellProps {
  brandName: string;                 // "RUOStack"
  groups: NavGroup[];                // desktop sidebar IA
  tabs: NavItem[];                   // exactly 4; a "More" tab is appended
  comingSoon?: string[];             // labels only; rendered in the More sheet
  headerRight?: ReactNode;           // bell, avatar, sign-out
  badge?: ReactNode;                 // admin role chip
  children: ReactNode;
}
```

- [ ] **Step 1: Add cmdk**

Add `"cmdk": "^1.0.4"` to `dependencies`, run `pnpm install`.

- [ ] **Step 2: Write the failing AppShell test**

`packages/ui/src/nav/AppShell.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { LayoutDashboard, Package, Wallet, Store } from '../icons.js';

const GROUPS = [
  { group: 'Core', items: [
    { to: '/overview', label: 'Overview', icon: LayoutDashboard },
    { to: '/orders', label: 'Orders', icon: Package },
  ]},
];
const TABS = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/orders', label: 'Orders', icon: Package },
  { to: '/store', label: 'Store', icon: Store },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
];

const shell = (
  <MemoryRouter>
    <AppShell brandName="RUOStack" groups={GROUPS} tabs={TABS} comingSoon={['Live Chat']}>
      <p>content</p>
    </AppShell>
  </MemoryRouter>
);

describe('AppShell', () => {
  it('renders the sidebar navigation landmark', () => {
    render(shell);
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('renders a bottom tab bar with a More tab', () => {
    render(shell);
    const tabbar = screen.getByRole('navigation', { name: 'Primary' });
    expect(tabbar).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('opens the More sheet and lists coming-soon items there, not in the sidebar', async () => {
    render(shell);
    expect(screen.queryByText('Live Chat')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog', { name: 'All destinations' })).toBeInTheDocument();
    expect(screen.getByText('Live Chat')).toBeInTheDocument();
  });

  it('collapses the sidebar to a rail and remembers it', async () => {
    render(shell);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(localStorage.getItem('ruostack_nav_collapsed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/ui test AppShell`
Expected: FAIL — cannot resolve `./AppShell.js`.

- [ ] **Step 4: Implement Sidebar**

`packages/ui/src/nav/Sidebar.tsx`:

```tsx
import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Tooltip } from '../overlays/Tooltip.js';
import type { LucideIcon } from '../icons.js';

export interface NavItem { to: string; label: string; icon: LucideIcon }
export interface NavGroup { group: string; items: NavItem[] }

export function Sidebar({
  groups, collapsed, brand, badge, footer,
}: {
  groups: NavGroup[]; collapsed: boolean; brand: ReactNode;
  badge?: ReactNode; footer?: ReactNode;
}) {
  return (
    <nav
      aria-label="Main"
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col overflow-y-auto border-r border-line bg-surface-1 py-5 md:flex',
        collapsed ? 'w-16 px-2' : 'w-[260px] px-3',
      )}
    >
      <div className={cn('mb-4 flex items-center gap-2', collapsed && 'justify-center')}>{brand}</div>
      {badge && !collapsed && <div className="mb-4">{badge}</div>}

      <div className="flex-1 space-y-4">
        {groups.map((g) => (
          <div key={g.group}>
            {!collapsed && (
              <div className="mb-1 px-2 text-2xs uppercase tracking-[0.12em] text-content-faint">{g.group}</div>
            )}
            {g.items.map(({ to, label, icon: Icon }) => {
              const link = (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    cn(
                      'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-fast',
                      collapsed && 'justify-center px-0',
                      isActive
                        ? 'bg-accent-tint text-accent before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-accent'
                        : 'text-content-muted hover:bg-surface-3 hover:text-content',
                    )
                  }
                >
                  <Icon aria-hidden className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </NavLink>
              );
              return collapsed ? <Tooltip key={to} label={label}>{link}</Tooltip> : link;
            })}
          </div>
        ))}
      </div>

      {footer && <div className="pt-4">{footer}</div>}
    </nav>
  );
}
```

- [ ] **Step 5: Implement BottomTabs**

`packages/ui/src/nav/BottomTabs.tsx`:

```tsx
import { NavLink } from 'react-router-dom';
import { cn } from '../lib/cn.js';
import { MoreHorizontal } from '../icons.js';
import type { NavItem } from './Sidebar.js';

export function BottomTabs({ tabs, onMore }: { tabs: NavItem[]; onMore: () => void }) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-2xs',
              isActive ? 'text-accent' : 'text-content-faint',
            )
          }
        >
          <Icon aria-hidden className="h-5 w-5" />
          {label}
        </NavLink>
      ))}
      <button
        onClick={onMore}
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-2xs text-content-faint"
      >
        <MoreHorizontal aria-hidden className="h-5 w-5" />
        More
      </button>
    </nav>
  );
}
```

- [ ] **Step 6: Implement CommandPalette**

`packages/ui/src/nav/CommandPalette.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import * as RD from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import type { NavGroup } from './Sidebar.js';

/** Cmd/Ctrl+K over every destination in the sidebar IA. */
export function CommandPalette({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <RD.Root open={open} onOpenChange={setOpen}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <RD.Content className="fixed left-1/2 top-24 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-card border border-line bg-surface-2 shadow-e3">
          <RD.Title className="sr-only">Search destinations</RD.Title>
          <Command>
            <Command.Input
              placeholder="Jump to…"
              className="w-full border-b border-line bg-transparent px-4 py-3 text-base text-content outline-none placeholder:text-content-faint"
            />
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-content-faint">No matches.</Command.Empty>
              {groups.map((g) => (
                <Command.Group
                  key={g.group}
                  heading={g.group}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-content-faint"
                >
                  {g.items.map(({ to, label, icon: Icon }) => (
                    <Command.Item
                      key={to}
                      value={label}
                      onSelect={() => { setOpen(false); navigate(to); }}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-content-muted data-[selected=true]:bg-surface-3 data-[selected=true]:text-content"
                    >
                      <Icon aria-hidden className="h-4 w-4" />
                      {label}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
```

- [ ] **Step 7: Implement AppShell**

`packages/ui/src/nav/AppShell.tsx`:

```tsx
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import * as RD from '@radix-ui/react-dialog';
import { cn } from '../lib/cn.js';
import { Sidebar, type NavGroup, type NavItem } from './Sidebar.js';
import { BottomTabs } from './BottomTabs.js';
import { CommandPalette } from './CommandPalette.js';
import { Toaster } from '../feedback/Toaster.js';
import { TooltipProvider } from '../overlays/Tooltip.js';
import { PanelLeftClose, PanelLeftOpen, Search } from '../icons.js';

const COLLAPSE_KEY = 'ruostack_nav_collapsed';

export interface AppShellProps {
  brandName: string;
  groups: NavGroup[];
  tabs: NavItem[];
  comingSoon?: string[];
  headerRight?: ReactNode;
  badge?: ReactNode;
  sidebarFooter?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  brandName, groups, tabs, comingSoon = [], headerRight, badge, sidebarFooter, children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'true');
  const [moreOpen, setMoreOpen] = useState(false);

  function toggleCollapse() {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, String(!c));
      return !c;
    });
  }

  const brand = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-solid text-base font-black text-white">R</span>
      {!collapsed && <span className="text-lg font-bold text-content">{brandName}</span>}
    </>
  );

  return (
    <TooltipProvider>
      <div className="flex min-h-screen bg-canvas text-content">
        <Sidebar groups={groups} collapsed={collapsed} brand={brand} badge={badge} footer={sidebarFooter} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas/90 px-4 py-2.5 backdrop-blur md:px-8">
            <button
              onClick={toggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden rounded-md p-1.5 text-content-faint hover:text-content md:block"
            >
              {collapsed ? <PanelLeftOpen aria-hidden className="h-4 w-4" /> : <PanelLeftClose aria-hidden className="h-4 w-4" />}
            </button>
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-solid text-xs font-black text-white md:hidden">R</span>
            <span className="text-base font-bold md:hidden">{brandName}</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-pill border border-line px-2.5 py-1 text-2xs text-content-faint md:inline-flex">
                <Search aria-hidden className="h-3 w-3" /> ⌘K
              </span>
              {headerRight}
            </div>
          </header>

          {/* pb-24 clears the fixed bottom tab bar on phones. */}
          <main className="min-w-0 flex-1 bg-[radial-gradient(120%_60%_at_50%_0%,var(--accent-tint),transparent_55%)] px-4 pb-24 pt-6 md:px-8 md:pb-10">
            <div className="mx-auto w-full max-w-[1100px]">{children}</div>
          </main>
        </div>

        <BottomTabs tabs={tabs} onMore={() => setMoreOpen(true)} />

        <RD.Root open={moreOpen} onOpenChange={setMoreOpen}>
          <RD.Portal>
            <RD.Overlay className="fixed inset-0 z-40 bg-black/60 md:hidden" />
            <RD.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border border-line bg-surface-2 px-4 pb-[env(safe-area-inset-bottom)] pt-5 shadow-e3 md:hidden">
              <RD.Title className="mb-3 text-lg font-semibold">All destinations</RD.Title>
              {groups.map((g) => (
                <div key={g.group} className="mb-4">
                  <div className="mb-1 text-2xs uppercase tracking-[0.12em] text-content-faint">{g.group}</div>
                  {g.items.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setMoreOpen(false)}
                      className={({ isActive }) =>
                        cn('flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm',
                           isActive ? 'bg-accent-tint text-accent' : 'text-content-muted')
                      }
                    >
                      <Icon aria-hidden className="h-4 w-4" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              ))}
              {comingSoon.length > 0 && (
                <div className="mb-4">
                  <div className="mb-1 text-2xs uppercase tracking-[0.12em] text-content-faint">Coming soon</div>
                  {comingSoon.map((label) => (
                    <div key={label} className="flex min-h-11 items-center px-3 text-sm text-content-faint/60">{label}</div>
                  ))}
                </div>
              )}
            </RD.Content>
          </RD.Portal>
        </RD.Root>

        <CommandPalette groups={groups} />
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/ui test AppShell`
Expected: 4 tests PASS.

- [ ] **Step 9: Export, run the full suite, commit**

```ts
export { AppShell, type AppShellProps } from './nav/AppShell.js';
export { Sidebar, type NavItem, type NavGroup } from './nav/Sidebar.js';
export { BottomTabs } from './nav/BottomTabs.js';
export { CommandPalette } from './nav/CommandPalette.js';
```

```bash
pnpm --filter @ruostack/ui test && pnpm --filter @ruostack/ui typecheck
git add packages/ui pnpm-lock.yaml
git commit -m "Add AppShell with collapsible sidebar, bottom tabs and command palette"
```

---

## Task 10: Both apps adopt the design system

After this task both apps render the new chrome. Screens still use their legacy classes, which remain in `index.css` until Task 24.

**Files:**
- Modify: `apps/brand-web/package.json`, `apps/brand-web/tailwind.config.js`, `apps/brand-web/src/index.css`, `apps/brand-web/src/main.tsx`, `apps/brand-web/src/components/Shell.tsx`
- Modify: `apps/admin-web/package.json`, `apps/admin-web/tailwind.config.js`, `apps/admin-web/src/index.css`, `apps/admin-web/src/main.tsx`, `apps/admin-web/src/components/Shell.tsx`, `apps/admin-web/index.html`
- Delete: `apps/admin-web/src/components/ui.tsx`

**Interfaces:**
- Consumes: everything exported from `@ruostack/ui`
- Produces: both apps wrapped in `ThemeProvider`; `Shell` re-exported as a thin wrapper over `AppShell` so screen imports do not change

- [ ] **Step 1: Add the dependency to both apps**

In both `apps/brand-web/package.json` and `apps/admin-web/package.json`, add to `dependencies`:

```json
"@ruostack/ui": "workspace:*",
"@fontsource-variable/inter": "^5.1.0",
"@fontsource-variable/jetbrains-mono": "^5.1.1"
```

Run: `pnpm install`

- [ ] **Step 2: Collapse both Tailwind configs onto the preset**

Replace the **entire contents** of `apps/brand-web/tailwind.config.js` and `apps/admin-web/tailwind.config.js` with:

```js
/** @type {import('tailwindcss').Config} */
import preset from '@ruostack/ui/tailwind-preset';

export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
};
```

- [ ] **Step 3: Import tokens and fonts in both stylesheets**

At the **top** of both `apps/brand-web/src/index.css` and `apps/admin-web/src/index.css`, above the `@tailwind` directives:

```css
@import '@fontsource-variable/inter';
@import '@fontsource-variable/jetbrains-mono';
@import '@ruostack/ui/tokens.css';
```

Delete the old `body { … }` rule and the `:root { color-scheme: dark }` rule from both files — `tokens.css` now owns both. **Leave the `@layer components` blocks in place**; Task 24 removes them.

- [ ] **Step 4: Remove the hard-coded dark class from admin's HTML**

In `apps/admin-web/index.html`, change `<html lang="en" class="dark">` to `<html lang="en">`. `ThemeProvider` now owns the class.

- [ ] **Step 5: Wrap both apps in ThemeProvider**

In `apps/brand-web/src/main.tsx` and `apps/admin-web/src/main.tsx`, wrap the root element. Brand keeps the existing storage key so returning users' stored preference survives:

```tsx
import { ThemeProvider } from '@ruostack/ui';
// brand-web:  <ThemeProvider storageKey="ruostack_theme">…</ThemeProvider>
// admin-web:  <ThemeProvider storageKey="ruostack_admin_theme">…</ThemeProvider>
```

- [ ] **Step 6: Replace brand-web's Shell**

Replace the **entire contents** of `apps/brand-web/src/components/Shell.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppShell, Button, useTheme,
  LayoutDashboard, Package, Truck, ShieldAlert, AlertTriangle, Users, BookUser,
  Wallet, Store, FlaskConical, FileCheck2, Palette, Ship, Calculator,
  Gift, UsersRound, Settings, Sun, Moon, LogOut,
  type NavGroup, type NavItem,
} from '@ruostack/ui';
import { useAuth } from '../lib/auth.js';
import { NotificationBell } from './NotificationBell.js';

const GROUPS: NavGroup[] = [
  { group: 'Core', items: [
    { to: '/app/overview', label: 'Overview', icon: LayoutDashboard },
    { to: '/app/orders', label: 'Orders', icon: Package },
    { to: '/app/tracking', label: 'Tracking', icon: Truck },
    { to: '/app/claims', label: 'Claims', icon: ShieldAlert },
    { to: '/app/action-required', label: 'Action Required', icon: AlertTriangle },
    { to: '/app/customers', label: 'Customers', icon: Users },
    { to: '/app/address-book', label: 'Address Book', icon: BookUser },
    { to: '/app/wallet', label: 'Wallet', icon: Wallet },
  ]},
  { group: 'Store', items: [{ to: '/app/store', label: 'My Store', icon: Store }] },
  { group: 'Catalog', items: [
    { to: '/app/catalog', label: 'Research Peptides', icon: FlaskConical },
    { to: '/app/coas', label: 'COAs', icon: FileCheck2 },
  ]},
  { group: 'Brand & Tools', items: [
    { to: '/app/branding', label: 'Branding', icon: Palette },
    { to: '/app/shipping', label: 'Shipping', icon: Ship },
    { to: '/app/profit', label: 'Profit Calculator', icon: Calculator },
  ]},
  { group: 'Support', items: [
    { to: '/app/referrals', label: 'Referrals', icon: Gift },
    { to: '/app/team', label: 'Team', icon: UsersRound },
    { to: '/app/account', label: 'Account', icon: Settings },
  ]},
];

// The four destinations that carry the daily job. AppShell appends "More".
const TABS: NavItem[] = [
  { to: '/app/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/app/orders', label: 'Orders', icon: Package },
  { to: '/app/catalog', label: 'Catalog', icon: FlaskConical },
  { to: '/app/wallet', label: 'Wallet', icon: Wallet },
];

export function Shell({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { resolved, setTheme } = useTheme();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  return (
    <AppShell
      brandName="RUOStack"
      groups={GROUPS}
      tabs={TABS}
      comingSoon={['Live Chat']}
      headerRight={
        <>
          <NotificationBell />
          <Button
            variant="ghost"
            size="sm"
            icon={resolved === 'dark' ? Sun : Moon}
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
          >
            <span className="sr-only">Toggle theme</span>
          </Button>
          <Button variant="ghost" size="sm" icon={LogOut} onClick={handleSignOut}>
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 7: Replace admin-web's Shell**

Replace the **entire contents** of `apps/admin-web/src/components/Shell.tsx`:

```tsx
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppShell, Badge, Button, useTheme,
  LayoutDashboard, BarChart3, ListChecks, Store, FlaskConical, Ship,
  GitCompareArrows, UsersRound, ScrollText, AlertTriangle, ShieldAlert,
  Megaphone, Scale, Sun, Moon, LogOut,
  type NavGroup, type NavItem,
} from '@ruostack/ui';
import { useAuth } from '../lib/auth.js';
import { logout } from '../lib/api.js';

const GROUPS: NavGroup[] = [
  { group: 'Operations', items: [
    { to: '/overview', label: 'Overview', icon: LayoutDashboard },
    { to: '/reporting', label: 'Reporting', icon: BarChart3 },
    { to: '/fulfillment', label: 'Fulfillment Queue', icon: ListChecks },
    { to: '/exceptions', label: 'Exceptions & Reconciliation', icon: AlertTriangle },
    { to: '/claims', label: 'Claims Queue', icon: ShieldAlert },
  ]},
  { group: 'Catalog & Stores', items: [
    { to: '/brands', label: 'Brand Manager', icon: Store },
    { to: '/catalog', label: 'Catalog Manager', icon: FlaskConical },
    { to: '/shipping-rules', label: 'Shipping Rules', icon: Ship },
    { to: '/store-match', label: 'Store Match', icon: GitCompareArrows },
  ]},
  { group: 'Administration', items: [
    { to: '/admins', label: 'Admin Users & Roles', icon: UsersRound },
    { to: '/audit', label: 'Audit Log', icon: ScrollText },
    { to: '/announcements', label: 'Announcements', icon: Megaphone },
    { to: '/ledger', label: 'Ledger & Reconciliation', icon: Scale },
  ]},
];

const TABS: NavItem[] = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/fulfillment', label: 'Queue', icon: ListChecks },
  { to: '/brands', label: 'Brands', icon: Store },
  { to: '/claims', label: 'Claims', icon: ShieldAlert },
];

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  operations: 'Operations',
  support: 'Support',
  finance: 'Finance',
};

export function Shell({ children }: { children: ReactNode }) {
  const { claims, signOut } = useAuth();
  const { resolved, setTheme } = useTheme();
  const navigate = useNavigate();

  function handleSignOut() {
    logout();
    signOut();
    navigate('/login');
  }

  return (
    <AppShell
      brandName="RUOStack"
      groups={GROUPS}
      tabs={TABS}
      badge={<Badge tone="accent">{ROLE_LABEL[claims?.role ?? ''] ?? 'Admin'}</Badge>}
      headerRight={
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={resolved === 'dark' ? Sun : Moon}
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
          >
            <span className="sr-only">Toggle theme</span>
          </Button>
          <Button variant="ghost" size="sm" icon={LogOut} onClick={handleSignOut}>
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 8: Delete admin's local ui.tsx and repoint its imports**

```bash
git rm apps/admin-web/src/components/ui.tsx
grep -rln "components/ui.js" apps/admin-web/src
```

In every file the grep lists, change the import source from `'../components/ui.js'` to `'@ruostack/ui'`. The names `PageHeader`, `Tabs`, `EmptyState`, `Drawer`, `StatusPill`, `Field` are unchanged. Two renames are required:

- `KpiCard` → `KpiTile`, and its `value`/`label` props are unchanged.
- `Tabs` now takes `TabDef<T>[]` — identical shape (`{ key, label, count? }`), so call sites do not change.

- [ ] **Step 9: Verify both apps build**

Run: `pnpm typecheck && pnpm --filter @ruostack/brand-web build && pnpm --filter @ruostack/admin-web build`
Expected: all green.

- [ ] **Step 10: Manually verify the shell**

Run `pnpm dev:brand`, open the app, and confirm:
- Sidebar shows icons and groups; the collapse button produces a 64px rail with tooltips.
- At a 390px viewport width the sidebar is hidden and a bottom tab bar is visible.
- "More" opens a sheet listing all groups plus a "Coming soon" group containing Live Chat.
- `⌘K` opens the palette and navigating from it works.
- The theme toggle flips light/dark.

- [ ] **Step 11: Commit**

```bash
git add apps packages pnpm-lock.yaml
git commit -m "Adopt @ruostack/ui shell, tokens and fonts in both apps"
```

---

## Tasks 11–21: Migrate the 21 table screens

Each task follows the identical shape. **Per task:** replace the hand-rolled `<table>` (and any bespoke loading/empty markup) with `DataTable`, replace `PageHeader`/`KpiCard`/pill markup with the package equivalents, replace all `text-[Npx]` with scale classes, and replace fixed `grid-cols-N` with responsive variants.

**Shared conventions for every screen task:**

- KPI rows become `grid grid-cols-2 gap-3 sm:grid-cols-4`.
- Filter button rows become `<Tabs>`.
- Local `TONE` maps and `FulfillmentBadge` helpers are deleted in favour of `<Badge tone=…>`.
- `dollars()` helpers stay in the screen — they are formatting, not UI.
- Money and count columns get `align: 'right'` and `mono: true`.
- Every `DataTable` needs a `caption` describing the table.
- Screens whose table has more than six columns use `mode="scroll"` and give each column a `minWidth`.

**Required per-task step sequence** (repeat verbatim for each screen listed below):

- [ ] **Step 1:** Read the screen and list its current table columns and any loading/empty branches.
- [ ] **Step 2:** Write the `Column<T>[]` config, assigning exactly one `primary` (the identity column), `meta` for location/date subtitles, and `align`/`mono` on numeric columns.
- [ ] **Step 3:** Replace the `<table>` block with `<DataTable>`, passing `caption`, `rowKey`, `loading`, and an `<EmptyState>` for `empty`.
- [ ] **Step 4:** Replace remaining legacy classes on that screen — `card`/`surface` → `<Card>`, `btn`/`btn-ghost`/`btn-danger` → `<Button variant>`, `input`/`app-input`/`l-input` → `<Input>`, `label` → `<Field>`, `pill` → `<Badge>`/`<StatusPill>`, `tab`/`tab-on` → `<Tabs>`.
- [ ] **Step 5:** Replace every `text-[Npx]` with a scale class and every fixed `grid-cols-N` with a responsive variant.
- [ ] **Step 6:** Run `pnpm --filter <app> typecheck`. Expected: clean.
- [ ] **Step 7:** Run the app, view the screen at 390px and 1440px, and confirm no horizontal scrollbar appears on `<body>` and the mobile rendering matches the chosen `mode`.
- [ ] **Step 8:** Commit with `git commit -m "Migrate <Screen> onto the design system"`.

### Task 11: brand-web `Overview.tsx`

Columns for `recent_orders` — `mode="cards"`:

```tsx
const COLUMNS: Column<RecentOrder>[] = [
  { key: 'recipient', header: 'Recipient', priority: 'primary', cell: (o) => o.recipient.name },
  { key: 'where', header: 'Destination', priority: 'meta', cell: (o) => `${o.recipient.city}, ${o.recipient.state}` },
  { key: 'charge', header: 'Charge', align: 'right', mono: true, cell: (o) => dollars(o.wallet_charge_cents) },
  { key: 'status', header: 'Status', cell: (o) => <Badge tone={FULFILLMENT_META[fulfillmentState(o)].tone as BadgeTone}>{FULFILLMENT_META[fulfillmentState(o)].label}</Badge> },
  { key: 'tracking', header: 'Tracking', mono: true, cell: (o) => o.tracking_number ?? '—' },
];
```

Also on this screen: the four KPI tiles become `<KpiTile>` inside `grid grid-cols-2 gap-3 sm:grid-cols-4`; the action-required banner becomes `<InlineAlert tone="warning" action={<Button …>Review</Button>}>`; the get-started checklist rows become `<Card>` children with `<Check>`/`<Circle>` icons instead of the `✓`/`○` glyphs.

**Note:** `FULFILLMENT_META[…].tone` currently yields `'slate' | 'muted' | 'teal' | 'amber' | 'success'`. Map these to `BadgeTone` with a local constant in the screen:

```tsx
const BADGE_TONE: Record<string, BadgeTone> = {
  teal: 'accent', amber: 'warning', success: 'success', slate: 'neutral', muted: 'neutral',
};
```

### Task 12: brand-web `Orders.tsx`
Largest brand screen (401 lines). `mode="cards"`. Columns: recipient (primary), destination (meta), charge (right, mono), status (Badge), tracking (mono), created (meta). The create/edit drawer moves to `<Drawer>`; every form control moves to `<Field>` + `<Input>`/`<Select>`. Filter buttons become `<Tabs>`.

### Task 13: brand-web `Tracking.tsx` and `ActionRequired.tsx`
Both small (80 and 72 lines). `mode="cards"`. Tracking columns: recipient (primary), carrier, tracking (mono), status. ActionRequired columns: recipient (primary), blocker (Badge), charge (right, mono), action button.

### Task 14: brand-web `Catalog.tsx` and `Coas.tsx`
`mode="cards"`. Catalog columns: product name (primary), dose/unit (meta), wholesale (right, mono), retail input, stock `<StatusPill>`. Coas columns: product (primary), batch, issued date, download link.

### Task 15: brand-web `Claims.tsx` and `Customers.tsx`
`mode="cards"`. Claims columns: order (primary), reason, status `<StatusPill>`, opened date. Customers columns: name (primary), city/state (meta), orders count (right, mono), lifetime value (right, mono), "Ship again" `<Button>`.

### Task 16: brand-web `Wallet.tsx` and `Profit.tsx`
`mode="cards"`. Wallet columns: date (meta), description (primary), amount (right, mono), balance (right, mono). Profit's table is a calculator output grid — keep it as a `DataTable` with product (primary), wholesale, retail, margin (all right/mono).

### Task 17: brand-web `components/ProvisioningWizard.tsx`
The table at line 348 already has `overflow-x-auto`. Replace with `DataTable` in `mode="scroll"` — it is a SKU-match grid and the columns must stay side by side. Give each column a `minWidth` of 140.

### Task 18: admin-web `Fulfillment.tsx` and `Exceptions.tsx`
`mode="scroll"` — both are operator queues with many columns. Fulfillment columns: order id (primary, `minWidth: 120`), brand, recipient, items, charge (right, mono), status, exported, actions.

### Task 19: admin-web `Brands.tsx` and `StoreMatch.tsx`
Brands `mode="cards"`: brand name (primary), plan, status `<StatusPill>`, wallet (right, mono), created (meta). StoreMatch `mode="scroll"`.

### Task 20: admin-web `Catalog.tsx`, `ShippingRules.tsx`, `AdminUsers.tsx`
Catalog is the largest admin screen (480 lines) and has an edit drawer — move it to `<Drawer>` and its form to `<Field>`/`<Input>`/`<Select>`. `mode="scroll"` for Catalog and ShippingRules; `mode="cards"` for AdminUsers.

### Task 21: admin-web `Ledger.tsx`, `AuditLog.tsx`, `Announcements.tsx`, `Claims.tsx`
All four are dense, append-only style logs. Use `mode="scroll"` for Ledger, AuditLog and Announcements; `mode="cards"` for Claims. Ledger already has two `overflow-x-auto` containers at lines 233 and 269 — both tables become `DataTable`.

---

## Task 22: Migrate the 9 remaining brand-web screens

**Files:** `apps/brand-web/src/screens/` — `Account.tsx`, `AddressBook.tsx`, `Auth.tsx`, `Branding.tsx`, `Notifications.tsx`, `Referrals.tsx`, `Shipping.tsx`, `Store.tsx`, `Team.tsx`

**Interfaces:**
- Consumes: `Card`, `Button`, `Field`, `Input`, `Select`, `Checkbox`, `Switch`, `PageHeader`, `Badge`, `EmptyState`, `InlineAlert`, `Drawer`, `toast`

- [ ] **Step 1: Migrate `Auth.tsx` first**

This screen is currently light-only (`AuthShell` hard-codes `bg-lbg` and `bg-white`). Replace `AuthShell`'s wrapper with token classes so it themes correctly:

```tsx
function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4">
      <Card className="w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-solid text-base font-black text-white">R</span>
          <span className="text-lg font-bold text-content">RUOStack</span>
        </div>
        <h1 className="mb-1 text-xl font-bold text-content">{title}</h1>
        <p className="mb-5 text-sm text-content-muted">Research-use-only fulfillment platform.</p>
        {children}
        {footer && <div className="mt-5 text-center text-sm text-content-muted">{footer}</div>}
      </Card>
    </div>
  );
}
```

Replace the `Err` component with `<InlineAlert tone="danger">`. Replace every `l-input` with `<Input>` inside `<Field>`.

- [ ] **Step 2: Migrate the remaining eight screens**

For each of `Account`, `AddressBook`, `Branding`, `Notifications`, `Referrals`, `Shipping`, `Store`, `Team`, apply the same substitutions: `PageHeader` at the top; `surface`/`card` → `<Card>`; `btn`/`btn-ghost` → `<Button>`; `app-input`/`input` → `<Input>` inside `<Field>`; `label` → `<Field>`'s label; `pill` → `<Badge>`; every `text-[Npx]` → a scale class; every fixed `grid-cols-N` → `grid-cols-1 sm:grid-cols-N`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ruostack/brand-web typecheck`
Expected: clean.

- [ ] **Step 4: Verify at 390px**

Run `pnpm dev:brand` and visit each of the nine screens at a 390px viewport. Expected: no horizontal scrollbar, all form controls full-width, all buttons ≥44px tall.

- [ ] **Step 5: Commit**

```bash
git add apps/brand-web && git commit -m "Migrate the remaining brand-web screens onto the design system"
```

---

## Task 23: Migrate the 3 remaining admin-web screens

**Files:** `apps/admin-web/src/screens/Login.tsx`, `Overview.tsx`, `Reporting.tsx`

- [ ] **Step 1: Migrate `Login.tsx`**

Currently dark-only. Wrap its card in `<Card>`, swap `input` → `<Input>` inside `<Field>`, `btn` → `<Button>`, and the error block → `<InlineAlert tone="danger">`. The TOTP step keeps its existing logic; only presentation changes.

- [ ] **Step 2: Migrate `Overview.tsx` and `Reporting.tsx`**

`PageHeader` at the top; KPI blocks → `<KpiTile>` in `grid grid-cols-2 gap-3 sm:grid-cols-4`; every `text-[Npx]` → a scale class.

- [ ] **Step 3: Typecheck and verify**

Run: `pnpm --filter @ruostack/admin-web typecheck`
Then run `pnpm dev:admin` and check all three screens at 390px and 1440px.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web && git commit -m "Migrate the remaining admin-web screens onto the design system"
```

---

## Task 24: Delete the legacy CSS and prove nothing references it

**Files:**
- Modify: `apps/brand-web/src/index.css`, `apps/admin-web/src/index.css`

**Interfaces:**
- Consumes: every migration from Tasks 11–23
- Produces: a tree with zero legacy class references

- [ ] **Step 1: Verify no legacy class remains**

Run:

```bash
grep -rnoE '\b(btn|btn-ghost|btn-danger|card|surface|input|l-input|app-input|label|pill|tab|tab-on)\b' \
  apps/brand-web/src apps/admin-web/src --include=*.tsx \
  | grep -vE '(aria-label|htmlFor|\blabel:|\.label\b|placeholder|Label|<label|type="tab")' \
  | sort
```

Expected: **no output**. Any hit is a screen that was missed — go back and migrate it before continuing.

Reference counts before migration, all of which must reach zero: `label` 290, `input` 184, `surface` 90, `btn-ghost` 61, `btn` 61, `card` 46, `app-input` 44, `pill` 42, `tab` 20, `l-input` 8, `btn-danger` 5, `tab-on` 4.

- [ ] **Step 2: Delete the `@layer components` blocks**

Remove the entire `@layer components { … }` block from both `apps/brand-web/src/index.css` and `apps/admin-web/src/index.css`. Each file should be reduced to just the three `@import` lines from Task 10 and the three `@tailwind` directives.

- [ ] **Step 3: Build both apps**

Run: `pnpm typecheck && pnpm build`
Expected: green.

- [ ] **Step 4: Visually verify no screen regressed**

Run both dev servers and click through every screen. Expected: no unstyled elements — an unstyled element means a legacy class survived the grep.

- [ ] **Step 5: Commit**

```bash
git add apps && git commit -m "Delete the legacy component CSS layers now that every screen is migrated"
```

---

## Task 25: Responsive regression gate

**Files:**
- Create: `playwright.config.ts`, `e2e/responsive.spec.ts`
- Modify: root `package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: both apps running
- Produces: `pnpm test:e2e`; CI job asserting no horizontal overflow

- [ ] **Step 1: Add Playwright**

Run: `pnpm add -Dw @playwright/test@^1.49.0 && pnpm exec playwright install --with-deps chromium`

- [ ] **Step 2: Configure Playwright**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3903' },
  webServer: {
    command: 'pnpm dev:brand',
    url: 'http://localhost:3903',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Write the failing overflow test**

`e2e/responsive.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

const WIDTHS = [390, 768, 1440];
const ROUTES = ['/login', '/app/overview', '/app/orders'];

for (const width of WIDTHS) {
  for (const route of ROUTES) {
    test(`no horizontal overflow at ${width}px on ${route}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    });
  }
}

test('bottom tab bar is visible on phones and hidden on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/overview');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
});
```

- [ ] **Step 4: Run the suite**

Add to root `package.json` scripts:

```json
"test:e2e": "playwright test",
```

Run: `pnpm test:e2e`
Expected: all pass. If an overflow test fails, the named route still has a fixed-width child — fix that screen before continuing.

- [ ] **Step 5: Add the CI job**

In `.github/workflows/ci.yml`, add a job alongside `checks`:

```yaml
  e2e:
    name: Responsive regression
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
```

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e package.json pnpm-lock.yaml .github/workflows/ci.yml
git commit -m "Add a Playwright gate asserting no horizontal overflow at 390/768/1440"
```

---

## Task 26: Final verification

- [ ] **Step 1: Full suite**

Run:

```bash
pnpm lint:contrast && pnpm lint:stripe-guard && pnpm typecheck && pnpm -r test && pnpm build && pnpm test:e2e
```

Expected: every command exits 0.

- [ ] **Step 2: Confirm the legacy sweep is still clean**

Re-run the Task 24 Step 1 grep. Expected: no output.

- [ ] **Step 3: Confirm no arbitrary font sizes survive**

Run: `grep -rn 'text-\[[0-9.]*px\]' apps/*/src packages/ui/src`
Expected: no output.

- [ ] **Step 4: Bundle size check**

Run: `pnpm --filter @ruostack/brand-web build` and note the reported gzip sizes. Record them in the PR description so the Radix/lucide/cmdk/font additions are visible to review.

- [ ] **Step 5: Manual accessibility pass**

With the keyboard only: tab through Overview and Orders in both apps. Confirm a visible focus ring on every stop, that the Drawer traps focus and closes on Escape returning focus to its trigger, and that the command palette is reachable and dismissible.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin feat/ui-redesign
gh pr create --title "UI redesign: shared design system, responsive shell, accessible primitives" --body "Implements docs/superpowers/specs/2026-08-05-ui-redesign-design.md"
```

---

## Self-Review Notes

**Spec coverage.** Every spec section maps to a task: §4 architecture → Tasks 1–9; §4.1 dependencies → Tasks 3, 5, 6, 9, 10; §5.1–5.3 tokens and contrast → Task 1; §5.4 elevation → Task 1 (preset) + Task 4 (Card); §5.5 typography → Task 1 (scale) + Task 10 (fonts); §5.6 motion → Task 1; §6 navigation → Tasks 9–10; §7 DataTable → Task 8; §8 accessibility → Tasks 1, 5, 6, 8, 26; §9 execution order → Tasks 1–24; §10 verification → Tasks 1, 24, 25, 26; §11 risks → theme migration in Task 2, bundle check in Task 26.

**Known deviation from spec §9.** The spec's step ordering lists shell adoption as step 5 and legacy-CSS deletion as step 8. This plan keeps that order (Tasks 10 and 24 respectively) but interleaves the screen migrations as 14 separate tasks rather than two, so each is independently reviewable and revertible.
