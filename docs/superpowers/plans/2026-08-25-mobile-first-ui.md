# Mobile-First UI/UX for Both Portals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax. **Each phase is independently mergeable and visually coherent** — do not batch phases into one branch.

**Goal:** Make `apps/brand-web` and `apps/admin-web` genuinely mobile-first — a phone is the design target, tablet and desktop are progressive enhancements — with record cards that are laid out deliberately rather than derived, and a data layer that paints instantly from cache while never showing the user stale data without saying so.

**Architecture:** Three additions, no rewrite. (1) A `RecordCard` contract in `@ruostack/ui` that gives every list an explicit mobile layout, replacing the horizontal-scroll fallback that 10 files currently use. (2) TanStack Query as the single data-access layer for both apps, replacing 37 files of hand-rolled `useEffect` fetching. (3) Real-screen responsive and performance gates in CI, replacing the synthetic-harness gate that covers no app screen today.

**Tech Stack:** React 18, Vite 5, Tailwind 3.4, TypeScript 5.6, Radix UI, `@tanstack/react-query` v5, `@tanstack/react-virtual`, MSW 2, Vitest 2.1.5, Playwright.

---

## 1. Current state — audited, not assumed

The 2026-08-05 redesign shipped (PR #60) and did more than the "not responsive" framing suggests. Verified against `main` on 2026-08-25:

**Already correct — do not redo:**

| Fact | Evidence |
|---|---|
| Zero raw `<table>` elements remain in either app | `grep -rc '<table' apps/*/src` → no matches |
| 23 files render through `DataTable` | `grep -rl DataTable apps/*/src` |
| Shell is responsive: sidebar → icon rail → bottom tabs | `packages/ui/src/nav/AppShell.tsx` |
| `Drawer` is already a bottom sheet below `md`, side panel above | `Drawer.tsx:27-28` |
| Both apps are route-code-split | 18 `lazy()` calls in each `App.tsx` |
| No rigid `grid-cols-3+` without a breakpoint | `scripts/check-legacy-classes.mjs` gates it |
| Tokens, AA contrast gate, focus rings, 44px targets on `Button`/`Input` | `scripts/check-contrast.mjs` |

**Actually broken — this plan's scope:**

| # | Defect | Evidence | Phase |
|---|---|---|---|
| A | **10 files fall back to a horizontally-scrolling table on phones.** This is the whole admin operator surface: `Fulfillment`, `Exceptions`, `Ledger`, `AuditLog`, `Catalog`, `ShippingRules`, `StoreMatch`, `Announcements`, plus `ImportPreviewTable` and `ProvisioningWizard`. A phone user side-scrolls a 12-column ledger. | 13 `mode="scroll"` call sites | 1–2 |
| B | **Card mode is a derived dump, not a layout.** `DataTable` renders title, a run-on meta line, then *every remaining column* as an equal-weight `<dl>` row. Fulfillment (8 cols) becomes a 6-row card; Ledger (12) would be 10. No hierarchy, no truncation, no action affordance. | `DataTable.tsx` card block | 1–3 |
| C | **No data cache anywhere.** No query library. Every screen is `useEffect(load, [])` + `setLoading(true)`, so each navigation blanks the screen and refetches; nothing revalidates on focus or reconnect; only `NotificationBell` polls. Data is simultaneously slow to paint and permanently stale once painted. | 37 `useEffect` files, `Orders.tsx:118` | 4 |
| D | **Light-mode `Card` renders with no background.** `--surface-1-gradient: var(--surface-1)` in `:root` compiles to `background-image: #FFFFFF`, which is not a valid `<image>`, so it computes to `none` — and `Card` sets no background-color. Verified in Chromium. Light is the OS default for most users. | `tokens.css:47`, `Card.tsx:15` | 0 |
| E | **Inputs trigger iOS auto-zoom.** `Input` uses `text-base` = 14px below `md`; mobile Safari zooms any focused input under 16px. | `Input.tsx:21`, preset `fontSize.base` | 0 |
| F | **The responsive gate covers zero app screens.** `playwright.config.ts` drives the `@ruostack/ui` gallery because real routes sit behind auth. Nothing asserts that a real screen fits a 390px viewport. | `playwright.config.ts` comment | 5 |
| G | **No virtualization.** `Ledger` and `AuditLog` render every row; on a phone that is the dominant cost. | — | 6 |

**Framing correction worth stating plainly:** the apps are responsive in *structure* and not mobile-first in *content*. The shell adapts; the data inside it does not. Phases 1–3 are about content, which is where the felt problem is.

---

## 2. Decisions

| # | Decision | Chosen | Rationale |
|---|---|---|---|
| 1 | Sequencing | **Six independently shippable phases** | The last plan's single-pass, no-shim branch produced 308 silently unstyled references and forced a class-builder tier back in. Every phase here ends green and coherent. |
| 2 | Mobile wide tables | **Explicit `RecordCard` spec + detail sheet.** `mode="scroll"` becomes desktop-only | A 12-column ledger cannot be a phone table. Side-scrolling hides the columns that matter and breaks the page's own scroll axis. |
| 3 | Card layout | **Authored per screen, not derived from columns** | Derivation is why cards read as a form dump. The card shows identity, status, ≤3 meta facts and one figure; *everything else lives in the detail sheet.* |
| 4 | Card ceiling | **Hard cap: 3 text rows above the action row** | A uniform card height is what makes a list scannable. Cap it in the component so no screen can opt out. |
| 5 | Overflow field home | **Existing `Drawer` (already a bottom sheet below `md`)** | Every column keeps a home; nothing is lost, it moves one tap away. No new overlay primitive. |
| 6 | Data layer | **TanStack Query v5, both apps** | Cache-first paint plus focus/reconnect revalidation is exactly the "fast *and* current" requirement. Replaces 37 hand-rolled fetch effects with one policy. |
| 7 | Freshness honesty | **Bounded staleness + always-visible freshness state** | "No stale information" without push is not literally achievable. What *is* achievable, and what this plan commits to: data is never more than one revalidation window old on a focused tab, and the UI always states its own freshness. Silent staleness is the actual defect; that is eliminated. |
| 8 | Push (SSE/WebSocket) | **Deferred to Phase 6, optional** | Requires `proxy_buffering off` and a raised `proxy_read_timeout` in both nginx templates (currently 60s, buffered) plus connection lifecycle in Fastify. Ship polling first; adopt push only if a measured queue proves it insufficient. |
| 9 | Responsive gate | **MSW-mocked real routes, not the gallery, not live auth** | Renders real screen code, real router, real components, with no database or auth in CI. The gallery gate tests components nobody ships. |
| 10 | Virtualization | **Only lists that can exceed 200 rows** (`Ledger`, `AuditLog`) | Virtualizing a 20-row list costs more than it saves and breaks in-page find. |

---

## 3. Global constraints

- **Mobile-first authoring is literal.** Base classes describe the phone. Every `md:`/`lg:` is additive. A bare `flex-row`, `w-64`, or `grid-cols-4` with no breakpoint prefix is a defect.
- **No new fixed pixel widths** in app screens. `max-w-[Npx]` on a truncating cell is the only permitted form.
- **No arbitrary font sizes.** Use the preset scale.
- **`@ruostack/ui` stays presentation-only.** It may import `react`, `react-dom`, `react-router-dom`, Radix and lucide (all already peer/direct deps). It must not import `@tanstack/react-query`, any app module, or `@ruostack/shared` domain types. Query hooks live in each app's `src/lib/queries/`.
- **Every list has a mobile layout.** A `DataTable` with `mode="scroll"` and no `card` spec fails CI (Phase 1 gate).
- **No blocking spinner on a cached screen.** If the cache has data, render it and revalidate behind a freshness indicator.
- **Tests before implementation** on every new component and hook.
- **Branch per phase:** `feat/mobile-<phase-slug>`.

---

## Phase 0 — Fix the two shipped defects

Small, immediate, unblocks honest visual review of everything after it.

### Task 0.1: Give light-mode cards a background

**Files:** `packages/ui/src/tokens.css`, `packages/ui/src/primitives/surfaces.test.tsx`

- [ ] **Step 1: Write the failing assertion**

The existing test asserts a class name, which passes while the background is invisible. Add a computed-value test to `surfaces.test.tsx`:

```tsx
it('resolves a real background image in both themes', () => {
  // jsdom does not resolve var() chains, so assert the token contract directly:
  // the light value must be an <image>, not a bare colour, or background-image
  // computes to `none` and Card renders transparent over the canvas.
  const css = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
  const light = css.split('.dark')[0]!;
  expect(light).toMatch(/--surface-1-gradient:\s*linear-gradient/);
});
```

- [ ] **Step 2: Fix the token**

In `packages/ui/src/tokens.css`, `:root` block:

```css
  /* Light elevation is shadow-only, but this must still be a valid <image>:
     `background-image: #FFFFFF` is invalid and computes to `none`, which left
     every Card transparent over --canvas. */
  --surface-1-gradient: linear-gradient(180deg, var(--surface-1), var(--surface-1));
```

- [ ] **Step 3: Verify in a browser, not just jsdom**

```bash
pnpm --filter @ruostack/ui gallery
```
Open at `?theme=light`. Expected: cards are `#FFFFFF` against the `#F6F8FC` canvas — a visible plane, not a border-only outline.

- [ ] **Step 4: Test, typecheck, commit**

```bash
pnpm --filter @ruostack/ui test && pnpm --filter @ruostack/ui typecheck
git commit -am "Fix light-mode Card rendering with no background"
```

### Task 0.2: Stop iOS zooming on focused inputs

**Files:** `packages/ui/src/primitives/Input.tsx`, `Textarea.tsx`, `Select.tsx`, `styles.ts`, `packages/ui/src/primitives/forms.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('uses a >=16px font below md so iOS does not zoom on focus', () => {
  render(<Input aria-label="x" />);
  // text-lg is 16px in the preset scale; text-base (14px) trips Safari's zoom.
  expect(screen.getByLabelText('x')).toHaveClass('text-lg');
  expect(screen.getByLabelText('x')).toHaveClass('md:text-sm');
});
```

- [ ] **Step 2: Swap the base size in all four files**

Replace `text-base` with `text-lg md:text-sm` on `Input`, `Textarea`, the `Select` trigger, and `inputClass()` in `styles.ts`. Desktop rendering is unchanged (`md:text-sm` = 13px, as today).

- [ ] **Step 3: Verify on a real iOS viewport**

```bash
pnpm --filter @ruostack/ui gallery
```
Chrome DevTools → iPhone 14 → focus each control. Expected: no zoom, no layout shift.

- [ ] **Step 4: Test, typecheck, commit**

```bash
pnpm --filter @ruostack/ui test && pnpm typecheck
git commit -am "Raise mobile input font size to 16px to stop iOS focus zoom"
```

---

## Phase 1 — The `RecordCard` contract

The centerpiece. Today `DataTable` *derives* the mobile card from the column list, which is why cards read as a form dump. This phase makes the mobile layout an explicit, capped, authored thing — and makes shipping a list without one a CI failure.

### Task 1.1: Define and build `RecordCard`

**Files:**
- Create: `packages/ui/src/data/RecordCard.tsx`, `packages/ui/src/data/RecordCard.test.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**

```ts
/** The authored mobile layout for one row. Everything not named here belongs in
 *  the detail sheet, not on the card. */
export interface RecordCardSpec<T> {
  /** Identity. One line, truncates. The thing a user scans for. */
  title: (row: T) => ReactNode;
  /** Status badge, pinned top-right. Optional but expected on any queue. */
  status?: (row: T) => ReactNode;
  /** At most 3 supporting facts. Rendered as one dot-separated muted line,
   *  truncated as a whole — never wrapped into a paragraph. */
  meta?: (row: T) => ReactNode[];
  /** The single number that matters (amount, count, weight). Rendered large and
   *  tabular. A card with two competing figures has no hierarchy — pick one. */
  figure?: (row: T) => ReactNode;
  figureLabel?: string;
  /** At most 2. The first renders full-width primary on the card footer; a
   *  second renders ghost beside it. More than 2 belongs in the detail sheet. */
  actions?: (row: T) => ReactNode;
}
```

- [ ] **Step 1: Write the failing test**

`packages/ui/src/data/RecordCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordCard } from './RecordCard.js';

interface Row { id: string; brand: string; city: string; when: string; amount: string }
const ROW: Row = { id: 'o-1', brand: 'Kestrel Labs', city: 'Austin, TX', when: '2h ago', amount: '$1,284.00' };

const SPEC = {
  title: (r: Row) => r.brand,
  status: () => <span>Awaiting export</span>,
  meta: (r: Row) => [r.city, r.when],
  figure: (r: Row) => r.amount,
  figureLabel: 'Charge',
};

describe('RecordCard', () => {
  it('renders title, status, meta and figure', () => {
    render(<RecordCard row={ROW} spec={SPEC} />);
    expect(screen.getByText('Kestrel Labs')).toBeInTheDocument();
    expect(screen.getByText('Awaiting export')).toBeInTheDocument();
    expect(screen.getByText('$1,284.00')).toBeInTheDocument();
    expect(screen.getByText('Charge')).toBeInTheDocument();
  });

  it('joins meta into one truncating line, not a stack', () => {
    render(<RecordCard row={ROW} spec={SPEC} />);
    const meta = screen.getByTestId('record-card-meta');
    expect(meta).toHaveClass('truncate');
    expect(meta.textContent).toBe('Austin, TX · 2h ago');
  });

  it('caps meta at three facts so card height stays uniform', () => {
    const spec = { ...SPEC, meta: () => ['a', 'b', 'c', 'd', 'e'] };
    render(<RecordCard row={ROW} spec={spec} />);
    expect(screen.getByTestId('record-card-meta').textContent).toBe('a · b · c');
  });

  it('truncates the title to one line', () => {
    render(<RecordCard row={ROW} spec={SPEC} />);
    expect(screen.getByText('Kestrel Labs')).toHaveClass('truncate');
  });

  it('opens the detail sheet on tap and via keyboard', async () => {
    const onOpen = vi.fn();
    render(<RecordCard row={ROW} spec={SPEC} onOpen={onOpen} detailLabel="Kestrel Labs" />);
    const card = screen.getByRole('button', { name: /Kestrel Labs/ });
    await userEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith(ROW);
    card.focus();
    await userEvent.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('does not fire onOpen when an action inside the card is pressed', async () => {
    const onOpen = vi.fn();
    const onAct = vi.fn();
    render(
      <RecordCard row={ROW} spec={{ ...SPEC, actions: () => <button onClick={onAct}>Export</button> }}
                  onOpen={onOpen} detailLabel="Kestrel Labs" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(onAct).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

`pnpm --filter @ruostack/ui test RecordCard` → FAIL, module not found.

- [ ] **Step 3: Implement `RecordCard`**

`packages/ui/src/data/RecordCard.tsx`:

```tsx
import { Fragment, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Card } from '../primitives/Card.js';
import { ChevronRight } from '../icons.js';

export interface RecordCardSpec<T> {
  title: (row: T) => ReactNode;
  status?: (row: T) => ReactNode;
  meta?: (row: T) => ReactNode[];
  figure?: (row: T) => ReactNode;
  figureLabel?: string;
  actions?: (row: T) => ReactNode;
}

export interface RecordCardProps<T> {
  row: T;
  spec: RecordCardSpec<T>;
  onOpen?: (row: T) => void;
  /** Accessible name for the card as a whole. Required with onOpen — "button"
   *  with no name is the most common a11y failure in card lists. */
  detailLabel?: string;
  leading?: ReactNode;
}

/** Hard cap. Three facts fit one line on a 360px viewport; four do not, and a
 *  wrapped meta line is what makes a card list stop being scannable. */
const MAX_META = 3;

/** An action inside the card must not also open the sheet. */
const swallow = {
  onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onKeyDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
};

export function RecordCard<T>({ row, spec, onOpen, detailLabel, leading }: RecordCardProps<T>) {
  const meta = (spec.meta?.(row) ?? []).filter(Boolean).slice(0, MAX_META);
  const figure = spec.figure?.(row);
  const actions = spec.actions?.(row);

  return (
    <Card
      {...(onOpen && {
        role: 'button',
        tabIndex: 0,
        'aria-label': detailLabel,
        onClick: () => onOpen(row),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(row);
          }
        },
      })}
      className={cn('p-4', onOpen && 'cursor-pointer active:bg-surface-3')}
    >
      {/* Row 1 — identity + status. Status never wraps under the title. */}
      <div className="flex items-start gap-3">
        {leading && <span {...swallow}>{leading}</span>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-content">{spec.title(row)}</div>
          {meta.length > 0 && (
            <div data-testid="record-card-meta" className="mt-0.5 truncate text-xs text-content-muted">
              {meta.map((m, i) => (
                <Fragment key={i}>
                  {i > 0 && <span aria-hidden> · </span>}
                  {m}
                </Fragment>
              ))}
            </div>
          )}
        </div>
        {spec.status && <div className="shrink-0">{spec.status(row)}</div>}
      </div>

      {/* Row 2 — the one figure that matters, plus the affordance into detail. */}
      {(figure !== undefined || onOpen) && (
        <div className="mt-3 flex items-end justify-between gap-3">
          {figure !== undefined ? (
            <div className="min-w-0">
              {spec.figureLabel && (
                <div className="text-2xs uppercase tracking-[0.1em] text-content-faint">{spec.figureLabel}</div>
              )}
              <div className="truncate font-mono text-xl tabular-nums text-content">{figure}</div>
            </div>
          ) : (
            <span />
          )}
          {onOpen && <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-content-faint" />}
        </div>
      )}

      {/* Row 3 — at most two actions; the first is the primary. */}
      {actions && (
        <div className="mt-3 flex gap-2 [&>*]:min-h-11 [&>*]:flex-1" {...swallow}>
          {actions}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

`pnpm --filter @ruostack/ui test RecordCard` → 6 tests PASS.

- [ ] **Step 5: Export and commit**

```ts
export { RecordCard, type RecordCardSpec, type RecordCardProps } from './data/RecordCard.js';
```

```bash
pnpm --filter @ruostack/ui test && pnpm --filter @ruostack/ui typecheck
git commit -am "Add RecordCard: an authored, height-capped mobile row layout"
```

### Task 1.2: Teach `DataTable` to use a card spec

**Files:** `packages/ui/src/data/DataTable.tsx`, `packages/ui/src/data/DataTable.test.tsx`

**Interfaces:** `DataTableProps<T>` gains `card?: RecordCardSpec<T>`.

Behaviour below `md`:

| `card` | `mode` | Rendering |
|---|---|---|
| provided | any | `RecordCard` list — **including when `mode="scroll"`** |
| absent | `cards` | today's derived layout (unchanged; deprecated) |
| absent | `scroll` | today's horizontal scroller (unchanged; **fails the Phase 1 gate**) |

Desktop is untouched in every case: the real `<table>` still renders above `md`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('prefers the authored card spec over derived columns below md', () => {
  setViewport(false);
  render(<DataTable caption="Queue" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id}
                    card={{ title: (r) => r.name, figure: (r) => r.charge, figureLabel: 'Charge' }} />);
  expect(screen.getByText('M. Reyes')).toBeInTheDocument();
  // The derived <dl> must not also render — that is the dump we are removing.
  expect(screen.queryByRole('definition')).not.toBeInTheDocument();
});

it('uses the card spec even in scroll mode, so phones never side-scroll', () => {
  setViewport(false);
  render(<DataTable caption="Queue" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} mode="scroll"
                    card={{ title: (r) => r.name }} />);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('still renders the real table above md when a card spec is present', () => {
  setViewport(true);
  render(<DataTable caption="Queue" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id}
                    card={{ title: (r) => r.name }} />);
  expect(screen.getByRole('table', { name: 'Queue' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement**

Add `card?: RecordCardSpec<T>` to `DataTableProps`. At the top of the mobile branch, before the existing `mode === 'cards'` check:

```tsx
  if (!isDesktop && card) {
    return (
      <div className="space-y-2">
        {rows.map((row) => (
          <RecordCard
            key={rowKey(row)}
            row={row}
            spec={card}
            onOpen={onRowClick}
            detailLabel={selectionLabel?.(row) ?? rowKey(row)}
            leading={
              selectable ? (
                <Checkbox checked={isSelected(row)} onCheckedChange={() => toggleRow(row)}
                          label={labelFor(row)} hideLabel />
              ) : undefined
            }
          />
        ))}
      </div>
    );
  }
```

- [ ] **Step 3: Verify**

`pnpm --filter @ruostack/ui test DataTable` → all PASS, including the pre-existing cases (the derived path is untouched).

- [ ] **Step 4: Commit**

```bash
git commit -am "Let DataTable render an authored RecordCard spec below md"
```

### Task 1.3: Gate — every list must have a mobile layout

**Files:** Create `scripts/check-mobile-tables.mjs`; modify root `package.json`, `.github/workflows/ci.yml`

This is the gate that keeps Phase 2's work from regressing. It is a parser, not a grep — the lesson from `check-legacy-classes.mjs`, which had to replace a grep that matched `bg-surface-3` as the legacy `surface` class.

- [ ] **Step 1: Write the gate**

`scripts/check-mobile-tables.mjs`:

```js
#!/usr/bin/env node
/**
 * Fails if any <DataTable> can reach a phone without an authored mobile layout.
 *
 * `mode="scroll"` with no `card={...}` means a 390px viewport gets a
 * horizontally-scrolling table — the defect this phase exists to remove. The
 * derived card fallback is allowed but reported, so the remaining ones stay
 * visible instead of quietly becoming permanent.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['apps/brand-web/src', 'apps/admin-web/src'];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.tsx')) yield full;
  }
}

/** Extract each <DataTable ...> element's attribute text, brace-balanced so a
 *  nested arrow body does not truncate the element early. */
function* elements(src) {
  const OPEN = '<DataTable';
  for (let i = src.indexOf(OPEN); i !== -1; i = src.indexOf(OPEN, i + 1)) {
    let depth = 0;
    for (let j = i + OPEN.length; j < src.length; j++) {
      const ch = src[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) {
        yield { attrs: src.slice(i + OPEN.length, j), line: src.slice(0, i).split('\n').length };
        break;
      }
    }
  }
}

let hard = 0;
let derived = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    for (const { attrs, line } of elements(readFileSync(file, 'utf8'))) {
      const hasCard = /\bcard=\{/.test(attrs);
      const isScroll = /\bmode=("scroll"|\{'scroll'\})/.test(attrs);
      if (hasCard) continue;
      if (isScroll) {
        console.log(`${file}:${line}  mode="scroll" with no card={} — phones get a side-scrolling table`);
        hard++;
      } else {
        console.log(`${file}:${line}  no card={} — falls back to the derived column dump`);
        derived++;
      }
    }
  }
}

if (hard === 0) {
  console.log(`\nEvery scroll-mode table has an authored mobile layout.` +
              (derived ? ` ${derived} list(s) still on the derived fallback.\n` : '\n'));
} else {
  console.log(`\n${hard} table(s) would side-scroll on a phone. Add a card={} spec.\n`);
}
process.exit(hard === 0 ? 0 : 1);
```

- [ ] **Step 2: Prove it fails today**

`node scripts/check-mobile-tables.mjs` → expect exit 1 naming the 13 `mode="scroll"` call sites. **Record that list — it is Phase 2's worklist.**

- [ ] **Step 3: Wire it up but do not block yet**

Add `"lint:mobile-tables": "node scripts/check-mobile-tables.mjs"` to root `package.json`. Add the CI step after `Legacy-class gate` with `continue-on-error: true` and the comment `# Flips to blocking at the end of Phase 2.`

- [ ] **Step 4: Commit**

```bash
git commit -am "Add a gate for DataTables that would side-scroll on a phone"
```

---

## Phase 2 — Give the 10 side-scrolling files a real phone layout

The admin portal's entire operator surface. Each file gets a `card` spec plus a detail sheet holding the columns the card does not show.

**Shared per-file recipe** (repeat verbatim for each file below):

- [ ] **Step 1:** List the file's columns and rank them: which single column is *identity*, which is *status*, which ≤3 are *meta*, which one is *the figure*. Anything left over is sheet-only — that is expected and correct.
- [ ] **Step 2:** Write the `RecordCardSpec<T>` from that ranking. Resist adding a fourth meta fact; the component truncates it anyway.
- [ ] **Step 3:** Pass `card={CARD}` to the `DataTable`. Leave `mode="scroll"` — it now only affects tablet-width table overflow, not phones.
- [ ] **Step 4:** Add the detail sheet. If the screen already has an edit `Drawer`, reuse it and add a read-only field list at the top. If not, add a `<Drawer>` opened by `onRowClick`, rendering every column as a label/value pair — this is the correct home for the dump that used to be on the card.
- [ ] **Step 5:** `pnpm --filter <app> typecheck` → clean.
- [ ] **Step 6:** `node scripts/check-mobile-tables.mjs` → this file no longer listed as hard-fail.
- [ ] **Step 7:** View at 390px: card height uniform down the list, no wrapped meta line, no horizontal page scroll, tapping a card opens the sheet.
- [ ] **Step 8:** `git commit -m "Give <file> a phone layout"`.

### Task 2.1: `admin-web/src/screens/Fulfillment.tsx` (8 columns)

The reference implementation — do this one first and completely, then match its shape everywhere else.

```tsx
const CARD: RecordCardSpec<FulfillmentRow> = {
  title: (r) => r.recipient_name,
  status: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
  meta: (r) => [r.brand_name, `${r.item_count} items`, r.created_label],
  figure: (r) => dollars(r.charge_cents),
  figureLabel: 'Charge',
  actions: (r) => (r.status === 'ready' ? <Button size="sm" onClick={() => exportOne(r)}>Export</Button> : null),
};
```

Order id, exported-at, tracking and carrier move to the detail sheet. Note the ranking judgement: the operator scans for *who and how much*, not for the order id — the id is a lookup key, not a scan key.

- [ ] Follow Steps 1–8.

### Task 2.2: `admin-web/src/screens/Exceptions.tsx` (5 columns)
Two `DataTable`s in this file — both need a spec. `title` = recipient; `status` = the exception reason badge; `meta` = brand, age; `figure` = charge. Actions: Resolve.
- [ ] Follow Steps 1–8.

### Task 2.3: `admin-web/src/screens/Ledger.tsx` (12 columns, two tables)
The widest surface in the product and the clearest proof of the pattern. `title` = description; `status` = entry type badge; `meta` = brand, date; `figure` = amount (signed, `tabular-nums`). The remaining eight columns — balance, reference, actor, source, external id — are sheet-only.
- [ ] Follow Steps 1–8.

### Task 2.4: `admin-web/src/screens/AuditLog.tsx`
`title` = action; `meta` = actor, target, timestamp; no figure; no actions. Read-only log, so the sheet holds the full payload diff.
- [ ] Follow Steps 1–8.

### Task 2.5: `admin-web/src/screens/Catalog.tsx` (6 columns)
`title` = product name; `status` = stock `StatusPill`; `meta` = dose/unit, SKU; `figure` = wholesale price. Row tap opens the existing edit `Drawer` — no new sheet needed.
- [ ] Follow Steps 1–8.

### Task 2.6: `admin-web/src/screens/ShippingRules.tsx` (10 columns, two tables)
`title` = rule name; `status` = enabled/disabled `Badge`; `meta` = carrier, service; `figure` = rate. Conditions and overrides go to the sheet.
- [ ] Follow Steps 1–8.

### Task 2.7: `admin-web/src/screens/StoreMatch.tsx`
`title` = store product title; `status` = match-confidence `Badge`; `meta` = brand, external id; `figure` = none. Actions: Confirm / Reject — the one screen where two actions are genuinely right.
- [ ] Follow Steps 1–8.

### Task 2.8: `admin-web/src/screens/Announcements.tsx` (9 columns)
`title` = headline; `status` = published/draft; `meta` = audience, scheduled date; no figure.
- [ ] Follow Steps 1–8.

### Task 2.9: `admin-web/src/components/catalog-import/ImportPreviewTable.tsx`
A validation preview, not a queue: `title` = row's product name; `status` = valid/error `Badge`; `meta` = row number, SKU; sheet holds the per-field validation messages.
- [ ] Follow Steps 1–8.

### Task 2.10: `brand-web/src/components/ProvisioningWizard.tsx`
A SKU-match grid. `title` = store product; `status` = match state; `meta` = SKU, dose. The one case where side-by-side comparison has real value on desktop — keep `mode="scroll"` there, and give the phone a card with a Change-match action.
- [ ] Follow Steps 1–8.

### Task 2.11: Close the gate

- [ ] **Step 1:** `node scripts/check-mobile-tables.mjs` → exit 0, hard-fail count zero.
- [ ] **Step 2:** In `.github/workflows/ci.yml`, delete `continue-on-error: true` from the mobile-tables step.
- [ ] **Step 3:** `pnpm typecheck && pnpm -r test && pnpm build` → green.
- [ ] **Step 4:** `git commit -am "Make the mobile-table gate blocking now that every list has a phone layout"`

---

## Phase 3 — Card quality pass on the remaining lists

The 13 lists already in card mode work, but they use the derived layout: title, run-on meta, then a `<dl>` of everything else. Same treatment, lower urgency, and this phase is where the "cards formatted correctly" goal is actually finished.

**Files:** `brand-web` — `Overview`, `Orders`, `Tracking`, `ActionRequired`, `Catalog`, `Coas`, `Claims`, `Customers`, `Wallet`, `Profit`; `admin-web` — `Brands`, `Claims`, `AdminUsers`.

- [ ] **Step 1: Author a `card` spec for each**, following the Phase 2 ranking discipline. Reference rankings:

| Screen | title | status | meta | figure |
|---|---|---|---|---|
| brand `Orders` | recipient | fulfillment `Badge` | destination, created | charge |
| brand `Wallet` | description | — | date | amount (signed) |
| brand `Customers` | name | — | city/state, order count | lifetime value |
| brand `Catalog` | product | stock `StatusPill` | dose/unit | wholesale |
| brand `Tracking` | recipient | delivery `Badge` | carrier, tracking no. | — |
| admin `Brands` | brand name | status `StatusPill` | plan, created | wallet balance |
| admin `AdminUsers` | name | role `Badge` | email, last seen | — |

- [ ] **Step 2: Delete the derived-layout fallback** from `DataTable` once no caller relies on it. Confirm with `node scripts/check-mobile-tables.mjs` reporting zero derived lists, then remove the `mode === 'cards'` derived branch and its tests.
- [ ] **Step 3: Uniform-height check.** At 390px, screenshot each list; card heights within a list must be identical unless a card carries an action row. A ragged list means a spec is returning a wrapping title or a fourth meta fact.
- [ ] **Step 4:** `pnpm typecheck && pnpm -r test` → green.
- [ ] **Step 5:** `git commit -am "Author card layouts for the remaining lists and drop the derived fallback"`

---

## Phase 4 — Fast and current: the data layer

The requirement is two-sided and the current architecture fails both halves: every navigation refetches from scratch behind a blocking spinner (slow), and once painted, data never updates (stale). One library fixes both, because they are the same problem — nothing owns the cache.

### Task 4.1: Install the query client with an explicit staleness policy

**Files:**
- Create: `apps/brand-web/src/lib/query.tsx`, `apps/admin-web/src/lib/query.tsx`
- Modify: both `main.tsx`, both `package.json`

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter @ruostack/brand-web add @tanstack/react-query@^5.62.0
pnpm --filter @ruostack/admin-web add @tanstack/react-query@^5.62.0
```

- [ ] **Step 2: Define the staleness tiers**

`apps/<app>/src/lib/query.tsx` (identical in both; deliberately duplicated rather than pushed into `@ruostack/ui`, which must stay presentation-only):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from './api.js';

/** How long a result is trusted without a background refetch. Tiered by how
 *  fast the underlying data actually moves — a blanket staleTime is either
 *  wasteful on reference data or wrong on a live queue. */
export const STALE = {
  /** Catalog, shipping rules, plans: changes are deliberate and rare. */
  reference: 5 * 60_000,
  /** Account, team, addresses, branding: user-initiated changes only. */
  account: 60_000,
  /** Orders, claims, customers, wallet: moves with normal business activity. */
  list: 30_000,
  /** Fulfillment, exceptions, notifications: an operator is watching this. */
  live: 0,
} as const;

/** Module-level, not per-render: a client constructed inside the component
 *  body is a new cache on every render, which silently disables caching
 *  entirely — the failure looks like "Query didn't help". */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE.list,
      gcTime: 5 * 60_000,
      // The two triggers that make "never silently stale" true in practice:
      // coming back to the tab, and coming back onto the network.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      // Never retry an auth or permission failure — it will not succeed, and
      // retrying it delays the redirect to login.
      retry: (count, err) =>
        err instanceof ApiError && [401, 403, 404].includes(err.status) ? false : count < 2,
    },
    mutations: { retry: false },
  },
});

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

**Note — no `persistQueryClient`.** Persisting an authenticated cache to `localStorage` would leave brand and admin data readable on a shared device after sign-out. Repeat-visit speed comes from HTTP caching and the route chunks, not from a persisted cache.

- [ ] **Step 3: Mount the provider** inside the auth provider (so a sign-out can clear the cache) and above the router in both `main.tsx`.

- [ ] **Step 4: Clear the cache on sign-out** in both `lib/auth.tsx`: call `queryClient.clear()` in the sign-out path. Verify by signing out and back in as a different user — no data from the first session may appear.

- [ ] **Step 5: Commit**

```bash
git commit -am "Add a TanStack Query client with tiered staleness and auth-aware cache clearing"
```

### Task 4.2: A typed query-key registry

**Files:** Create `apps/<app>/src/lib/queries/keys.ts`

Ad-hoc key strings are how cache invalidation silently stops working. One registry per app, and mutations invalidate from it.

- [ ] **Step 1: Write it** (brand shown; admin mirrors it):

```ts
/** Every cache key in the app. A mutation invalidates by calling one of these,
 *  never by writing a string literal at the call site. */
export const qk = {
  overview: () => ['overview'] as const,
  orders: (filter: string) => ['orders', filter] as const,
  order: (id: string) => ['orders', 'detail', id] as const,
  catalog: () => ['catalog'] as const,
  wallet: () => ['wallet'] as const,
  claims: () => ['claims'] as const,
  customers: () => ['customers'] as const,
  addresses: () => ['addresses'] as const,
  notifications: () => ['notifications'] as const,
  unreadCount: () => ['notifications', 'unread'] as const,
} as const;
```

- [ ] **Step 2: Commit.**

### Task 4.3: Migrate the screens, one domain at a time

Ordered so each commit is shippable. Do **not** convert all 37 effect sites at once.

**Per-screen recipe:**

- [ ] **Step 1:** Replace `useState` + `useEffect(load, [])` with `useQuery({ queryKey: qk.x(), queryFn: () => api('/api/...'), staleTime: STALE.<tier> })`.
- [ ] **Step 2:** Pass `placeholderData: keepPreviousData` on any query keyed by a filter or page. This is the single biggest perceived-speed win: switching an Orders filter keeps the old rows on screen and swaps them when the new set lands, instead of flashing a skeleton.
- [ ] **Step 3:** Replace every post-mutation `load()` call with `queryClient.invalidateQueries({ queryKey: qk.x() })`. A mutation that changes two domains invalidates both.
- [ ] **Step 4:** Feed `isPending` to `DataTable`'s `loading` — **but only when there is no cached data.** `isPending` is false whenever the cache has something, which is exactly the "no blocking spinner on a cached screen" constraint.
- [ ] **Step 5:** Typecheck, then verify: navigate away and back — the screen must paint instantly from cache with a freshness indicator, never a skeleton.

**Migration order:**

- [ ] **Task 4.3a — brand `Overview`, `Orders`, `Tracking`, `ActionRequired`** (the highest-traffic path; `STALE.list`, orders keyed by filter).
- [ ] **Task 4.3b — brand `Catalog`, `Coas`, `Wallet`, `Profit`, `Customers`, `Claims`** (`reference` for catalog, `list` for the rest).
- [ ] **Task 4.3c — brand `Account`, `AddressBook`, `Team`, `Branding`, `Notifications`, `Shipping`, `Store`, `Referrals`** (`STALE.account`).
- [ ] **Task 4.3d — admin `Overview`, `Fulfillment`, `Exceptions`** (`STALE.live`).
- [ ] **Task 4.3e — admin `Brands`, `Claims`, `Ledger`, `AuditLog`, `StoreMatch`, `Announcements`, `AdminUsers`, `Catalog`, `ShippingRules`, `Reporting`, `Plans`.**

### Task 4.4: Make freshness visible

This is what turns "bounded staleness" into an honest promise instead of a claim. The user always knows how current the screen is.

**Files:** Create `packages/ui/src/data/Freshness.tsx`; modify `PageHeader.tsx`, `index.ts`

- [ ] **Step 1: Write the failing test**

```tsx
it('announces refreshing state politely without stealing focus', () => {
  render(<Freshness updatedAt={Date.now() - 12_000} refreshing />);
  const el = screen.getByRole('status');
  expect(el).toHaveAttribute('aria-live', 'polite');
  expect(el).toHaveTextContent(/Refreshing/);
});

it('renders a relative age when idle', () => {
  render(<Freshness updatedAt={Date.now() - 90_000} refreshing={false} />);
  expect(screen.getByRole('status')).toHaveTextContent('Updated 1m ago');
});

it('warns when the data is older than its own staleness budget', () => {
  render(<Freshness updatedAt={Date.now() - 600_000} refreshing={false} staleAfter={60_000} />);
  expect(screen.getByRole('status')).toHaveClass('text-warning');
});
```

- [ ] **Step 2: Implement** `Freshness` as a `role="status" aria-live="polite"` inline element taking `updatedAt: number`, `refreshing: boolean`, `staleAfter?: number`, and an optional `onRefresh` that renders a manual refresh button (≥44px). It re-renders on a 15s interval that **pauses while `document.hidden`** — a background timer on a phone is a battery cost with no user benefit.

- [ ] **Step 3: Wire it into `PageHeader`** as an optional `freshness` slot, and pass `dataUpdatedAt` / `isFetching` from each screen's `useQuery` result.

- [ ] **Step 4: Verify** on brand `Orders`: load, background the tab 2 minutes, return. Expected: on focus the indicator flips to "Refreshing…", then to "Updated just now", and rows update without a skeleton.

- [ ] **Step 5: Commit.**

### Task 4.5: Poll the live surfaces, visibly and only when watched

**Files:** `admin-web` `Fulfillment.tsx`, `Exceptions.tsx`; `brand-web` `NotificationBell.tsx`

- [ ] **Step 1:** Add `refetchInterval: 20_000` to these queries only, and state `refetchIntervalInBackground: false` explicitly. That is already Query's default — write it anyway, because it is the property that matters most on a phone (a hidden tab stops polling, so a device in a pocket is not waking its radio every 20 seconds) and a future edit should have to delete it deliberately.
- [ ] **Step 2:** Delete `NotificationBell`'s hand-rolled `setInterval` and its `POLL_MS` constant; the query replaces it.
- [ ] **Step 3:** Verify with DevTools → Network: switch tabs, confirm polling stops; switch back, confirm an immediate refetch.
- [ ] **Step 4:** Commit.

---

## Phase 5 — Gates that test the real screens

The existing Playwright suite drives the `@ruostack/ui` gallery, because real routes sit behind auth. That means **no app screen is currently gated for mobile at all** — the regression this plan most needs to prevent is exactly the one nothing watches. Fix: mock the network, not the app. Real router, real screens, real components, no database.

### Task 5.1: Mount both apps under MSW

**Files:** Create `e2e/harness/brand.html`, `e2e/harness/admin.html`, `e2e/harness/handlers.ts`, `e2e/harness/main.tsx`, `vite.harness.config.ts`; modify root `package.json`

- [ ] **Step 1:** `pnpm add -Dw msw@^2.7.0`
- [ ] **Step 2:** Write `handlers.ts` returning realistic fixtures for every endpoint the gated routes touch — **including a long list** (300 ledger rows) and **a long single value** (a 120-character product name), because short fixtures are how overflow bugs pass CI and fail in production.
- [ ] **Step 3:** Write a harness entry that starts the MSW worker, stubs the auth context with a fixed brand/admin principal, and renders the app's real `<App />` under a `MemoryRouter` at a route from the query string.
- [ ] **Step 4:** Add `"harness": "vite --config vite.harness.config.ts"` and point `playwright.config.ts` at it, replacing the gallery server. Keep the gallery for component development.
- [ ] **Step 5:** Commit.

### Task 5.2: The responsive suite, over real routes

**Files:** Rewrite `e2e/responsive.spec.ts`

- [ ] **Step 1: Write it**

```ts
const WIDTHS = [360, 390, 768, 1024, 1440];

/* 360 is in the list deliberately: it is the narrowest Android viewport still
 * in real use, and it is where a three-fact meta line first wraps. */
const ROUTES = [
  { app: 'brand', path: '/app/overview' },
  { app: 'brand', path: '/app/orders' },
  { app: 'brand', path: '/app/wallet' },
  { app: 'admin', path: '/fulfillment' },
  { app: 'admin', path: '/ledger' },
  { app: 'admin', path: '/exceptions' },
];

for (const { app, path } of ROUTES) {
  for (const width of WIDTHS) {
    test(`${app}${path} fits ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/${app}.html?route=${encodeURIComponent(path)}`);
      await page.getByTestId('screen-ready').waitFor();

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, `${path} scrolls horizontally at ${width}px`).toBeLessThanOrEqual(clientWidth);
    });
  }
}
```

Note the wait: a `screen-ready` testid set once the query resolves, **not** `networkidle` — the old suite's `networkidle` never settles against a Vite dev server holding an HMR socket open.

- [ ] **Step 2: Assert no phone shows a table**

```ts
for (const { app, path } of ROUTES) {
  test(`${app}${path} renders cards, not a table, at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${app}.html?route=${encodeURIComponent(path)}`);
    await page.getByTestId('screen-ready').waitFor();
    await expect(page.getByRole('table')).toHaveCount(0);
  });
}
```

- [ ] **Step 3: Assert card lists stay uniform** — sample the first five `RecordCard` bounding boxes at 390px; heights must be equal within 2px unless the card has an action row. This is the automated form of "formatted correctly".

- [ ] **Step 4: Assert tap targets** — every `button`, `a` and `[role="button"]` within the viewport at 390px has a bounding box ≥44×44, excluding inline text links.

- [ ] **Step 5:** `pnpm test:e2e` → green. Commit.

### Task 5.3: A performance budget with teeth

**Files:** Create `e2e/performance.spec.ts`

- [ ] **Step 1: Assert the budgets** at 390px on a throttled Fast-3G profile with 4× CPU slowdown:

| Metric | Budget | Why |
|---|---|---|
| JS transferred, first route | ≤ 300 kB gzip | Entry + shell + one screen chunk |
| LCP | ≤ 2.5 s | Core Web Vitals "good" |
| CLS | ≤ 0.05 | Skeletons must match card geometry |
| INP on a card tap | ≤ 200 ms | Sheet must open without jank |

- [ ] **Step 2: Assert cache-hit navigation is instant** — navigate Overview → Orders → Overview and assert the second Overview paints rows with **zero** skeleton nodes. This is the direct regression test for Phase 4's whole purpose.

- [ ] **Step 3: Assert skeletons do not shift layout** — measure a card's box while loading and after data lands; the delta is the CLS contributor. If they differ, the skeleton is the wrong shape.

- [ ] **Step 4:** Add the suite to the existing `e2e` CI job. Commit.

---

## Phase 6 — Long lists, and the push question

### Task 6.1: Virtualize the two logs

**Files:** `packages/ui/src/data/DataTable.tsx`; `admin-web` `Ledger.tsx`, `AuditLog.tsx`

- [ ] **Step 1:** `pnpm --filter @ruostack/ui add @tanstack/react-virtual@^3.11.0`
- [ ] **Step 2:** Add `virtualize?: boolean` to `DataTableProps`. When set **and** `rows.length > 200`, window both the card list and the table body. Below the threshold, render normally — virtualizing a short list costs more than it saves and breaks browser find-in-page.
- [ ] **Step 3:** Enable it on `Ledger` and `AuditLog` only.
- [ ] **Step 4:** Verify with a 5,000-row fixture at 390px: scrolling stays at 60fps and memory is flat. Confirm the Phase 5 budgets still pass.
- [ ] **Step 5:** Commit.

### Task 6.2: Decide on push — do not build it reflexively

**This task is a decision, not an implementation.** Phase 4 gives every focused tab data no older than its revalidation window, and a visible statement of its own freshness. Before adding a transport, prove that is insufficient.

- [ ] **Step 1: Measure.** Instrument admin `Fulfillment` for two weeks: how often does a 20-second poll deliver a change, and what is the observed lag between an order becoming exportable and an operator seeing it?
- [ ] **Step 2: Judge against the cost.** SSE here is not one endpoint. It needs, at minimum:
  - `proxy_buffering off;` and a raised `proxy_read_timeout` (currently `60s`, buffered) in **both** `deploy/nginx/edge.conf.template` and `origin.conf.template`, plus an `X-Accel-Buffering: no` header;
  - connection lifecycle, heartbeat and reconnect-with-backoff in Fastify, and a per-connection auth check that respects the realm boundary;
  - a fan-out story if the API ever runs more than one PM2 instance.
- [ ] **Step 3: If it is justified,** scope it narrowly: one `/api/admin/events` SSE stream carrying *invalidation hints only* (`{"invalidate": ["fulfillment"]}`), never payloads. The client calls `queryClient.invalidateQueries` on receipt, so Query stays the single source of truth and a dropped connection degrades to polling rather than to a wrong screen.
- [ ] **Step 4: If it is not,** record that in this file and close the phase. A polling interval that has been measured and found adequate is a better outcome than a stream nobody needed.

---

## Verification gates

| Gate | Check | Added in |
|---|---|---|
| Mobile layout | `pnpm lint:mobile-tables` — no `DataTable` reaches a phone without a `card` spec | Phase 1, blocking from Phase 2 |
| Token contrast | `pnpm lint:contrast` — existing; extend to `surface-2`/`surface-3` and the tints | Phase 0 |
| Legacy classes | `pnpm lint:legacy-classes` — existing, unchanged | — |
| No horizontal overflow | Playwright, 6 real routes × 5 widths, MSW-backed | Phase 5 |
| Cards not tables on phones | Playwright, `getByRole('table')` count 0 at 390px | Phase 5 |
| Uniform card height | Playwright, first 5 card boxes equal within 2px | Phase 5 |
| Tap targets | Playwright, every interactive box ≥44×44 at 390px | Phase 5 |
| Performance budget | LCP ≤2.5s, CLS ≤0.05, INP ≤200ms, JS ≤300kB on Fast-3G/4×CPU | Phase 5 |
| Cache-hit navigation | Return navigation paints zero skeletons | Phase 5 |
| Build | `pnpm typecheck && pnpm -r test && pnpm build` | — |

## Risks

| Risk | Mitigation |
|---|---|
| Ranking columns for a card is a judgement call, and a bad ranking hides the field an operator actually scans for | Task 2.1 is the reference implementation; review it with an actual operator before Tasks 2.2–2.10 copy its shape. Getting this wrong is cheap to fix and expensive to discover late |
| Moving columns into a detail sheet adds a tap to workflows that used to be one glance | Accepted for phones, where the alternative is side-scrolling. Desktop keeps every column visible — the table is unchanged above `md` |
| Converting 37 fetch sites to Query is broad and touches every screen | Phased by domain (4.3a–4.3e), each independently shippable. The cache-hit Playwright assertion catches a screen that was converted but still blanks |
| `refetchOnWindowFocus` can surprise a user mid-edit by swapping data under an open form | Query does not touch a mutating form's local state; additionally, disable focus refetch on any screen with an open `Drawer` in edit mode |
| A stale `gcTime` cache could show one user another's data after a fast account switch | `queryClient.clear()` on sign-out (Task 4.1 Step 4), verified by an explicit switch-user check |
| MSW fixtures drift from the real API and the gate passes against a fiction | Fixtures are shaped from the route handlers' response types; a contract test asserting fixture shape against the API's TypeScript types is a reasonable Phase 5 addition if drift appears |
| Virtualization breaks find-in-page and anchor links | Threshold-gated to >200 rows, enabled on two read-only log screens only |

## Out of scope

- No API, Prisma, routing-semantics or auth changes in Phases 0–5. The only backend question is Task 6.2, which is explicitly a decision before it is an implementation.
- No new product features. `POLISH_TODO.md` stays deferred.
- No visual redesign — tokens, palette, typography, elevation and navigation from the 2026-08-05 system are kept as-is. This plan changes *layout and data behaviour*, not the look.
- No offline mode or cache persistence (see Task 4.1 Step 2 for why).
- No native app shell, service worker, or install prompt.
