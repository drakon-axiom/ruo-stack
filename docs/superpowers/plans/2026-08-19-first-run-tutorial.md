# First-Run Tutorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a five-slide welcome modal to brand users on their first login, recorded server-side, handing off to the getting-started checklist that already exists on Overview.

**Architecture:** One nullable `onboarding_completed_at` timestamp on `UserProfile` is the single source of truth. The API exposes it on the existing `GET /api/brand/me` and sets it through a new idempotent `POST /api/brand/onboarding/complete`, whose logic lives in a service function so it is testable without a Supabase-minted JWT. On the client, a root-level `OnboardingProvider` fetches that state once per session and renders a presentational `WelcomeTour` dialog built from the existing `@ruostack/ui` `Dialog`.

**Tech Stack:** Prisma 6 + Postgres (Supabase), Fastify + Zod, vitest, React 18 + react-router-dom 6, Tailwind, Radix (via `@ruostack/ui`).

**Spec:** `docs/superpowers/specs/2026-08-19-first-run-tutorial-design.md`

## Global Constraints

- **Package manager is pnpm.** Never run bare `npm`/`npx`. Filtered scripts: `pnpm --filter @ruostack/api test`, `pnpm --filter @ruostack/db run generate`.
- **Node imports inside `apps/api/src` use the `.ts` extension** (`from '../clients.ts'`). Inside `apps/brand-web/src` they use `.js` (`from './lib/api.js'`). Copy the convention of the file you are editing — mixing them breaks the build.
- **Migrations are hand-written and hand-numbered.** The directory pattern is `packages/db/prisma/migrations/000000000000NN_snake_case_name/migration.sql`. The last one is `00000000000028_brand_stripe_customer_unique`, so the next is `00000000000029_onboarding_completed_at`. Do NOT run `prisma migrate dev` — it invents its own timestamped directory name and breaks the sequence.
- **DB-integration tests self-skip** unless `RUN_DB_TESTS=1` and real connection strings are present. `describe.skipIf(!RUN)` is the required guard. A "passing" run that printed `skipped` has verified nothing — say so plainly rather than claiming the tests pass.
- **Brand routes cannot be authenticated in tests.** Brand tokens are minted by Supabase and verified against its JWKS. Positive-path coverage goes through Prisma/service functions; only negative (401/403) assertions may use `app.inject`.
- **Icons come only from `@ruostack/ui`**, which re-exports a curated lucide set (`packages/ui/src/icons.ts`). There is no `ArrowRight` — use `ChevronRight`. Never import from `lucide-react` directly.
- **Colours come from semantic Tailwind tokens** (`text-content`, `text-content-muted`, `text-content-faint`, `bg-canvas`, `bg-surface-2`, `border-line`, `text-accent`). Never hard-code hex or raw slate/gray classes — `pnpm lint:contrast` and `pnpm lint:legacy-classes` enforce this.
- **Commit messages** are sentence-case imperative with no `feat:`/`fix:` prefix (e.g. "Add the onboarding completion service"). Match the existing log.
- **Copy is fixed by the spec.** Slide titles and body text are given verbatim in Task 5. Do not paraphrase them.

---

## File Structure

**Create:**
- `packages/db/prisma/migrations/00000000000029_onboarding_completed_at/migration.sql` — adds the column, no backfill.
- `apps/api/src/services/onboarding.ts` — `completeOnboarding()`, the only place the timestamp is written.
- `apps/api/test/integration/brand-onboarding.test.ts` — DB-integration coverage for that service plus the route's auth gate.
- `apps/brand-web/src/components/welcomeSlides.ts` — slide copy as data, no JSX.
- `apps/brand-web/src/components/WelcomeTour.tsx` — presentational dialog, no data fetching.
- `apps/brand-web/src/lib/onboarding.tsx` — provider + `useOnboarding()` hook, the only place `/api/brand/me` onboarding state is fetched.

**Modify:**
- `packages/db/prisma/schema.prisma:127-135` — add the field to `UserProfile`.
- `apps/api/src/routes/brand.ts:92-122` — add the field to the `/me` response; add the new POST route.
- `apps/brand-web/src/main.tsx:12-22` — mount the provider.
- `apps/brand-web/src/screens/Account.tsx:6-17,143-148` — extend the `Me` interface; add the Help card.
- `apps/brand-web/src/screens/Overview.tsx:130-136` — add the progress count and bar.

---

### Task 1: Add the `onboarding_completed_at` column

**Files:**
- Modify: `packages/db/prisma/schema.prisma:127-135`
- Create: `packages/db/prisma/migrations/00000000000029_onboarding_completed_at/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `UserProfile.onboardingCompletedAt: Date | null` on the generated Prisma client. Tasks 2, 3 and 4 depend on it.

- [ ] **Step 1: Add the field to the Prisma model**

In `packages/db/prisma/schema.prisma`, the `UserProfile` model currently reads:

```prisma
model UserProfile {
  id                  String   @id @db.Uuid // == auth.users.id
  fullName            String   @map("full_name")
  nameLastChangedAt   DateTime? @map("name_last_changed_at") // enforces "name editable once / 7 days"
  createdAt           DateTime @default(now()) @map("created_at")
  updatedAt           DateTime @updatedAt @map("updated_at")

  @@map("user_profile")
}
```

Add one line after `nameLastChangedAt`:

```prisma
  onboardingCompletedAt DateTime? @map("onboarding_completed_at") // null = welcome tour not finished
```

- [ ] **Step 2: Write the migration by hand**

Create the directory and file. Do NOT run `prisma migrate dev`.

```bash
mkdir -p packages/db/prisma/migrations/00000000000029_onboarding_completed_at
cat > packages/db/prisma/migrations/00000000000029_onboarding_completed_at/migration.sql <<'SQL'
-- Records when a brand user finished the first-run welcome tour. NULL means
-- "not finished", which is what makes the tour fire on first login.
--
-- DELIBERATELY NOT BACKFILLED. Every existing profile stays NULL, so current
-- users see the explainer once on their next login. The tour is dismissable and
-- non-blocking, so a single interruption after deploy is an acceptable cost for
-- explaining the fulfillment model to brands who have been guessing at it.
--
-- A nullable timestamp rather than a boolean: it answers "did they finish" and
-- "when" in one column, making completion rate a query instead of an event table.

-- AlterTable
ALTER TABLE "user_profile" ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);
SQL
```

- [ ] **Step 3: Regenerate the Prisma client and verify the type exists**

```bash
pnpm --filter @ruostack/db run generate
```

Expected: `Generated Prisma Client` with no errors.

Then confirm the field reached the generated types:

```bash
grep -c "onboardingCompletedAt" packages/db/node_modules/.prisma/client/index.d.ts
```

Expected: a count greater than 0. If it prints `0`, the schema edit did not take — re-check Step 1 before continuing.

- [ ] **Step 4: Verify the migration applies cleanly**

Only if you have a database configured (`RUN_DB_TESTS=1` environments do):

```bash
pnpm db:deploy && pnpm db:status
```

Expected: the new migration is applied and status reports no pending migrations. If you have no database available, skip this step and say so explicitly in your report — do not claim it passed.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @ruostack/db typecheck
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/00000000000029_onboarding_completed_at
git commit -m "Add an onboarding-completed timestamp to the user profile"
```

---

### Task 2: The onboarding completion service

**Files:**
- Create: `apps/api/src/services/onboarding.ts`
- Test: `apps/api/test/integration/brand-onboarding.test.ts`

**Interfaces:**
- Consumes: `UserProfile.onboardingCompletedAt` from Task 1.
- Produces: `completeOnboarding(prisma: PrismaClient, userId: string): Promise<Date>` — idempotent; returns the existing timestamp if already set, otherwise sets and returns a new one; throws `NotFound` for an unknown user id. Task 3 calls it.

**Why a service and not inline route code:** brand routes are authenticated by a Supabase-minted JWT verified against Supabase's JWKS, so no test can mint a valid brand token. `apps/api/test/integration/brand-members.test.ts:7-11` states this; `security.test.ts:154` only uses `/api/brand/me` to assert a *wrong* token is rejected. Extracting the logic is what makes the positive path testable at all.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/brand-onboarding.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getPrisma } from '@ruostack/db';
import { randomToken } from '../../src/crypto.ts';
import { completeOnboarding } from '../../src/services/onboarding.ts';

/**
 * First-run tutorial state against a real DB. The HTTP layer can't be exercised
 * for the positive path — brand tokens are minted by Supabase and verified
 * against its JWKS — so this drives the service the route delegates to. The
 * route's auth gate is covered separately in Task 3.
 */
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('brand onboarding completion (DB integration)', () => {
  let brandId: string;
  const userId = randomUUID();

  beforeAll(async () => {
    const brand = await prisma.brand.create({
      data: { brandName: 'Onboarding Co', referralCode: `OB-${randomToken(5)}` },
    });
    brandId = brand.id;
    await prisma.userProfile.create({ data: { id: userId, fullName: 'New Brand Owner' } });
    await prisma.brandMember.create({
      data: { brandId, userId, role: 'owner', status: 'active' },
    });
    await prisma.brandUserRole.create({ data: { userId, brandId, realm: 'brand' } });
  });

  afterAll(async () => {
    await prisma.brandUserRole.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandMember.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.userProfile.deleteMany({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  const readTimestamp = async () =>
    (await prisma.userProfile.findUnique({
      where: { id: userId },
      select: { onboardingCompletedAt: true },
    }))!.onboardingCompletedAt;

  it('a freshly created profile has not completed onboarding', async () => {
    expect(await readTimestamp()).toBeNull();
  });

  it('completing onboarding stamps the profile', async () => {
    const before = Date.now();
    const at = await completeOnboarding(prisma, userId);

    expect(at).toBeInstanceOf(Date);
    expect(at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect((await readTimestamp())!.getTime()).toBe(at.getTime());
  });

  it('completing a second time keeps the ORIGINAL timestamp', async () => {
    const first = await readTimestamp();
    expect(first).not.toBeNull();

    const again = await completeOnboarding(prisma, userId);

    // This is the guarantee that makes "Replay welcome tour" safe: replaying and
    // dismissing must not move the completion time and destroy the analytics.
    expect(again.getTime()).toBe(first!.getTime());
    expect((await readTimestamp())!.getTime()).toBe(first!.getTime());
  });

  it('rejects an unknown user id rather than silently creating a row', async () => {
    const ghost = randomUUID();
    await expect(completeOnboarding(prisma, ghost)).rejects.toThrow(/not found/i);
    expect(await prisma.userProfile.findUnique({ where: { id: ghost } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
RUN_DB_TESTS=1 pnpm --filter @ruostack/api test -- brand-onboarding
```

Expected: FAIL — the import of `../../src/services/onboarding.ts` cannot be resolved.

If instead every test reports as *skipped*, `RUN_DB_TESTS=1` did not reach the runner or no database is configured. Resolve that before continuing; a skipped suite proves nothing.

- [ ] **Step 3: Write the service**

Create `apps/api/src/services/onboarding.ts`:

```ts
import type { PrismaClient } from '@ruostack/db';
import { NotFound } from '../errors.ts';

/**
 * Marks the brand user's first-run welcome tour as finished.
 *
 * Idempotent BY DESIGN, not by accident: the Account screen lets a user replay
 * the tour, and dismissing a replay must not overwrite the original completion
 * time — that timestamp is the onboarding-completion metric.
 */
export async function completeOnboarding(prisma: PrismaClient, userId: string): Promise<Date> {
  const profile = await prisma.userProfile.findUnique({
    where: { id: userId },
    select: { onboardingCompletedAt: true },
  });
  if (!profile) throw NotFound('Account not found');
  if (profile.onboardingCompletedAt) return profile.onboardingCompletedAt;

  const updated = await prisma.userProfile.update({
    where: { id: userId },
    data: { onboardingCompletedAt: new Date() },
  });
  return updated.onboardingCompletedAt!;
}
```

`packages/db/src/index.ts` does `export * from '@prisma/client'`, so `PrismaClient` is available from `@ruostack/db` — this import is correct as written. `services/wallet.ts:11` widens its own parameter to `PrismaClient | Prisma.TransactionClient` because it runs inside transactions; this one never does, so the plain client type is right.

- [ ] **Step 4: Run the test to verify it passes**

```bash
RUN_DB_TESTS=1 pnpm --filter @ruostack/api test -- brand-onboarding
```

Expected: 4 passed. Not skipped.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/onboarding.ts apps/api/test/integration/brand-onboarding.test.ts
git commit -m "Add the onboarding completion service"
```

---

### Task 3: Expose onboarding state on the API

**Files:**
- Modify: `apps/api/src/routes/brand.ts:92-122`
- Test: `apps/api/test/integration/brand-onboarding.test.ts` (append one test)

**Interfaces:**
- Consumes: `completeOnboarding()` from Task 2.
- Produces:
  - `GET /api/brand/me` → `profile.onboarding_completed_at: string | null` (ISO date, serialized from `Date`).
  - `POST /api/brand/onboarding/complete` → `{ onboarding_completed_at: string }`.
  Task 6 consumes both.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/integration/brand-onboarding.test.ts`, inside the existing `describe` block. Add the two imports at the top of the file alongside the existing ones:

```ts
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
```

Then add, as the last test in the block:

```ts
  it('the completion route refuses an unauthenticated caller', async () => {
    // The only assertion the HTTP layer can make here: a valid brand token is
    // minted by Supabase and cannot be forged in a test, so the positive path
    // is covered against the service above instead.
    const app: FastifyInstance = await buildApp();
    await app.ready();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/brand/onboarding/complete' });
      expect([401, 403]).toContain(res.statusCode);

      const garbage = await app.inject({
        method: 'POST',
        url: '/api/brand/onboarding/complete',
        headers: { authorization: 'Bearer not-a-real-jwt' },
      });
      expect([401, 403]).toContain(garbage.statusCode);
    } finally {
      await app.close();
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
RUN_DB_TESTS=1 pnpm --filter @ruostack/api test -- brand-onboarding
```

Expected: FAIL — the route does not exist, so Fastify returns 404 and `[401, 403]` does not contain it.

- [ ] **Step 3: Add the field to `GET /api/brand/me`**

In `apps/api/src/routes/brand.ts`, the handler at line 92 currently returns:

```ts
      profile: {
        id: profile.id,
        full_name: profile.fullName,
        name_last_changed_at: profile.nameLastChangedAt,
        name_editable: !profile.nameLastChangedAt || Date.now() - profile.nameLastChangedAt.getTime() >= NAME_LOCK_MS,
      },
```

Add one line:

```ts
        onboarding_completed_at: profile.onboardingCompletedAt,
```

- [ ] **Step 4: Add the completion route**

Add the import to the existing import block at the top of `brand.ts` (it already imports `effectivePlan` from `../services/subscription.ts` — follow that form):

```ts
import { completeOnboarding } from '../services/onboarding.ts';
```

Then add the route immediately after the `GET /api/brand/me` handler closes:

```ts
  // ── First-run welcome tour ────────────────────────────────────────────────
  // requireBrand, not requireBrandSurface: onboarding state is per-USER, so a
  // staff member must be able to dismiss their own tour. The surface gate exists
  // to separate owner from staff on brand-wide resources, which this is not.
  app.post('/api/brand/onboarding/complete', { preHandler: requireBrand }, async (req) => {
    const at = await completeOnboarding(prisma, req.brand!.userId);
    return { onboarding_completed_at: at };
  });
```

Not written to `AuditLog` — that table records sensitive brand actions (profile edits, member role changes, email changes), and adding tour dismissals would dilute it.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
RUN_DB_TESTS=1 pnpm --filter @ruostack/api test -- brand-onboarding
```

Expected: 5 passed.

- [ ] **Step 6: Run the full API suite for regressions**

```bash
pnpm --filter @ruostack/api test
pnpm --filter @ruostack/api typecheck
```

Expected: all pass. `surface-coverage.test.ts` asserts every *declared* owner-only surface is attached to a route; the new route declares no surface, so it must stay green. If it fails, you added `requireBrandSurface` by mistake.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/brand.ts apps/api/test/integration/brand-onboarding.test.ts
git commit -m "Expose and record welcome-tour completion on the brand API"
```

---

### Task 4: The slide copy

**Files:**
- Create: `apps/brand-web/src/components/welcomeSlides.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WELCOME_SLIDES: readonly WelcomeSlide[]` where `interface WelcomeSlide { title: string; body: string }`, and `slideTitle(slide: WelcomeSlide, firstName: string): string`. Task 5 consumes both.

Copy is fixed by the spec. Reproduce it exactly.

- [ ] **Step 1: Write the file**

```bash
cat > apps/brand-web/src/components/welcomeSlides.ts <<'EOF'
/**
 * Copy for the first-run welcome tour, kept as data and separate from the
 * component so a wording change never touches navigation logic.
 *
 * Slide 1's title carries a `{name}` placeholder rather than being assembled in
 * the component — that keeps every user-visible string in this one file.
 */
export interface WelcomeSlide {
  title: string;
  body: string;
}

export const WELCOME_SLIDES: readonly WelcomeSlide[] = [
  {
    title: 'Welcome to RUOStack, {name}',
    body: 'You sell research peptides under your own brand. We hold the stock, pack each order, and ship it in your packaging. Your customers never see us.',
  },
  {
    title: 'Your wallet pays for fulfillment',
    body: 'You keep a prepaid balance. When an order comes in we charge your wallet for the product plus shipping; whatever your customer paid you above that is your margin. The Profit Calculator prices this out before you commit.',
  },
  {
    title: 'The catalog is your product line',
    body: 'Browse the research peptide catalog, set your own retail price on each product, and push them to your store. Every product carries a COA you can hand to customers.',
  },
  {
    title: 'Orders run themselves',
    body: 'Orders flow in from your connected store. We pack and ship them, and tracking comes back into the app on its own. Anything that needs a decision from you lands under Action Required.',
  },
  {
    title: 'Four things to set up',
    body: "Connect your store, fund your wallet, set your retail prices, and place your first order. We'll keep this list on your Overview page until it's done.",
  },
] as const;

/**
 * Fills the `{name}` placeholder with the user's first name. Falls back to a
 * clean greeting when we have no name — "Welcome to RUOStack, " with a dangling
 * comma is worse than no personalisation at all.
 */
export function slideTitle(slide: WelcomeSlide, firstName: string): string {
  if (!slide.title.includes('{name}')) return slide.title;
  if (!firstName) return slide.title.replace(', {name}', '');
  return slide.title.replace('{name}', firstName);
}
EOF
```

- [ ] **Step 2: Verify it typechecks**

```bash
pnpm --filter @ruostack/brand-web typecheck
```

Expected: no errors. (The file is not imported yet; this only proves it is valid TypeScript.)

- [ ] **Step 3: Commit**

```bash
git add apps/brand-web/src/components/welcomeSlides.ts
git commit -m "Add the welcome tour slide copy"
```

---

### Task 5: The `WelcomeTour` dialog

**Files:**
- Create: `apps/brand-web/src/components/WelcomeTour.tsx`

**Interfaces:**
- Consumes: `WELCOME_SLIDES`, `slideTitle`, `WelcomeSlide` from Task 4; `Dialog`, `Button`, `ChevronLeft`, `ChevronRight`, `cn` from `@ruostack/ui`.
- Produces: `<WelcomeTour open={boolean} firstName={string} onDismiss={(finished: boolean) => void} />`. Task 6 renders it.

`onDismiss` takes a boolean rather than being two callbacks because the caller needs to tell *finishing* from *bailing out*: both persist completion, but only a user who read to the end gets navigated to Overview.

Purely presentational — it fetches nothing and knows nothing about the API. Its only state is the current slide index.

- [ ] **Step 1: Write the component**

```bash
cat > apps/brand-web/src/components/WelcomeTour.tsx <<'EOF'
import { useEffect, useState } from 'react';
import { Button, ChevronLeft, ChevronRight, Dialog, cn } from '@ruostack/ui';
import { WELCOME_SLIDES, slideTitle } from './welcomeSlides.js';

/**
 * The first-run welcome tour: five slides explaining the white-label
 * fulfillment model, ending by pointing at the Get started checklist on
 * Overview.
 *
 * Presentational only — whether it should be open, and what dismissing it
 * persists, belong to lib/onboarding.tsx. This component just walks slides and
 * reports that the user is done.
 *
 * EVERY exit path reports dismissal: Skip, the Dialog's X, Escape, an overlay
 * click, and finishing the last slide. The tour is informational, so there is no
 * reason to trap anyone in it, and a user who escapes past it has still made a
 * decision about it. Radix funnels all four close gestures through
 * `onOpenChange`, so that is one handler rather than five.
 */
export function WelcomeTour({
  open,
  firstName,
  onDismiss,
}: {
  open: boolean;
  firstName: string;
  /** true = reached the end and pressed Get started; false = skipped, X, Esc, overlay. */
  onDismiss: (finished: boolean) => void;
}) {
  const [index, setIndex] = useState(0);
  const slide = WELCOME_SLIDES[index];
  const isLast = index === WELCOME_SLIDES.length - 1;

  // Restart at slide 1 whenever the tour is reopened, so a replay from Account
  // does not drop the user back on whichever slide they quit from.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss(false);
      }}
      title={slideTitle(slide, firstName)}
    >
      <p className="text-sm leading-relaxed text-content-muted">{slide.body}</p>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" aria-hidden>
          {WELCOME_SLIDES.map((s, i) => (
            <span
              key={s.title}
              className={cn(
                'h-1.5 rounded-full transition-all duration-fast',
                i === index ? 'w-4 bg-accent' : 'w-1.5 bg-line',
              )}
            />
          ))}
        </div>
        <span className="text-2xs text-content-faint">
          Step {index + 1} of {WELCOME_SLIDES.length}
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
        <Button variant="ghost" size="sm" onClick={() => onDismiss(false)}>
          Skip
        </Button>
        <div className="flex gap-2">
          {index > 0 && (
            <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => setIndex((i) => i - 1)}>
              Back
            </Button>
          )}
          <Button
            size="sm"
            icon={ChevronRight}
            onClick={() => (isLast ? onDismiss(true) : setIndex((i) => i + 1))}
          >
            {isLast ? 'Get started' : 'Next'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
EOF
```

- [ ] **Step 2: Check the `Button` and `Dialog` props you just used actually exist**

```bash
grep -n "icon\|variant\|size" packages/ui/src/primitives/Button.tsx | head -20
```

Expected: `Button` accepts `variant`, `size`, and `icon` — `Shell.tsx:100-109` passes all three.

`duration-fast` and `bg-line` are already confirmed: `packages/ui/tailwind-preset.js:76` defines `transitionDuration: { fast, pop, sheet }` and line 27 defines the `line` colour scale. No fallback needed.

If `Button` does not accept an `icon` prop, drop the `icon={...}` props — the labels alone are sufficient and the tour must not block on a UI-package change.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @ruostack/brand-web typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/brand-web/src/components/WelcomeTour.tsx
git commit -m "Add the welcome tour dialog"
```

---

### Task 6: The onboarding provider

**Files:**
- Create: `apps/brand-web/src/lib/onboarding.tsx`
- Modify: `apps/brand-web/src/main.tsx:12-22`

**Interfaces:**
- Consumes: `WelcomeTour` from Task 5; `useAuth` from `./auth.js`; `api` from `./api.js`; the `GET /api/brand/me` and `POST /api/brand/onboarding/complete` contracts from Task 3.
- Produces: `<OnboardingProvider>` and `useOnboarding(): { replay(): void }`. Task 7 calls `replay()`.

**Mount point matters.** The provider goes in `main.tsx` inside `AuthProvider`, NOT inside `Protected`. `Protected` is instantiated separately for each of the eighteen routes in `App.tsx:81-101`, so it unmounts and remounts on every navigation — a provider there would refetch `/api/brand/me` and re-evaluate the modal on every screen change.

- [ ] **Step 1: Write the provider**

```bash
cat > apps/brand-web/src/lib/onboarding.tsx <<'EOF'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.js';
import { api } from './api.js';
import { WelcomeTour } from '../components/WelcomeTour.js';

interface OnboardingCtx {
  /** Reopen the tour without touching server state (Account → Replay). */
  replay(): void;
}

const Ctx = createContext<OnboardingCtx | null>(null);

interface MeOnboarding {
  profile: { full_name: string; onboarding_completed_at: string | null };
}

/**
 * Decides whether the first-run welcome tour is on screen.
 *
 * Mounted at the ROOT (main.tsx), not inside Protected: Protected is
 * instantiated per-route, so it remounts on every navigation and a provider
 * living there would refetch /api/brand/me and re-evaluate the modal each time
 * the user changed screens. Here it fetches once per session.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [checked, setChecked] = useState(false);

  // Only signed-in users inside the app shell. A signed-in user who navigates
  // back to /login would otherwise get a welcome modal over the login form.
  const eligible = Boolean(session) && pathname.startsWith('/app');

  useEffect(() => {
    if (!eligible || checked) return;
    let cancelled = false;
    void api<MeOnboarding>('/api/brand/me')
      .then((me) => {
        if (cancelled) return;
        setFirstName(me.profile.full_name.trim().split(/\s+/)[0] ?? '');
        if (!me.profile.onboarding_completed_at) setOpen(true);
        setChecked(true);
      })
      .catch(() => {
        // A failed /me read must never wedge the app. Treat it as "already
        // onboarded" and stop asking — the tour is a nicety, not a gate.
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eligible, checked]);

  // Forget what we learned when the session ends, so signing in as a different
  // user re-evaluates rather than reusing the previous user's answer.
  useEffect(() => {
    if (!session) {
      setChecked(false);
      setOpen(false);
      setFirstName('');
    }
  }, [session]);

  const dismiss = useCallback(
    (finished: boolean) => {
      // Close first, persist second, and never await: the user should not wait on
      // a network round-trip to dismiss an explainer. A failed write costs them one
      // extra viewing, which is strictly better than a modal that will not close.
      setOpen(false);
      void api('/api/brand/onboarding/complete', { method: 'POST' }).catch(() => undefined);
      // Slide 5 tells the user their checklist lives on Overview, so finishing
      // takes them there. Someone who hit Skip asked to be left alone, and
      // yanking them to another screen is not that.
      if (finished) navigate('/app/overview');
    },
    [navigate],
  );

  const replay = useCallback(() => setOpen(true), []);

  return (
    <Ctx.Provider value={{ replay }}>
      {children}
      {eligible && <WelcomeTour open={open} firstName={firstName} onDismiss={dismiss} />}
    </Ctx.Provider>
  );
}

export function useOnboarding(): OnboardingCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOnboarding outside OnboardingProvider');
  return ctx;
}
EOF
```

- [ ] **Step 2: Mount it in `main.tsx`**

`apps/brand-web/src/main.tsx` currently renders:

```tsx
    <ThemeProvider storageKey="ruostack_theme">
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
```

Change the inner two lines so `App` is wrapped, and add the import next to the existing `AuthProvider` import:

```tsx
import { OnboardingProvider } from './lib/onboarding.js';
```

```tsx
        <AuthProvider>
          <OnboardingProvider>
            <App />
          </OnboardingProvider>
        </AuthProvider>
```

The order matters: `OnboardingProvider` calls both `useAuth()` and `useLocation()`, so it must sit inside `AuthProvider` and inside `BrowserRouter`.

- [ ] **Step 3: Typecheck and build**

```bash
pnpm --filter @ruostack/brand-web typecheck
pnpm --filter @ruostack/brand-web build
```

Expected: both succeed.

- [ ] **Step 4: Verify the tour actually appears**

Start the app and sign in as a user whose `onboarding_completed_at` is null:

```bash
pnpm dev:brand
```

Then in a separate shell, confirm the state you are testing against:

```bash
# expect: onboarding_completed_at is NULL for your test user
pnpm --filter @ruostack/db run studio
```

In the browser: sign in → the tour appears → walk all five slides → `Get started` closes it and lands on `/app/overview`. Sign out and back in → it does not reappear.

Signup and login both land on `/app/account` (`Auth.tsx:67,114`) and those routes stay unchanged — the tour does the routing, so nothing changes for returning users who already dismissed it.

If you cannot run the app in your environment, say so explicitly rather than reporting this step as done.

- [ ] **Step 5: Commit**

```bash
git add apps/brand-web/src/lib/onboarding.tsx apps/brand-web/src/main.tsx
git commit -m "Show the welcome tour on a brand user's first login"
```

---

### Task 7: Replay the tour from Account

**Files:**
- Modify: `apps/brand-web/src/screens/Account.tsx:6-17` (the `Me` interface) and near line 143 (the new card)

**Interfaces:**
- Consumes: `useOnboarding()` from Task 6.
- Produces: nothing further tasks depend on.

Account is the durable home for this. Unlike the Overview checklist, it does not disappear once setup is complete, so the explainer stays reachable indefinitely.

- [ ] **Step 1: Extend the `Me` interface**

`apps/brand-web/src/screens/Account.tsx` declares its own `Me` shape at line 6. It must match what `GET /api/brand/me` now returns (Task 3) or the field is invisible to TypeScript. Change the `profile` member from:

```ts
  profile: { id: string; full_name: string; name_last_changed_at: string | null; name_editable: boolean };
```

to:

```ts
  profile: {
    id: string;
    full_name: string;
    name_last_changed_at: string | null;
    name_editable: boolean;
    onboarding_completed_at: string | null;
  };
```

- [ ] **Step 2: Wire up the hook**

Add the import alongside the existing `api` import at the top of the file:

```ts
import { useOnboarding } from '../lib/onboarding.js';
```

Inside `export function Account()`, next to the other hooks (just after `const [err, setErr] = useState('');`):

```ts
  const { replay } = useOnboarding();
```

Declare it above the `if (!me) return ...` early return at line 95 — React hooks must not sit below a conditional return.

- [ ] **Step 3: Add the Help card**

The screen already has a local `Section` helper (line 20) that renders a titled `Card`. Add one more `Section` immediately after the existing `Referrals` section and before the closing `</>`:

```tsx
      <Section title="Help">
        <p className="mb-3 text-sm text-content-muted">
          New to the platform? Walk through how fulfillment works again.
        </p>
        <Button variant="ghost" onClick={replay}>Replay welcome tour</Button>
      </Section>
```

`Button` and `Section` are both already imported in this file — no new imports beyond Step 2.

- [ ] **Step 4: Typecheck and build**

```bash
pnpm --filter @ruostack/brand-web typecheck
pnpm --filter @ruostack/brand-web build
```

Expected: both succeed.

- [ ] **Step 5: Verify replay works, and that it does not move the timestamp**

With the app running (`pnpm dev:brand`), as a user who has already dismissed the tour: Account → **Replay welcome tour** → the tour opens on slide 1 → Skip → reload the page → it does not auto-open.

Then confirm in the database that `onboarding_completed_at` did NOT change:

```bash
pnpm --filter @ruostack/db run studio
```

That unchanged timestamp is the entire point of the idempotency in Task 2. If it moved, `completeOnboarding` is missing its early return.

- [ ] **Step 6: Commit**

```bash
git add apps/brand-web/src/screens/Account.tsx
git commit -m "Let users replay the welcome tour from Account"
```

---

### Task 8: Progress on the existing Overview checklist

**Files:**
- Modify: `apps/brand-web/src/screens/Overview.tsx:130-136`

**Interfaces:**
- Consumes: the `checklist` object already returned by `GET /api/brand/overview`.
- Produces: nothing.

The card, its data source, the per-item CTAs, and the auto-hide-when-complete behaviour all already exist and stay as they are. This adds only a count and a bar, because the card currently gives no sense of how far along the user is.

- [ ] **Step 1: Add the progress count and bar**

In `apps/brand-web/src/screens/Overview.tsx`, this line already exists near line 90:

```tsx
  const checklistDone = data ? CHECKLIST.every((c) => data.checklist[c.key]) : true;
```

Add beneath it:

```tsx
  const checklistCount = data ? CHECKLIST.filter((c) => data.checklist[c.key]).length : 0;
```

Then replace the card's header block, currently:

```tsx
          <h2 className="mb-1 text-lg font-semibold">Get started</h2>
          <p className="mb-3 text-xs text-content-muted">
            A few steps to start fulfilling under your label.
          </p>
```

with:

```tsx
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Get started</h2>
            <span className="text-xs text-content-muted">
              {checklistCount} of {CHECKLIST.length} done
            </span>
          </div>
          <p className="mb-3 text-xs text-content-muted">
            A few steps to start fulfilling under your label.
          </p>
          <div
            className="mb-4 h-1.5 overflow-hidden rounded-full bg-line-subtle"
            role="progressbar"
            aria-valuenow={checklistCount}
            aria-valuemin={0}
            aria-valuemax={CHECKLIST.length}
            aria-label="Setup progress"
          >
            <div
              className="h-full rounded-full bg-accent transition-all duration-pop"
              style={{ width: `${(checklistCount / CHECKLIST.length) * 100}%` }}
            />
          </div>
```

Both tokens are confirmed present in `packages/ui/tailwind-preset.js`: `line.subtle` is a colour (line 27), so `bg-line-subtle` resolves, and `transitionDuration` (line 76) defines exactly `fast`, `pop`, and `sheet` — there is no `duration-base`, `duration-normal`, or numeric duration in this design system. Do not invent one.

- [ ] **Step 2: Typecheck and lint**

```bash
pnpm --filter @ruostack/brand-web typecheck
pnpm lint:contrast
pnpm lint:legacy-classes
```

Expected: all pass. The two lint scripts are what catch hard-coded colours.

- [ ] **Step 3: Verify visually**

With the app running, on Overview as a user with partial setup: the card shows `1 of 4 done` (or whatever is accurate) and the bar is filled proportionally. Complete all four and confirm the whole card still disappears.

- [ ] **Step 4: Commit**

```bash
git add apps/brand-web/src/screens/Overview.tsx
git commit -m "Show setup progress on the Overview checklist"
```

---

### Task 9: Full verification

**Files:** none — this task changes nothing.

- [ ] **Step 1: Run every gate**

```bash
pnpm typecheck
pnpm test
pnpm lint:contrast
pnpm lint:legacy-classes
pnpm lint:stripe-guard
pnpm build
```

Expected: all pass. Record the actual output. If `pnpm test` reports the onboarding integration tests as *skipped* because `RUN_DB_TESTS` is unset, say so — do not report them as passing.

- [ ] **Step 2: Run the DB-integration suite deliberately**

```bash
RUN_DB_TESTS=1 pnpm --filter @ruostack/api test
```

Expected: the onboarding tests run and pass rather than skip.

- [ ] **Step 3: Walk the manual QA checklist**

The spec lists these because there is no frontend test runner. Every one is unverified until a human does it:

1. Fresh signup → tour appears → walk all five slides → `Get started` lands on Overview.
2. Sign out, sign back in → tour does not reappear.
3. Fresh signup → press Escape on slide 1 → sign out and back in → tour does not reappear.
4. Sign in on a second browser with the same account → tour does not appear.
5. Account → Replay welcome tour → tour opens; dismiss it; reload → tour does not auto-open, and `onboarding_completed_at` is unchanged.
6. Both light and dark themes, and at 390px width — `Dialog` is `max-w-lg` on a viewport-relative width, so the longest slide (slide 2) must not overflow on a phone.

- [ ] **Step 4: Report honestly**

State which steps ran, which were skipped, and why. A step you could not execute is a step that did not pass.
