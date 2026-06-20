-- Claims (§11): post-ship remedy path (no refunds once shipped).

-- CreateEnum
CREATE TYPE "claim_type" AS ENUM ('lost', 'damaged', 'missing_item', 'item_not_received', 'wrong_item');
CREATE TYPE "claim_status" AS ENUM ('open', 'investigating', 'carrier_filed', 'resolved');
CREATE TYPE "claim_resolution" AS ENUM ('reshipped', 'credited', 'denied');

-- CreateTable
CREATE TABLE "claim" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "type" "claim_type" NOT NULL,
    "status" "claim_status" NOT NULL DEFAULT 'open',
    "resolution" "claim_resolution",
    "description" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "carrier_claim_id" TEXT,
    "amount_cents" INTEGER,
    "reship_order_id" UUID,
    "opened_by_type" "actor_type" NOT NULL,
    "opened_by_id" TEXT,
    "reason" TEXT,
    "sla_due_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claim_brand_id_idx" ON "claim"("brand_id");
CREATE INDEX "claim_status_idx" ON "claim"("status");

-- AddForeignKey
ALTER TABLE "claim" ADD CONSTRAINT "claim_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "claim" ADD CONSTRAINT "claim_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS: brand tenant read; API bypassrls role writes. ──
ALTER TABLE "claim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim" FORCE ROW LEVEL SECURITY;

CREATE POLICY "claim_tenant_select" ON "claim"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));
