-- CreateEnum
CREATE TYPE "subscription_state_status" AS ENUM ('none', 'active', 'past_due', 'suspended', 'cancelled');

-- CreateEnum
CREATE TYPE "wallet_txn_type" AS ENUM ('deposit', 'hold', 'hold_release', 'capture', 'refund_credit', 'referral_credit', 'manual_adjustment');

-- CreateTable
CREATE TABLE "subscription_state" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "stripe_subscription_id" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'pro',
    "price" INTEGER NOT NULL DEFAULT 0,
    "status" "subscription_state_status" NOT NULL DEFAULT 'none',
    "current_period_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledger" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "brand_id" UUID NOT NULL,
    "type" "wallet_txn_type" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "external_id" TEXT,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_state_brand_id_key" ON "subscription_state"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_ledger_seq_key" ON "wallet_ledger"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_ledger_external_id_key" ON "wallet_ledger"("external_id");

-- CreateIndex
CREATE INDEX "wallet_ledger_brand_id_seq_idx" ON "wallet_ledger"("brand_id", "seq");

-- AddForeignKey
ALTER TABLE "subscription_state" ADD CONSTRAINT "subscription_state_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── RLS (defense-in-depth; deny-by-default + brand tenant read) ──────────────
-- Writes go only through the bypassrls API role; brands read their own rows.
ALTER TABLE "subscription_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_state" FORCE ROW LEVEL SECURITY;
ALTER TABLE "wallet_ledger"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wallet_ledger"      FORCE ROW LEVEL SECURITY;

CREATE POLICY "subscription_state_tenant_select" ON "subscription_state"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));

CREATE POLICY "wallet_ledger_tenant_select" ON "wallet_ledger"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));
