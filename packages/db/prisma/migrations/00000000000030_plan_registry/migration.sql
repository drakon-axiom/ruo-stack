-- Plan registry: pricing moves into the DB, write-through to Stripe (Task 3 of
-- the admin-managed-plans migration). Two tables. The central move: price_cents
-- and stripe_price_id live in the SAME immutable row, inserted together from
-- the Stripe response — the displayed number and the charging id can never
-- diverge because they are never written separately.
--
-- `plan` reuses the existing "plan_tier" enum (migration 00000000000003) as
-- its key, so "no new tiers" stays a DB guarantee. `plan_price` is an
-- append-only ledger: rows are never updated except to flip active/archivedAt.
--
-- `plan_price` starts EMPTY here — migration 030 only creates the tables and
-- seeds `plan`. Task 4 seeds `plan_price` from Stripe (Pro $49.00, Volume
-- $149.00 today), not from application code.

-- CreateEnum
CREATE TYPE "shipping_mode" AS ENUM ('flat', 'live');

-- CreateTable
CREATE TABLE "plan" (
    "key" "plan_tier" NOT NULL,
    "name" TEXT NOT NULL,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shipping_cutoff" TEXT NOT NULL,
    "store_connections" BOOLEAN NOT NULL,
    "max_orders_per_month" INTEGER,
    "shipping" "shipping_mode" NOT NULL,
    "stripe_product_id" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "plan_price" (
    "id" UUID NOT NULL,
    "plan" "plan_tier" NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "stripe_price_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_price_stripe_price_id_key" ON "plan_price"("stripe_price_id");
CREATE INDEX "plan_price_plan_active_idx" ON "plan_price"("plan", "active");

-- AddForeignKey
ALTER TABLE "plan_price" ADD CONSTRAINT "plan_price_plan_fkey"
  FOREIGN KEY ("plan") REFERENCES "plan"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- SubscriptionState: local, indexed answer to "who is on which price" without
-- calling Stripe. webhook.ts already has the price id in hand on every
-- subscription event and previously discarded it; needed for Phase 2's blast
-- radius (which brands are on a price being changed/archived).
ALTER TABLE "subscription_state" ADD COLUMN "stripe_price_id" TEXT;

-- ── Exactly one live price per tier: "what does Pro cost" has one answer. ────
-- A price change must deactivate the old row before activating the new one, or
-- the transaction aborts — the DB enforces the ordering Task 8's rotation
-- depends on (deactivate-then-activate, never both-active).
CREATE UNIQUE INDEX "plan_price_one_active_per_plan" ON "plan_price" ("plan") WHERE "active";

-- ── Starter is free and has no Stripe price. This is the enforcement, not a
-- disabled UI input: effectivePlan() (apps/api/src/services/subscription.ts)
-- returns 'starter' for every lapsed, cancelled and unsubscribed brand. If
-- Starter ever acquired a nonzero price, that entire population would
-- silently become paying customers in the portal's eyes. Non-starter rows
-- must carry a Stripe price id once active; a pending (not-yet-active) row
-- may still be null, since Task 8 creates exactly that row before calling
-- Stripe and only activates it once Stripe returns an id. ────────────────────
ALTER TABLE "plan_price" ADD CONSTRAINT "plan_price_starter_free_ck" CHECK (
  ("plan" = 'starter' AND "price_cents" = 0 AND "stripe_price_id" IS NULL)
  OR ("plan" <> 'starter' AND ("stripe_price_id" IS NOT NULL OR NOT "active"))
);

-- ── RLS: deny-by-default + force, no policies. Unlike brand_product_price
-- (migration 00000000000003), `plan` and `plan_price` are platform-global
-- config, not tenant-scoped — brands never query these tables directly, only
-- through the API (bypassrls `prisma` role), so there is no tenant SELECT
-- policy to add. ──────────────────────────────────────────────────────────
ALTER TABLE "plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "plan_price" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_price" FORCE ROW LEVEL SECURITY;

-- ── Seed the three plan rows from packages/shared/src/plans.ts PLAN_SEED.
-- plan_price is deliberately left empty — Task 4 populates it from Stripe. ──
INSERT INTO "plan" ("key","name","features","shipping_cutoff","store_connections","max_orders_per_month","shipping","updated_at") VALUES
  ('starter', 'Starter', ARRAY[
      'Wholesale pricing — Starter rate',
      'Manual orders — up to 20 / month',
      'Flat-rate shipping',
      '10 AM CST shipping cutoff',
      'No store connections'
    ]::TEXT[], '10 AM CST', false, 20, 'flat', CURRENT_TIMESTAMP),
  ('pro', 'Pro', ARRAY[
      'Better wholesale pricing — Pro rate',
      'Unlimited orders',
      'Live carrier rates',
      '12 PM CST shipping cutoff',
      'Store connections (WooCommerce, Wix)'
    ]::TEXT[], '12 PM CST', true, NULL, 'live', CURRENT_TIMESTAMP),
  ('volume', 'Volume', ARRAY[
      'Best wholesale pricing — Volume rate',
      'Unlimited orders',
      'Live carrier rates',
      '2 PM CST shipping cutoff',
      'Store connections (WooCommerce, Wix)',
      'Priority fulfillment'
    ]::TEXT[], '2 PM CST', true, NULL, 'live', CURRENT_TIMESTAMP);
