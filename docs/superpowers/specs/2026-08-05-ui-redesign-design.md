# RUOStack UI Redesign — Design

**Date:** 2026-08-05
**Status:** Approved for planning
**Scope:** `apps/brand-web` + `apps/admin-web` + a new `packages/ui`

---

## 1. Problem

Both front ends work but read as a templated admin panel, and neither is usable on a
phone. The specific defects, measured against the code on `main`:

**Mobile responsiveness is effectively absent.**

- Six breakpoint prefixes exist across ~6,100 lines of screen code (4× `md:`, 2× `sm:`
  in brand-web; 2× `md:` in admin-web).
- Both shells are `grid min-h-screen grid-cols-[260px_1fr]` with no breakpoint
  (`brand-web/src/components/Shell.tsx:69`, `admin-web/src/components/Shell.tsx:42`).
  The 260 px sidebar never collapses, so on a 390 px viewport the content column is
  roughly 130 px wide.
- 22 files render a raw `<table>`; only four wrap it in `overflow-x-auto`. The rest
  overflow the viewport horizontally.
- KPI rows are hard `grid-cols-4` with no variants (`Overview.tsx:64`, `Orders.tsx:109`).

**The interface is flat.** Every surface is a single token — `bg-card` plus a 1 px
`border-line` at 12 px radius. There is no elevation ramp, no gradient, essentially no
shadow (one `shadow-sm` and one `shadow-2xl` in the entire codebase), and no motion
beyond hover colour transitions. A KPI tile, a table container, and a modal all render
on the same visual plane.

**Typography has no system.** The font stack is `"Segoe UI"`. Sizes are 19 distinct
hard-coded arbitrary values (`text-[9px]` through `text-[26px]`), so there is no scale,
no rhythm, and no consistency between the two apps.

**Navigation does not scale.** brand-web has 19 destinations in 5 groups; admin-web has
13 ungrouped. Neither has icons, search, collapse, or breadcrumbs. Disabled "coming
soon" entries occupy prime sidebar space in both apps. Icons are emoji (`✓ ○ ✕ ☀ ☾ ●`).

**The palette has measurable faults.**

| Defect | Measurement |
|---|---|
| `faint #6b7490` on `card` | **3.81:1** — fails AA, and it is the colour of every small-caps label and nav group header |
| White on the teal primary button | **3.39:1** — the main CTA's label fails AA |
| Accent vs success hue distance | `#1D9E75` (161°) vs `#28c76f` (147°) = **14°**. `admin-web/tailwind.config.js` claims a "DISTINCT green is kept for success so status never reads as the accent"; perceptually that is not achieved |
| `#ff9f43` / `#ea5455` | Stock Vuexy defaults, inherited from the Pepify teardown |
| Light theme | **3 tokens** (`lbg` / `ltext` / `lline`) sitting behind a full dark-mode toggle |

**Structural debt.** The two `tailwind.config.js` files and both `index.css` files are
near-duplicates that have already drifted — brand-web added light-mode tokens, admin-web
did not. There is no shared UI package: `admin-web/src/components/ui.tsx` exists,
brand-web has no equivalent, so brand screens redeclare the same `TONE` map file by file.

**Accessibility gaps.** `outline-none` on inputs with only a border-colour change (no
visible focus ring); `Drawer` (`admin-web/src/components/ui.tsx:59`) has no focus trap,
no Escape handling, and no `role="dialog"`; tables have no `scope` or `caption`; tap
targets are ~28 px.

## 2. Goals and non-goals

**Goals**

1. Fully responsive from 360 px to 1920 px, with no horizontal overflow at any width.
2. A deliberate elevation and motion system, so the UI is not flat.
3. One shared design system consumed by both apps, eliminating the config duplication.
4. Navigation that scales to 19+ destinations and is comfortable on a phone.
5. WCAG AA contrast on every token pair, enforced in CI.

**Non-goals**

- No backend, API, or data-model changes. This is presentation only.
- No new product features. Items in `POLISH_TODO.md` stay deferred; the gamification
  layer in particular remains out of scope.
- No routing changes beyond what the new shell requires.
- No change to the realm security boundary or auth flows.

## 3. Decisions

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Scope | Both apps, one shared design system | Permanently ends the drift between the two Tailwind configs |
| 2 | Depth language | Layered depth — 4 surface levels, tinted shadows, inner highlight, subtle surface gradients, accent glow | "Not flat" without committing to a gradient/glass trend that dates |
| 3 | Navigation | Grouped sidebar → icon rail on desktop; persistent bottom tab bar on phone | 19 and 13 destinations are flat enough to show at once on desktop; the phone case genuinely benefits from an app-like tab bar over a drawer |
| 4 | Palette | Refined Slate — existing blue-slate world, corrected | Flatness was the problem, not the hue. Zero brand-equity cost; logo, emails, and marketing site are unaffected |
| 5 | Primitives | Radix (`@radix-ui/react-*`) + `lucide-react`, styled with our tokens | Radix supplies the focus trap, Escape handling, ARIA wiring, and portal behaviour the hand-rolled `Drawer` lacks |
| 6 | Tables | One `DataTable` primitive; rows become cards below `md` | Done once, inherited by all 22 files |
| 7 | Theming | Both apps, light + dark, defaulting to OS preference | CSS custom properties make light mode nearly free structurally; cost is QA, not tokens |
| 8 | Sequencing | **Single pass, no compatibility shim** | Explicit user decision. Cleanest end state, no shim to build and later delete |

### 3.1 Note on decision 8

An earlier option proposed a compatibility shim re-pointing the legacy `.card` / `.surface`
/ `.input` / `.pill` / `.btn` classes at the new tokens, so un-migrated screens would pick
up the new look with no edits. That was rejected in favour of migrating everything on one
branch. The consequence, accepted knowingly: **the branch is not visually coherent until
every screen is migrated**, since deleting the legacy `@layer components` block breaks
every screen that still references those classes. Section 9 orders the work so the tree
type-checks at each step, but there is no intermediate commit where the app is both fully
styled and partially migrated. Reviewers should expect one large branch.

## 4. Architecture

A new workspace package, added to `pnpm-workspace.yaml`:

```
packages/ui/                          @ruostack/ui
  package.json
  tailwind-preset.js                  consumed by both apps
  src/
    tokens.css                        :root + .dark custom properties — source of truth
    index.ts                          public barrel
    primitives/   Button Input Select Textarea Checkbox Radio Switch Field
                  Badge StatusPill Card KpiTile EmptyState Skeleton Spinner
    overlays/     Dialog Drawer DropdownMenu Popover Tooltip          (Radix-backed)
    data/         DataTable Tabs Pagination Toolbar
    nav/          AppShell Sidebar IconRail BottomTabs CommandPalette PageHeader
    feedback/     Toaster InlineAlert
    hooks/        useMediaQuery useTheme useDisclosure
    icons.ts      curated lucide re-exports — one import site, tree-shaken
```

Each app's `tailwind.config.js` collapses to:

```js
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}',
            '../../packages/ui/src/**/*.{ts,tsx}'],
  presets: [require('@ruostack/ui/tailwind-preset')],
};
```

**Boundaries.** `@ruostack/ui` is presentation only. It imports no app code, no
`@ruostack/shared` domain types, and performs no data fetching. Components take data
via props. This keeps it independently testable and prevents the two apps from coupling
through it.

`admin-web/src/components/ui.tsx` is deleted; its `PageHeader`, `KpiCard`, `Tabs`,
`EmptyState`, `Drawer`, `StatusPill`, and `Field` are superseded by package equivalents.

### 4.1 Dependencies added

| Package | Purpose |
|---|---|
| `@radix-ui/react-dialog` | Dialog + Drawer (focus trap, Escape, portal) |
| `@radix-ui/react-dropdown-menu` | Row and header menus |
| `@radix-ui/react-popover` | Filters, date pickers |
| `@radix-ui/react-tooltip` | Icon-rail labels |
| `@radix-ui/react-tabs` | Screen-level tabs |
| `@radix-ui/react-select` | Accessible select |
| `lucide-react` | Icon set, replacing emoji |
| `@fontsource-variable/inter` | Self-hosted UI face |
| `@fontsource-variable/jetbrains-mono` | Self-hosted mono face |
| `cmdk` | Command palette |

Fonts are **self-hosted, not loaded from the Google CDN** — no third-party runtime
request, which matters for a compliance-framed product.

## 5. Tokens

Defined as CSS custom properties on `:root` and `.dark` in `tokens.css`, surfaced to
Tailwind through the preset. Components reference semantic names (`--surface-1`), never
literals — this is the mechanism that makes light mode nearly free.

### 5.1 Dark (default)

| Token | Value | Token | Value |
|---|---|---|---|
| `--canvas` | `#0A0E16` | `--text` | `#E9EDF6` |
| `--surface-1` | `#111725` | `--text-muted` | `#98A2BA` |
| `--surface-2` | `#171E2E` | `--text-faint` | `#7C87A3` |
| `--surface-3` | `#1E2739` | `--accent` | `#17A67D` |
| `--border-subtle` | `#232C40` | `--accent-hover` | `#2ACB9A` |
| `--border-default` | `#2E3850` | `--accent-solid` | `#13805F` |
| `--border-strong` | `#3B4763` | `--success` | `#5BC46F` |
| `--ring` | `#2ACB9A` | `--warning` | `#E7AC4A` |
| | | `--danger` | `#F0656B` |
| | | `--info` | `#5B9CF6` |

### 5.2 Light

| Token | Value | Token | Value |
|---|---|---|---|
| `--canvas` | `#F6F8FC` | `--text` | `#131A2B` |
| `--surface-1` | `#FFFFFF` | `--text-muted` | `#55607A` |
| `--surface-2` | `#FFFFFF` | `--text-faint` | `#656F88` |
| `--surface-3` | `#EDF1F7` | `--accent` | `#0F7A5C` |
| `--border-subtle` | `#E4E9F2` | `--accent-hover` | `#0C6349` |
| `--border-default` | `#DDE3EE` | `--accent-solid` | `#13805F` |
| `--border-strong` | `#C7D0E0` | `--success` | `#1F7A43` |
| `--ring` | `#0F7A5C` | `--warning` | `#8A5B10` |
| | | `--danger` | `#C13540` |
| | | `--info` | `#1F5FD0` |

Each semantic colour also gets a `-tint` variant (`color-mix` at 12–14 % over the
surface) for badge and alert backgrounds.

### 5.3 Verified contrast

All 26 foreground/background pairs measured with WCAG 2.1 relative luminance. **Every
pair clears AA (≥ 4.5:1) in both themes.** Selected results:

| Pair | Dark | Light |
|---|---|---|
| `text` / `surface-1` | 15.27:1 | 17.35:1 |
| `muted` / `surface-1` | 7.00:1 | 6.29:1 |
| `faint` / `surface-1` | **4.99:1** (was 3.81) | 5.02:1 |
| `accent` / `surface-1` | 5.79:1 | 5.30:1 |
| `danger` / `surface-1` | 5.78:1 | 5.45:1 |
| white / `accent-solid` | **4.91:1** (was 3.39) | 4.91:1 |

`--accent-solid` is `#13805F` rather than the brand `#1D9E75` specifically because the
lighter value cannot carry a white label at AA. The lighter `--accent` remains the
colour used for accent *text*, icons, and active states, where it measures 5.79:1.

Accent↔success hue separation improves from **14° to 31°**, so status colour is now
perceptually distinct from brand accent — the property the current config claims but
does not have.

### 5.4 Elevation

| Level | Use | Treatment |
|---|---|---|
| 0 | Page | `--canvas`, plus a faint radial accent wash at the top of `<main>` |
| 1 | Card, KPI tile, table container | `linear-gradient(180deg, surface-2, surface-1)`; 1 px `--border-subtle` with `--border-default` on the top edge; `inset 0 1px 0 rgb(255 255 255 / .055)`; `0 8px 18px -10px rgb(0 0 0 / .9)` |
| 2 | Popover, dropdown, tooltip | `--surface-2`; `0 14px 32px -12px rgb(0 0 0 / .95)` |
| 3 | Dialog, drawer | `--surface-2`; `0 28px 64px -20px rgb(0 0 0 / .95)`; scrim `rgb(0 0 0 / .6)` |
| accent | Primary button | `--accent-solid` + `0 6px 16px -6px rgb(23 166 125 / .75)` |

In light mode the inner highlight is dropped and elevation is carried by shadow alone;
the same level names apply so component code is theme-agnostic.

### 5.5 Typography

- **UI face:** Inter Variable. **Mono:** JetBrains Mono Variable, used for tracking
  numbers, money, IDs, and SKUs.
- **Scale**, replacing the 19 arbitrary values:

  | Token | Size / line-height | Use |
  |---|---|---|
  | `text-2xs` | 11 / 16 | small-caps labels, table headers |
  | `text-xs` | 12 / 18 | metadata, badges |
  | `text-sm` | 13 / 20 | body default, table cells |
  | `text-base` | 14 / 22 | form inputs, prose |
  | `text-lg` | 16 / 24 | card titles |
  | `text-xl` | 20 / 28 | section headings |
  | `text-2xl` | 24 / 32 | page titles |
  | `text-3xl` | 30 / 38 | KPI figures |
  | `text-4xl` | 38 / 46 | hero figures |

- `font-variant-numeric: tabular-nums` on every money and count cell so columns align.
- Headings carry `letter-spacing: -0.02em`; small-caps labels carry `+0.1em`.

### 5.6 Motion

120 ms ease-out for hover and press, 180 ms for popovers, 240 ms for drawer and sheet
transitions. One global `@media (prefers-reduced-motion: reduce)` block sets all
durations to `0.01ms` — reduced motion is honoured system-wide, not per component.

## 6. Navigation

**≥ 1024 px.** 260 px grouped sidebar with lucide icons and a collapse toggle to a
64 px icon rail with Radix tooltips; collapse state persisted to `localStorage`. `⌘K` /
`Ctrl+K` command palette (cmdk) over all routes.

**768–1023 px.** Icon rail by default; expandable on demand.

**< 768 px.** Top app bar (page title, search, notification bell, avatar) plus a
persistent bottom tab bar:

- brand-web: Overview · Orders · Catalog · Wallet · More
- admin-web: Overview · Fulfillment · Brands · Claims · More

`More` opens a Radix Dialog sheet containing the full grouped IA. The tab bar uses
`padding-bottom: env(safe-area-inset-bottom)` to clear the iOS home indicator.

**Active state.** Accent tint background plus a 2 px inset left bar on desktop; accent
icon and label on mobile. Never colour alone — the bar and the icon fill both carry it,
so the state does not depend on colour perception.

**Deferred items.** The `phase0: false` entries currently rendered as dead rows in both
sidebars move into a "Coming soon" group inside the More sheet. They stop consuming
primary navigation space while remaining visible as roadmap.

**Breadcrumbs** appear on any screen reached from another screen (drawer detail views,
nested settings), rendered by `PageHeader`.

## 7. DataTable

One primitive drives all 22 files. Column config:

```ts
interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  priority?: 'primary' | 'secondary' | 'meta';  // drives mobile rendering
  align?: 'left' | 'right';
  mono?: boolean;                                // tabular-nums + mono face
  minWidth?: number;                             // scroll mode only
}
```

- **≥ md** — a real `<table>` with a sticky header, `scope="col"`, a visually-hidden
  `<caption>`, hairline row borders, hover row tint, and right-aligned tabular numerics.
- **< md, `mode="cards"` (default)** — each row becomes an elevation-1 card: the
  `primary` column is the title, `meta` columns form the subtitle, and remaining columns
  render as label/value rows. The row action sits inline in the card footer.
- **< md, `mode="scroll"`** — for admin's widest tables (`Ledger`, `AuditLog`,
  `Fulfillment`): an `overflow-x` container with a `position: sticky` first column.

Loading skeletons, empty state, and error state are built in, so screens stop
hand-rolling `Loading…` and bespoke empty divs. Row click opens a `Drawer` where the
screen supplies detail content.

## 8. Accessibility

Folded into every component rather than handled as a separate pass:

- A visible focus ring — `--ring`, 2 px, 2 px offset — on every interactive element,
  replacing the current bare `outline-none`.
- Radix supplies dialog semantics, focus trap, Escape handling, and focus restoration.
- 44 × 44 px minimum tap targets below `md`.
- `scope` and `<caption>` on all tables.
- `aria-live="polite"` on toasts and async status regions.
- Status is never conveyed by colour alone — badges carry text, nav active state carries
  a bar.
- Theme respects `prefers-color-scheme` on first visit.

## 9. Execution order

One branch. Ordered so the tree type-checks and builds at every step.

1. **Package skeleton.** Create `packages/ui`, wire into `pnpm-workspace.yaml` and
   `tsconfig.base.json`, add dependencies, author `tokens.css` and `tailwind-preset.js`.
   Commit `scripts/check-contrast.mjs` and add it to the CI workflow, so the token
   values are gated from the first commit rather than at the end.
2. **Primitives.** Button, Input, Select, Textarea, Checkbox, Radio, Switch, Field,
   Badge, StatusPill, Card, KpiTile, EmptyState, Skeleton, Spinner. Unit tests alongside.
3. **Overlays.** Dialog, Drawer, DropdownMenu, Popover, Tooltip on Radix.
4. **Data + nav.** DataTable, Tabs, Pagination, Toolbar; AppShell, Sidebar, IconRail,
   BottomTabs, CommandPalette, PageHeader; Toaster, InlineAlert.
5. **Both apps adopt the shell.** Replace both `Shell.tsx` files, collapse both Tailwind
   configs onto the preset, delete `admin-web/src/components/ui.tsx`, import fonts.
6. **Migrate the 22 table files** onto `DataTable`:
   - brand-web (11): `ActionRequired` `Catalog` `Claims` `Coas` `Customers` `Orders`
     `Overview` `Profit` `Tracking` `Wallet` `components/ProvisioningWizard`
   - admin-web (11): `AdminUsers` `Announcements` `AuditLog` `Brands` `Catalog` `Claims`
     `Exceptions` `Fulfillment` `Ledger` `ShippingRules` `StoreMatch`
7. **Migrate the remaining 12 screens** — brand-web (9): `Account` `AddressBook` `Auth`
   `Branding` `Notifications` `Referrals` `Shipping` `Store` `Team`; admin-web (3):
   `Login` `Overview` `Reporting`.

   Totals across steps 6–7: 33 screen files (19 brand + 14 admin) plus the
   `ProvisioningWizard` component — 21 of the screens contain tables, 12 do not.
8. **Delete the legacy `@layer components` blocks** from both `index.css` files. At this
   point no `.card` / `.surface` / `.input` / `.app-input` / `.l-input` / `.pill` /
   `.btn` / `.btn-ghost` / `.btn-danger` / `.label` / `.tab` / `.tab-on` reference
   remains. Current usage counts, to be driven to zero: `label` 290, `input` 184,
   `surface` 90, `btn-ghost` 61, `btn` 61, `card` 46, `app-input` 44, `pill` 42, `tab` 20,
   `l-input` 8, `btn-danger` 5, `tab-on` 4.
9. **Verification gates** (section 10) green.

## 10. Verification

| Gate | Check |
|---|---|
| Token contrast | `scripts/check-contrast.mjs` computes WCAG ratios for every token pair in both themes and exits non-zero below 4.5:1. Written and verified during design against the section 5 values (all 26 pairs pass); step 1 commits it into `scripts/` and adds it to the CI workflow alongside the existing `check-stripe-imports.mjs` guard |
| Unit (`packages/ui`) | Vitest + Testing Library: DataTable renders table mode ≥ md and card mode < md; Drawer traps focus and closes on Escape; theme switch flips resolved token values; Button renders correct variant classes |
| Responsive smoke | Playwright at 390 / 768 / 1440 px on brand Overview, brand Orders, admin Fulfillment: assert `document.documentElement.scrollWidth <= clientWidth` — a direct regression gate on the overflow bug |
| Legacy-class sweep | `grep -r` for the 12 legacy class names across both `src` trees returns zero matches |
| Build | `pnpm typecheck` and `pnpm build` green for both apps |

The contrast gate is the notable one: it already caught a real error during design. An
earlier `--accent-solid` of `#158A68` measured 4.31:1 against white and was rejected in
favour of `#13805F` at 4.91:1.

## 11. Risks

| Risk | Mitigation |
|---|---|
| No shim means the branch is not coherent until step 8 completes | Accepted by decision. Steps 1–7 keep the tree type-checking; reviewers should expect one large branch rather than incremental visual milestones |
| Inter's metrics differ from Segoe UI, shifting line lengths and wrapping | Budget a spacing pass at step 7; the Playwright overflow gate catches the worst cases |
| brand-web persists `ruostack_theme` in `localStorage` and defaults to dark; moving to OS-preference default would flip returning users' theme | Migrate on read: an existing `ruostack_theme` value is preserved as an explicit override; only absent values fall through to `prefers-color-scheme` |
| 22 table migrations is the bulk of the work and each has bespoke cell rendering | `DataTable`'s column config is designed around the existing cell shapes; `mode="scroll"` is the escape hatch for admin's widest tables |
| Radix + cmdk + lucide + two font families increase bundle size | Radix packages are headless and individually small; lucide is tree-shaken through `icons.ts`; fonts are variable and subset. Measure at step 9 |
| `Auth.tsx` is light-only today and `Login.tsx` dark-only; unified theming changes both | Both move onto the shared token set and support both themes; visual regression is expected and intended |

## 12. Out of scope

Everything in `POLISH_TODO.md` stays deferred — Live Chat, the gamification layer,
COA upload, per-brand sync health, tax exemptions UI, Wix connections. This design
changes presentation only; no screen gains functionality it does not have today.
