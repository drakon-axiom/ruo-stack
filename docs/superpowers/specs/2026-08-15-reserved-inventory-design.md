# Reserved inventory for Volume brands — design

Date: 2026-08-15
Status: scoped, not approved — open questions in "Decisions still to make"

## Problem

RUOStack is a single-warehouse platform: RUOStack holds the stock, brands sell it under their
own label. A brand can market a SKU, take customer orders, and only then discover RUOStack is
out of stock — the brand absorbs the failure with their own customer. Reserved inventory makes
the top tier a real guarantee: a Volume brand always has units held for the SKUs they sell.

Three facts from exploration shape the whole design.

**1. There is no quantitative inventory anywhere.** No `Inventory`/`StockLevel` model, no
quantity-on-hand field, no decrement-on-order. Stock is one hand-toggled enum on the product row
(`CatalogStatus = in_stock | soon | out_of_stock`), and `services/woo.ts:157` sets
`manage_stock: false` when pushing to WooCommerce, deliberately disabling Woo's own counting.
Everything here rests on introducing a unit count that does not exist today.

**2. Order creation never checks stock at all.** `apps/api/src/routes/brand-orders.ts:61`
filters only `isPublished` and `archived`, so an `out_of_stock` product is orderable through the
API right now. Same in `services/order-edit.ts:46` and `services/sku-resolver.ts:38`. The
`in_stock` gate exists only at the storefront layer, pushed into Woo. This is a live over-sell
bug that phase 1 fixes as a prerequisite.

**3. The wallet already solves this problem shape.** `held` funds are *derived*, never stored —
`getHeld` in `apps/api/src/services/wallet.ts:33` is a `SUM` over open orders — so reserve and
release happen automatically with no counter to drift. The `hold`/`hold_release` ledger enum
values exist but are deliberately unused for exactly this reason. Reserved inventory should copy
the pattern rather than invent counters.

Production is pre-launch (1 brand, 1 published SKU, 0 subscription rows), so there is no
backfill concern.

## The model

Volume brands get **up to N units of each of up to X SKUs**.

- **Eligibility:** only SKUs the brand has actually sold (at least one `OrderItem` on a
  non-cancelled order for that brand + product). Demand-proven, not speculative.
- **Slots:** the brand's top X eligible SKUs by units sold in a trailing window, chosen
  automatically. A brand may **pin** a SKU into a slot to override the ranking.
- **Standing level:** the brand always has up to N units held. Orders draw it down; it refills
  as stock arrives. Not a periodic grant.
- **Ceiling, not a blank promise:** effective reservation is
  `min(N, units left after other brands' claims)`, with an admin warning when a SKU is
  over-committed.
- **Volume only to start.** Pro already carries better wholesale, unlimited orders, live rates,
  and store connections. Capabilities live in `plans.ts`, so extending to Pro later is a
  one-number change.

Exposure is bounded by `brands × slots × N`, not `brands × all SKUs × N`. That is the entire
reason for the eligibility and slot rules: a flat "N units of every SKU for every Volume brand"
grows as `brands × SKUs` and silently becomes unkeepable — the worst failure mode, because
nobody notices until a brand's order comes up short.

## Data model

`packages/db/prisma/schema.prisma`:

- `CatalogProduct.qtyOnHand Int @default(0)` — admin-maintained, alongside the existing `status`
  enum. `status` stays as the operator's coarse sellability switch; `isStoreSellable`
  (`packages/shared/src/dto.ts:129`) still reads it.
- `Brand.reservedSkuSlots Int?` — per-brand override; `null` falls back to the plan capability.
  Follows the existing per-brand config precedent rather than introducing settings
  infrastructure, which does not exist in this schema.
- `InventoryPin` — `(brandId, productId)` unique, `createdAt`. Only pins are stored; unpinned
  slots are computed. Storing computed slot assignments would create a second thing to keep in
  sync.
- `OrderBlocker` gains `awaiting_stock` — see Sharp edges, this one is not free.

`packages/shared/src/plans.ts` — new named capabilities, following the existing convention
(named capabilities, never tier comparison; there is no plan ordering anywhere in the repo):

```ts
/** Units of each reserved SKU held for this brand; null = no reservations. */
reservedUnitsPerSku: number | null;
/** How many SKUs may hold a reservation. */
reservedSkuSlots: number;
```

`starter`/`pro`: `null` / `0`. `volume`: N / X. Volume's existing `'Priority fulfillment'`
feature bullet (`plans.ts:87`) is marketing with no code behind it — replace it with an accurate
reserved-inventory bullet.

## Core mechanic: derive, never store

Mirror `getHeld` exactly. New `apps/api/src/services/inventory.ts`:

- `getReserved(db, productId)` — `SUM(OrderItem.qty)` over orders with
  `status ∈ {ready_for_fulfillment, processing}` and a stock-committing blocker.
- `getAllocations(db, productId)` — other brands' active reservations.
- `getStockSummary(db, productId, brandId)` →
  `{ onHand, reserved, allocatedToOthers, availableToBrand }`.

No mutable counter, so cancel/edit/ship release stock automatically and drift is structurally
impossible.

Reuse the `reservedSelf` self-exclusion idiom (`services/order-edit.ts:101`) on any re-check of
an order that is already reserving, or an edit double-counts its own units. This is the exact
bug class this feature will hit.

## Where the checks go

The three existing reservation decision points — all three already take `lockBrandWallet`:

- `apps/api/src/routes/brand-orders.ts` (manual create)
- `apps/api/src/services/order-edit.ts` (edit / remap)
- `apps/api/src/services/store-intake.ts` (Woo import)

Manual orders may be **rejected** outright (`Conflict('insufficient_stock', …)`, matching the
`order_cap_reached` precedent at `brand-orders.ts:47-54`). Store orders may **not** — the
customer already paid on the brand's storefront — so they are accepted with
`blocker: 'awaiting_stock'`.

## Sharp edges

**1. `awaiting_stock` and the wallet hold — the sharpest interaction.** `getHeld` counts only
`blocker: 'none'`, so *any* new blocker silently releases the brand's funds. An `awaiting_stock`
order is complete and valid — RUOStack simply cannot fulfill yet — unlike `needs_address`,
`needs_mapping`, and `awaiting_funds`, which are all brand-fixable and genuinely not ready.
Releasing the money invites the brand to spend it and leaves the order unfundable when stock
lands. **Recommendation: include `awaiting_stock` in `getHeld`'s filter** so funds stay held.
This changes a core money path — it needs explicit tests and deliberate review.

**2. Blocker precedence is duplicated.** The ladder appears in `services/store-intake.ts:148-153`
and `services/order-edit.ts:91-104` and must be updated in both. Proposed order:
address > unmapped SKUs > stock > funds. Also update the export exclusion list in
`routes/shipstation-custom-store.ts:83` and `FULFILLMENT_META` in `packages/shared/src/orders.ts`.

**3. Lock ordering.** Stock decisions need a per-product advisory lock. `lockBrandWallet` uses
`pg_advisory_xact_lock(hashtext(brandId), 0)` — use a **different lock class** (second arg) for
products so the keyspaces cannot collide, and **sort product ids before locking** so two
concurrent multi-item orders cannot deadlock. Keep pricing and ShipStation rate calls outside
the transaction, as the existing code does.

**4. The stock push becomes per-brand.** `apps/api/src/hooks/catalog-stock.ts` fans the same
binary `in_stock` out to every connected store via `isStoreSellable`. With reservations, a brand
holding units must stay sellable while general stock is exhausted. This is where the feature
becomes visible to the end customer, and it means `onCatalogStockChanged` computes sellability
*per brand* rather than once.

## Phasing

Each phase is independently shippable.

1. **Inventory foundation** — `qtyOnHand`, `inventory.ts` with derived reserved, stock checks at
   the three decision points, `awaiting_stock` blocker, admin editing of on-hand counts. Fixes
   the live over-sell bug and delivers value with no plan gating at all.
2. **Reservations** — plan capabilities, eligibility from sales history, automatic top-X slots,
   standing level, per-brand slot override, admin over-commitment warning.
3. **Brand-facing** — reservation visibility and pin/unpin in the brand portal, per-brand stock
   push. Pinning writes an inventory commitment, so gate it behind a new `BrandSurface` in
   `packages/shared/src/brand-roles.ts` on the owner-only list, next to `catalog_pricing`.

Phase 1 carries the schema risk and is a prerequisite for the rest; worth landing and running
before committing to 2–3.

## Files to touch

| Area | Path |
|---|---|
| Schema | `packages/db/prisma/schema.prisma` + migration |
| Plan capabilities | `packages/shared/src/plans.ts` |
| Blocker metadata / surfaces | `packages/shared/src/orders.ts`, `brand-roles.ts` |
| New service | `apps/api/src/services/inventory.ts` |
| Reservation decision points | `routes/brand-orders.ts`, `services/order-edit.ts`, `services/store-intake.ts` |
| Wallet held filter | `apps/api/src/services/wallet.ts` |
| Per-brand stock push | `apps/api/src/hooks/catalog-stock.ts` |
| ShipStation export | `routes/shipstation-custom-store.ts` |
| Admin | `routes/admin-catalog.ts`, `routes/admin-brands.ts`, `apps/admin-web/src/screens/Catalog.tsx` |
| Brand (phase 3) | `apps/brand-web/src/screens/Catalog.tsx` |

## Verification

- **Unit** (offline, `apps/api/test/unit/`): reserved-quantity derivation including
  `reservedSelf` exclusion; slot ranking with and without pins; eligibility from sales history;
  capability lookup per tier.
- **Integration** (`RUN_DB_TESTS=1`): follow `test/integration/orders.test.ts:36-75`, which
  already asserts the analogous wallet reserve → capture → release cycle. Cover: order draws
  down stock; cancel releases it; edit re-reserves without double-counting; a Volume brand's
  reservation survives another brand exhausting general stock; a store order over available
  stock lands `awaiting_stock` **and still holds funds**; concurrent orders for the last unit —
  exactly one succeeds.
- **Over-sell regression:** an `out_of_stock` product must now be rejected at order creation —
  assert the current buggy behaviour is gone.
- **Manual:** admin sets on-hand, orders across two brands with and without reservations,
  confirm the per-brand Woo stock push diverges correctly.
- Full gate: `pnpm typecheck`, `pnpm --filter @ruostack/api test`, `pnpm lint:stripe-guard`.

## Decisions still to make

- **N and X** — units per reserved SKU, and slot count per Volume brand. Both are commercial
  calls that set physical inventory exposure (`brands × slots × N`).
- **Pro tier** — Volume-only to start is the recommendation; enabling Pro later is a one-number
  change in `plans.ts`.
- **Trailing window** for top-X ranking — 90 days suggested; a tuning value, not structural.
  Make it a named constant.
- **`awaiting_stock` holding funds** (Sharp edges #1) — recommended, but it changes a core money
  path and deserves an explicit yes.
