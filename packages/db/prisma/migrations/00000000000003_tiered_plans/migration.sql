-- ════════════════════════════════════════════════════════════════════════════
-- Tiered plans: 3-tier wholesale, plan enum (starter|pro|volume), per-brand retail.
-- Hand-authored (the auto-diff can't backfill or convert the enum in place).
-- ════════════════════════════════════════════════════════════════════════════

-- ── CatalogProduct: single wholesale_cost → tiered (Starter/Pro/Volume) ──────
-- Migrate the existing cost into all three tiers as the starting point.
ALTER TABLE "catalog_product"
  ADD COLUMN "wholesale_starter" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "wholesale_pro"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "wholesale_volume"  INTEGER NOT NULL DEFAULT 0;
UPDATE "catalog_product" SET
  "wholesale_starter" = "wholesale_cost",
  "wholesale_pro"     = "wholesale_cost",
  "wholesale_volume"  = "wholesale_cost";
ALTER TABLE "catalog_product" DROP COLUMN "wholesale_cost";
ALTER TABLE "catalog_product"
  ALTER COLUMN "wholesale_starter" DROP DEFAULT,
  ALTER COLUMN "wholesale_pro"     DROP DEFAULT,
  ALTER COLUMN "wholesale_volume"  DROP DEFAULT;

-- ── SubscriptionState.plan: text → plan_tier enum (default starter) ──────────
CREATE TYPE "plan_tier" AS ENUM ('starter', 'pro', 'volume');
ALTER TABLE "subscription_state" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "subscription_state"
  ALTER COLUMN "plan" TYPE "plan_tier"
  USING (CASE "plan" WHEN 'pro' THEN 'pro' WHEN 'volume' THEN 'volume' ELSE 'starter' END)::"plan_tier";
ALTER TABLE "subscription_state" ALTER COLUMN "plan" SET DEFAULT 'starter';

-- ── BrandProductPrice (per-brand retail override) ────────────────────────────
CREATE TABLE "brand_product_price" (
  "id" UUID NOT NULL,
  "brand_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "retail_cents" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "brand_product_price_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "brand_product_price_brand_id_product_id_key" ON "brand_product_price"("brand_id", "product_id");
CREATE INDEX "brand_product_price_brand_id_idx" ON "brand_product_price"("brand_id");
ALTER TABLE "brand_product_price"
  ADD CONSTRAINT "brand_product_price_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brand_product_price"
  ADD CONSTRAINT "brand_product_price_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: deny-by-default + brand tenant read (writes via the bypassrls API role).
ALTER TABLE "brand_product_price" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_product_price" FORCE ROW LEVEL SECURITY;
CREATE POLICY "brand_product_price_tenant_select" ON "brand_product_price"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));
