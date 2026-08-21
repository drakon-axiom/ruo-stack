# Admin-managed subscription plans — implementation plan

## Context

Plan pricing is wrong in the customer portal and there is no way to fix it without a code deploy. The underlying cause is that **three unlinked systems each claim to know what a plan costs**:

| Authority | Value today | Role |
|---|---|---|
| `packages/shared/src/plans.ts:60,76` — `priceCents` | Pro `4900`, Volume `14900` | **Display only.** Feeds the plan cards and the Profit calculator. |
| Stripe Price objects, ids in `STRIPE_PRO_PRICE_ID` / `STRIPE_VOLUME_PRICE_ID` | whatever is in the Stripe dashboard | **What actually charges.** |
| `SubscriptionState.price` (`schema.prisma:630`) | snapshot from webhooks | Written, never read. A dead column. |

Nothing connects them. Editing `plans.ts` makes the portal advertise a price Stripe does not charge, with no type error and no failing test.

**Both prices are currently stale — the intent is to reprice.** So the goal is not only to correct today's numbers but to collapse the three authorities into one, so the next reprice is a form field rather than a deploy plus a dashboard visit that can silently disagree.

### Pre-flight, verified 2026-08-20

| Check | Result |
|---|---|
| `subscription_state` rows | **0** — none at all. 2 brands, both with a `stripeCustomerId`, no subscriptions. |
| Stripe `STRIPE_PRO_PRICE_ID` | `4900` ($49.00), usd, monthly, active, `prod_UgiqX47jHMYFkp`, no `lookup_key` |
| Stripe `STRIPE_VOLUME_PRICE_ID` | `14900` ($149.00), usd, monthly, active, `prod_UgiqEbJr1sXsnM`, no `lookup_key` |
| Stripe mode | **test** (`sk_test_…`) |

Two consequences:

1. **`plans.ts` and Stripe agree today.** There is no live drift to correct — the numbers are simply the old ones. The defect is structural: nothing *keeps* them in step once a reprice happens. This does not change the design, but it does mean Task 4's "seed from Stripe, not from `plans.ts`" is currently a no-op difference. Keep it anyway; it is the right rule the moment the two diverge.
2. **Zero subscribers is confirmed, not assumed.** The Phase 1 / Phase 2 split stands, and Task 8's `migration_required` guard is currently unreachable — which is exactly why it must be written now, while nothing depends on it being right.

Each tier already has its own Stripe Product, so Task 4 records the existing ids rather than creating new ones. Re-run `apps/api/src/scripts/plan-preflight.ts` before Phase 2 to re-confirm the subscriber count.

### The decisive constraint: there are no paid subscribers yet

The platform is live but nobody is on Pro or Volume. That changes what should be built now:

- The entire subscriber-migration apparatus — proration, ineligible-state handling, notice emails — currently protects a population of **zero**.
- The first price change is therefore **completely free of customer risk**.
- But the primitives that make repricing safe *later* are cheap now and expensive once money is flowing.

So this plan is **two phases**, and Phase 2 is deliberately not built yet:

- **Phase 1 (build now):** one source of truth, versioned prices, correct Stripe write-through, checkout quote-honoring, and three latent-bug fixes. Repricing works end to end and affects new signups only.
- **Phase 2 (build before the first paid subscriber's second renewal):** the subscriber-migration worker and customer notice. Phase 1 hard-blocks a price change once subscribers exist, so this cannot be forgotten.

### Decisions taken

- DB is the source of truth, with write-through to Stripe.
- Existing subscribers migrate at next renewal, no proration (Phase 2 — policy fixed now, mechanism built later).
- Scope is the three existing tiers. No creating or retiring tiers. `PlanTier` is a Postgres enum and `CatalogProduct` has one hardcoded `wholesale<Tier>` column per tier, so a fourth tier is a separate schema project.
- Starter stays free and locked, enforced by a DB constraint, not just a disabled input.
- Consolidate the duplicated plan copy and remove the dead structured fields.

### One recommendation that changes the agreed scope

**Capability flags (`maxOrdersPerMonth`, `storeConnections`, `shipping`, `shippingCutoff`) should stay code-owned in v1**, rather than being editable as originally scoped. They behave nothing like price:

- A price change creates a new Stripe object and takes effect at renewal.
- A capability change takes effect **the instant Save is pressed, retroactively, for the rest of every brand's cycle**, with no Stripe event and no record of which orders priced under which rule.

Dropping Starter's cap from 20 to 5 immediately hard-blocks order creation (`brand-orders.ts:48-54`) for anyone already past 5 that month. Flipping `shipping` from `live` to `flat` changes what every quote costs mid-cart (`services/shipping.ts:57`).

`shippingCutoff` is the exception and should become editable — it is pure display today (dead as a structured field, restated as prose in `features[]`), so making it live costs nothing.

**If you want the other three flags editable, say so and I will add Task 12** — a per-flag impact preview plus confirm step. It roughly doubles the admin screen. The rest of the plan is unaffected either way.

---

## Customer impact, and how it is contained

Eight brand-facing surfaces read plan data. Ranked by damage when they shift mid-operation:

| Surface | Reads | Damage |
|---|---|---|
| **Checkout** `brand-billing.ts:57` | price id | **Charged a price they never saw** |
| **Order creation** `brand-orders.ts:48,59` | cap, wholesale column | Blocked mid-session; unit cost ≠ catalog quote |
| Plan picker `Account.tsx:283` | `price_cents` | Stale number |
| Profit calculator `Profit.tsx:82` | `price_cents` | Break-even silently wrong |
| Rate quotes `services/shipping.ts:57` | `shipping` | Shipping cost changes mid-cart |
| Store connect `brand-store.ts:34` | `storeConnections` | Feature vanishes mid-setup |
| Catalog `brand.ts:244` | wholesale column | Displayed ≠ charged |
| Overview KPI | plan key | Cosmetic |

**Already safe:** `OrderItem.unitWholesaleCents` (`schema.prisma:812`) and `Order.wholesaleTotalCents` / `shippingTotalCents` are snapshotted at order time. **Completed orders are immune to any later admin action.** Exposure is confined to in-flight operations.

**The one dangerous window is checkout.** Brand loads the picker at 10:00 seeing $49 → admin reprices at 10:01 → brand clicks Subscribe at 10:02 → server resolves the price *at click time* and charges $69. A consent mismatch, and a one-click admin reprice turns a latent race into a routine one.

### The governing principle

**Money operations are additive and versioned, never in-place. Every customer-facing quote carries the version it was quoted at.**

Four rails implement it:

1. **Quote token round-trip** (Task 7). The plan card carries `price_version_id`; `POST /billing/subscribe` sends it back; the server refuses a stale one with `price_changed` and a *"Pricing has changed — please review"* message rather than silently charging more. Converts a race into a checkable condition.
2. **Append-only versions** (Task 3). New Stripe Price + new row; old rows never mutated. In-flight Stripe Checkout sessions keep working on the price they were created with.
3. **Deferred archive** (Task 8). The old Stripe price is archived by a sweeper ~48h later, not on save, so Checkout sessions (~24h TTL) drain first. Archiving never affects existing subscriptions — only new use.
4. **Boundary semantics** for anything gating live work — the reason capability flags stay code-owned in v1.

No downtime, no maintenance window, no "plans locked" banner. An admin repricing at noon is invisible to every brand except those loading the picker afterwards.

---

## Three latent bugs this closes

These are live today and worth fixing regardless of the admin screen.

1. **`services/subscription.ts:40` — `plan: u.plan ?? 'pro'`.** `planForPrice()` (`webhook.ts:11-17`) only recognises the two env-var price ids. The moment prices rotate, an unrecognised price defaults a brand to **Pro**. The tier is not cosmetic: it selects the wholesale column charged to the wallet on *every order* (`brand-orders.ts:59,148`), the order cap, and the shipping mode. A Volume subscriber would pay $149/mo and be billed Pro wholesale indefinitely. **Fix: never default — throw, and let the webhook retry.**
2. **`stripe-adapter.ts:87-89` — no `proration_behavior`.** Stripe defaults to `create_prorations`. Any future migration would put proration lines on every subscriber's next invoice. **Fix: default the adapter to `'none'`, require explicit opt-in for prorations, and assert `billing_cycle_anchor` is never set** — `anchor: 'now'` plus `proration: 'none'` is a straight double bill and is the most expensive single keystroke available here.
3. **`Account.tsx:236` — `` `$${c / 100}/mo` ``** with no `.toFixed(2)`. A price of `4950` renders as **"$49.5/mo"**.

---

## Data model

Three tables. The central move: **`price_cents` and `stripe_price_id` live in the same immutable row**, inserted together from the Stripe response. The displayed number and the charging id cannot diverge because they are never written separately.

```prisma
model Plan {
  key               PlanTier @id                          // starter | pro | volume — enum makes "no new tiers" a DB guarantee
  name              String
  features          String[] @default([])
  shippingCutoff    String   @map("shipping_cutoff")       // display-only, now actually read
  storeConnections  Boolean  @map("store_connections")     // code-owned in v1; column exists for Phase 2
  maxOrdersPerMonth Int?     @map("max_orders_per_month")
  shipping          ShippingMode
  stripeProductId   String?  @map("stripe_product_id")
  updatedBy         String?  @map("updated_by") @db.Uuid
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")
  prices            PlanPrice[]
  @@map("plan")
}

// Append-only price ledger. Rows are never updated except to flip active/archivedAt.
model PlanPrice {
  id            String    @id @default(uuid()) @db.Uuid
  plan          PlanTier
  priceCents    Int       @map("price_cents")
  stripePriceId String?   @unique @map("stripe_price_id")  // null while pending; null forever for starter
  active        Boolean   @default(false)
  archivedAt    DateTime? @map("archived_at")
  createdBy     String?   @map("created_by") @db.Uuid
  createdAt     DateTime  @default(now()) @map("created_at")
  planRow       Plan      @relation(fields: [plan], references: [key], onDelete: Cascade)
  @@index([plan, active])
  @@map("plan_price")
}
```

Note there is **no `priceCents` on `Plan`**. That absence is the fix.

Two constraints Prisma cannot express, written by hand (precedent: `migrations/00000000000022_announcements/migration.sql:53-59`):

```sql
-- Exactly one live price per tier: "what does Pro cost" has one answer.
CREATE UNIQUE INDEX "plan_price_one_active_per_plan" ON "plan_price" ("plan") WHERE "active";

-- Starter is free and has no Stripe price. This is the enforcement, not the disabled input.
ALTER TABLE "plan_price" ADD CONSTRAINT "plan_price_starter_free_ck" CHECK (
  ("plan" = 'starter' AND "price_cents" = 0 AND "stripe_price_id" IS NULL)
  OR ("plan" <> 'starter' AND ("stripe_price_id" IS NOT NULL OR NOT "active"))
);
```

The Starter half is load-bearing: `effectivePlan()` (`services/subscription.ts:111-119`) returns `'starter'` for every lapsed, cancelled and unsubscribed brand. A nonzero Starter price would reclassify the entire lapsed population as paying.

All tables get `ENABLE`/`FORCE ROW LEVEL SECURITY` with no policies, matching `migrations/00000000000003_tiered_plans/migration.sql:48-53`.

`SubscriptionState` gains `stripePriceId` — `webhook.ts:156` already has it in hand and discards it. It gives a local, indexed answer to "who is on which price" without calling Stripe, needed for Phase 2's blast radius.

### What happens to `plans.ts`

**Neither frontend imports it** — both already receive plan data over the wire. Only five backend sites read `PLANS`, and **all five are already inside `async` functions**, so an awaited registry needs no boot-ordering hazard:

`brand-orders.ts:48,54` · `brand-store.ts:34` · `brand-billing.ts:57,119,121` · `services/dunning.ts:45` · `services/shipping.ts:57`

`plans.ts` **keeps** `PLAN_KEYS` / `PlanKey` / `PAID_PLAN_KEYS` (type vocabulary), `wholesaleFieldFor()` (a `CatalogProduct` **column mapping**, structural — must never be editable), and `planLabel()` (the fallback label, absorbing the duplicated screen-local maps).

`plans.ts` **loses** `PLANS`, `PLAN_LIST`, `priceCents`, `stripePriceEnv`, `paid` (derive as `key !== 'starter'`), and `capabilities.wholesale` (a literal `true` nothing reads). What remains is renamed `PLAN_SEED`, used once by migration 030 and read never again. **After this change no exported price constant exists for anyone to edit.**

---

## Critical files

**New:** `packages/db/prisma/migrations/00000000000030_plan_registry/migration.sql` · `apps/api/src/services/plan-registry.ts` · `apps/api/src/services/plan-price.ts` · `apps/api/src/routes/admin-plans.ts` · `apps/api/src/scripts/seed-plans.ts` · `apps/admin-web/src/screens/Plans.tsx` · `apps/api/test/FakePaymentsAdapter.ts`

**Modified:** `packages/shared/src/{plans,roles,audit,payments}.ts` · `packages/payments/src/{stripe-adapter,high-risk-acquirer-adapter}.ts` · `packages/db/prisma/schema.prisma` · `apps/api/src/{app,config,clients}.ts` · `apps/api/src/routes/{brand-billing,webhook,brand-orders,brand-store,admin-brands}.ts` · `apps/api/src/services/{subscription,dunning,shipping}.ts` · `apps/brand-web/src/screens/{Account,Overview,Catalog,Store,Shipping}.tsx` · `apps/admin-web/src/{App,components/Shell,screens/Overview}.tsx`

---

## Tasks

House style: `docs/superpowers/plans/2026-08-19-first-run-tutorial.md`. One commit each, sentence-case imperative, no `feat:`/`fix:` prefix. Failing test first. Migrations hand-numbered — the last is `00000000000029_onboarding_completed_at`.

> **Ordering is a safety constraint.** Task 2 (`proration_behavior`) must land before any code can update a live subscription. Do not reorder that dependency.
>
> **Execution order is `2 → 9 → 3 → 4 → 5 → 1 → 6 → 7 → 8 → 8a → 10 → 11 → 12`**, not the numeric order below. Task 1 deletes `PLANS` while its five consumers are still reading it, so running it first would leave Tasks 1-4 on a broken build. Build the registry, rewire the consumers, then retire the constant once nothing reads it. Task 9 moves up because Tasks 4 and 8 need the fake adapter to test without touching live Stripe. Task 8a was added mid-execution (see its entry) and slots after Task 8. Numbering below is kept as written so task briefs stay stable.

**Task 1 — Reshape the shared plan vocabulary**
`packages/shared/src/plans.ts`, `money.ts:2`. Delete `PLANS`/`PLAN_LIST`/`priceCents`/`stripePriceEnv`/`paid`/`capabilities.wholesale`. Add `PLAN_SEED`, `planLabel()`, `SHIPPING_MODES`, `ResolvedPlan`, Zod schemas. Keep `wholesaleFieldFor` untouched.
*Test:* `PLAN_SEED` exposes no price field; `wholesaleFieldFor` maps all three tiers.

**Task 2 — Price primitives and no-proration on the payments seam**
`packages/shared/src/payments.ts`, both adapters. Add `createPrice` / `archivePrice` / `retrievePrice`; **default `proration_behavior` to `'none'`** with explicit opt-in for prorations. `implements PaymentsAdapter` forces the stub adapter to stay in sync. `pnpm lint:stripe-guard` must still pass.
*Tests:* `updateSubscription` sets `proration_behavior: 'none'`; **asserts `billing_cycle_anchor` is absent**; throws if `items.data.length !== 1`; `createPrice` sets `lookup_key` + `metadata.{plan_key,price_version_id}` and copies product/currency/interval; idempotency keys are stable across identical calls.

**Task 3 — Migration 030: the plan registry tables**
Two tables, `ShippingMode` enum, partial unique index, Starter CHECK, RLS, `SubscriptionState.stripePriceId`, and `INSERT` of three `plan` rows from `PLAN_SEED`. `plan_price` starts **empty**.
*Verify:* `pnpm --filter @ruostack/db run generate && pnpm db:deploy && pnpm db:status`.

**Task 4 — Seed prices from Stripe**
`apps/api/src/scripts/seed-plans.ts`, `pnpm seed:plans`. Reads the env price ids → `payments.retrievePrice()` → writes `stripe_product_id` and an active `plan_price` row per paid tier.
**The amount comes from Stripe, not from `plans.ts`.** The reported symptom is that the two disagree; whichever seeds the new source of truth wins permanently, and only one of them charges people. Logs every discrepancy it corrects. Idempotent.

**Task 5 — The plan registry, and rewiring every `PLANS` consumer**
`services/plan-registry.ts` — memoized, single in-flight promise, TTL from `PLAN_CACHE_TTL_SECONDS` (60), explicit invalidation on admin write. PM2 runs `instances: 1, exec_mode: 'fork'` (`ecosystem.config.cjs:41-46`), so in-process invalidation is exact today; the TTL is the safety net. **Throws rather than falling back to `PLAN_SEED`** — a silent fallback would reintroduce two authorities. Rewire the five consumers. Add `shipping_cutoff` to the `capabilities` payload.
*Test:* `GET /api/brand/subscription`'s `plans[].price_cents` equals the active `plan_price.price_cents` — the invariant the original bug violated.

**Task 6 — Resolve tiers from stored price ids, and stop defaulting to Pro**
`webhook.ts:11-17` → indexed lookup on `plan_price.stripe_price_id` across all statuses, so archived and historical prices resolve forever. Remove `?? 'pro'` at `subscription.ts:40`; an unresolved id throws, which the webhook route already turns into a retry (`webhook.ts:77-84`) surfacing in the dead-letter count.
*Test (fails first):* seed an **archived** price, dispatch an event carrying that old id, assert the tier still resolves. Second test: an unknown id on a brand with no `SubscriptionState` does **not** create `plan: 'pro'`.

**Task 7 — The `plans` surface, read/edit routes, and the checkout quote token**
New `plans` surface in `ROLE_GATE` — `super_admin: 'write', finance: 'write', operations: 'view', support: 'view'`. Deliberately **not** the existing `subscription` surface, whose blast radius is one brand (`admin-brands.ts:198`); repricing changes what every brand pays, and after the fact no audit query could tell the two apart. `GET` + `PATCH` (name, features, `shippingCutoff`). Also fix `admin-brands.ts:202` to `z.enum(PLAN_KEYS)`.
**The quote token:** `GET /api/brand/subscription` returns `price_version_id` per plan; `POST /api/brand/billing/subscribe` accepts and validates it, rejecting a stale one with `price_changed`. Checkout resolves the Stripe price id from that same row — one read path from card to charge.
*Tests:* `support` → 403 on PATCH, `finance` → through, via `seedAdmin` (`catalog-crud.test.ts:15-28`); subscribe with a stale token → rejected; subscribe uses the **DB** price id, not `cfg.STRIPE_PRO_PRICE_ID`.

**Task 8 — The price-change transaction**
`services/plan-price.ts` + `POST /api/admin/plans/:key/price`. Order: **insert pending row → create Stripe price (idempotency key derived from the row id) → one atomic transaction flipping `active` and writing the audit → deferred archive.** Deriving the key from a row created *before* the side effect is what makes retry safe; `price:${plan}:${amount}` would be wrong, since a 4900→5900→4900 revert would return the *archived* first price.
Guards, all rejecting before any Stripe call: `starter` → 400; unchanged price → 409; **subscribers exist and the Phase 2 worker is absent → 409 `migration_required`**; bounded `min(100).max(100_000)`; a change over ±50% needs `confirm_large_change: true`; mandatory `reason` (modelled on `admin-brands.ts:202-206`).
Stripe calls go through a `PaymentsAdapter` parameter, not `getClients()`, so tests can inject a fake.
*Tests:* happy path flips `active` atomically; Stripe failure leaves a reusable pending row and nothing live; retry reuses the row and the same key; every guard; the partial unique index rejects a hand-crafted second active row.

**Task 9 — Test isolation from Stripe**
`apps/api/test/FakePaymentsAdapter.ts` typed **only** against the `PaymentsAdapter` interface, so `scripts/check-stripe-imports.mjs` stays satisfied. Add a test-only injection seam to `clients.ts` (`getClients()` is currently a hard singleton with no override). Plus a vitest-level interceptor that **throws on any outbound request to `api.stripe.com`** — that interceptor is the actual guarantee; everything else is discipline.

**Task 8a — Persist the subscribed price id and detect tier drift** *(added 2026-08-20 after Task 6's review; sequence after Task 8, before Task 10)*

Closes a gap Tasks 7 and 8 structurally cannot: they guarantee prices *we* create land in `plan_price`, but the Stripe Dashboard is the ordinary tool for the ordinary action ("give BigBrand Volume at a negotiated $99"). Such a price is by definition absent from `plan_price`.

When that price arrives on `subscription.activated` for an **existing** brand, `upsertSubscriptionState`'s update path leaves the stored tier untouched — the brand stays on the old tier. Harm, traced: `effectivePlan()` → `wholesaleFieldFor()` → the wrong `wholesale<Tier>` column → `unitWholesaleCents` **snapshotted onto every order line** (`brand-orders.ts:76-79`), so the wrong cost is baked into the immutable order record and a later tier correction does not repair history. Nothing currently detects it.

Do **not** fix this by making `activated` throw. `customer.subscription.updated` with `status: 'active'` is the only event that advances `currentPeriodEnd` — there is no `invoice.paid` case in `parseWebhook`. Throwing would freeze renewals, `isLapsed()` would fire after `LAPSE_GRACE_DAYS = 3`, the sweep would set `expired`, and `effectivePlan()` would drop a **paying** brand to Starter wholesale, the 20-order cap, and flat shipping. That trades a silent overcharge for a hard entitlement outage.

Instead, make the condition detectable:

1. `webhook.ts` — pass `stripePriceId: event.priceId` into the upsert. It is already in hand and discarded. Task 3 added `SubscriptionState.stripePriceId` (`schema.prisma:636`, indexed `:649`) explicitly for this and nothing has written it yet — it is currently a dead column.
2. `services/subscription.ts` — write it through on both branches, update-branch guarded like its siblings.
3. `services/reconciliation.ts` `scanDrift()` (`:69-102`) — add a `plan_price_drift` finding for any `subscription_state` row whose `stripePriceId` has no `plan_price` match, **or** whose matching row's `plan` disagrees with the stored `plan`. The second half catches the stuck-on-old-tier case.

This pulls the `plan_price_drift` finding forward from Phase 2, which is justified: Phase 2 is gated on subscribers existing, but this gap arms itself at the *first* subscriber — precisely when Phase 2 is still unbuilt.

**Task 10 — The admin Plans screen**
`apps/admin-web/src/screens/Plans.tsx`, `App.tsx` lazy route, `Shell.tsx` NavItem under **Administration** (beside Ledger & Reconciliation). Template: `ShippingRules.tsx`. `canWrite(claims.role, 'plans')` gates writes. Starter's price input is disabled with an inline explanation.
**Price editing is a separate confirm step from the edit form** — never migrate on save. The confirm shows old → new, the delta in words ("**increase** of $10.00/mo"), the current subscriber count, and requires typing the new amount in dollars (`59.00`). Typing the value re-verifies the number that will charge people; typing a magic word verifies nothing.

**Task 11 — Consolidation and the formatting fix**
- `Account.tsx:236` → `` `$${(c / 100).toFixed(2)}/mo` ``.
- The two byte-identical `PLAN_LABEL` maps (`brand-web/Overview.tsx:20`, `Catalog.tsx:20`) and `admin-web/Overview.tsx:47`'s hardcoded tuple array → `planLabel()`.
- Seven copies of the store-connections upsell string (`brand-store.ts:38,77,152,164,300`, `Store.tsx:120-122`, `Shipping.tsx:85`) → **derived** from the registry and returned as `upsell.store_connections`. Derived rather than centralised as a constant, because tier *names* are now editable — a hardcoded "Pro or Volume" becomes a new drift source the day someone renames a tier.

> **Do not move** `admin-web/screens/Brands.tsx:7-11` (`PLAN_PILL`). It is a map of Tailwind class strings, and `admin-web/tailwind.config.js:7` scans only `./src` and `packages/ui/src` — class strings living in `packages/shared` would be silently purged from the build.

**Task 12 — Retire the price-id env vars** *(after the seed has run in production)*
Remove `STRIPE_PRO_PRICE_ID` / `STRIPE_VOLUME_PRICE_ID` from `config.ts:51-52`, `.env.example`, and `deploy/`. Separate commit so an app rollback does not strand a deployment. Verify `pnpm test:scripts`.

> **Bootstrap must survive the removal.** `seed-plans.ts:28-30` reads those vars, and it is the *only* way a fresh environment (dev, staging, a new deploy) populates `plan_price` at all — this production database is simply already seeded. Deleting the vars outright would strand every other environment.
>
> **Decision (user, 2026-08-20): move the price ids to CLI arguments** — `pnpm seed:plans --pro price_x --volume price_y`. That removes the second authority from config entirely, keeps bootstrap possible everywhere, and makes the one-time nature of the operation explicit at the call site instead of ambient in the environment. The script must fail loudly with usage text when an argument is missing, exactly as it does today for an unset env var.

### Phase 2 — deferred until subscribers exist

Not built now; Task 8's `migration_required` guard prevents a price change from silently stranding subscribers on an old price. Design already settled: a durable per-brand `plan_migration` work queue; a batched worker passing `prorationBehavior: 'none'`; an `isMigratable()` predicate skipping `past_due`, `cancelAtPeriodEnd`, `expired`, comped brands with no `stripeSubscriptionId`, and any subscription whose live item price no longer matches; a dry-run that persists its eligible set and is re-validated at commit; a notice email with an effective-date floor; and a `plan_price_drift` finding in `scanDrift()` (`services/reconciliation.ts:70-105`).

**One pre-existing liability Phase 2 must confront:** `expired` is set locally (`dunning.ts:61`, `subscription.ts:151`) but **never cancels the Stripe subscription**. Those brands are still being charged while entitled to Starter. Any `WHERE status = 'active'` blast-radius query undercounts real Stripe subscribers. Worth checking in the Stripe dashboard now, independent of this work.

---

## Verification

**Per task:** `pnpm --filter @ruostack/api exec vitest run test/<file>` for targeted runs — note `pnpm --filter X test -- <pattern>` does **not** filter. DB tests need `set -a && . ./.env && set +a` before `RUN_DB_TESTS=1`.

**Gates:** `pnpm typecheck` · `pnpm build` · `pnpm lint:contrast` · `pnpm lint:legacy-classes` · **`pnpm lint:stripe-guard`** (critical — the Stripe SDK must stay inside `packages/payments`) · `RUN_DB_TESTS=1 pnpm --filter @ruostack/api test` (baseline on `main` is 409 passing).

**Pre-flight, before Task 4 runs anywhere:** confirm the subscriber count is genuinely zero, and read the two Stripe Price objects to see what they actually charge. Task 4 seeds from those values, so this is the moment the portal starts telling the truth.

**End-to-end, in Stripe test mode:**
1. `pnpm seed:plans` → `GET /api/brand/subscription` reports the amounts Stripe holds, not `plans.ts`'s old constants.
2. Admin → Plans → change Pro to a new price → confirm dialog shows the delta and requires typing the amount.
3. Verify a new Stripe Price exists, the old one is still active (deferred archive), and `plan_price` has exactly one active row for `pro`.
4. Brand portal → plan picker shows the new price; Subscribe → Stripe Checkout charges **that** amount.
5. **The rail:** load the picker, reprice in another tab, then click Subscribe → expect `price_changed` and a review prompt, **not** a silent charge at the new price.
6. Dispatch a webhook carrying the **old** price id → tier still resolves correctly.
7. `support` role → Plans screen is read-only; `PATCH` returns 403.

**Manual gate before Phase 2 ever runs:** against a Stripe test-mode subscription, confirm `proration_behavior: 'none'` produces no invoice item and leaves the renewal date unmoved.

**Billing-portal proration path — checked 2026-08-20, no action needed.** `stripe-adapter.ts:210` creates portal sessions with no `configuration`, so the account default governs. That default (`bpc_1ThLhfH9RQOremGxHATzAETC`) has `subscription_update.enabled = false`: customers cannot switch plans through the portal at all, so there is no second path around our `'none'` default. Cancel is enabled, which is how a brand reaches Starter by design. This also means archiving an old price cannot break portal plan-switching, since that feature is off. Re-check if portal plan-switching is ever enabled.
