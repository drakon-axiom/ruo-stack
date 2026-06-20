-- Persisted checkout rate quotes (§9 quote-driven reserve): reserve the exact
-- quoted shipping at order import instead of re-rating.
CREATE TABLE "rate_quote" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "cart_hash" TEXT NOT NULL,
    "dest_zip" TEXT NOT NULL,
    "dest_state" TEXT NOT NULL,
    "service_code" TEXT NOT NULL,
    "carrier_cost_cents" INTEGER NOT NULL,
    "pickpack_cents" INTEGER NOT NULL,
    "brand_markup_cents" INTEGER NOT NULL,
    "customer_price_cents" INTEGER NOT NULL,
    "box_id" UUID,
    "billable_weight_oz" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_quote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_quote_brand_id_cart_hash_service_code_idx" ON "rate_quote"("brand_id", "cart_hash", "service_code");
CREATE INDEX "rate_quote_expires_at_idx" ON "rate_quote"("expires_at");

-- ── RLS: operator-owned (rate proxy is connection-auth, not a brand JWT). Deny;
-- API bypassrls role reads/writes. ──
ALTER TABLE "rate_quote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_quote" FORCE ROW LEVEL SECURITY;
