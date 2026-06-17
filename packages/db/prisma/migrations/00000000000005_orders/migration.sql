-- CreateEnum
CREATE TYPE "order_source" AS ENUM ('manual', 'woocommerce', 'wix');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('ready_for_fulfillment', 'processing', 'shipped', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "order_blocker" AS ENUM ('none', 'needs_address', 'needs_customer_info', 'awaiting_funds');

-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "source" "order_source" NOT NULL DEFAULT 'manual',
    "status" "order_status" NOT NULL DEFAULT 'ready_for_fulfillment',
    "blocker" "order_blocker" NOT NULL DEFAULT 'none',
    "external_order_id" TEXT,
    "recipient_name" TEXT NOT NULL,
    "recipient_email" TEXT,
    "recipient_phone" TEXT,
    "address1" TEXT NOT NULL,
    "address2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "wholesale_total_cents" INTEGER NOT NULL,
    "shipping_total_cents" INTEGER NOT NULL,
    "wallet_charge_cents" INTEGER NOT NULL,
    "tracking_number" TEXT,
    "carrier" TEXT,
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_wholesale_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_brand_id_status_idx" ON "order"("brand_id", "status");

-- CreateIndex
CREATE INDEX "order_status_idx" ON "order"("status");

-- CreateIndex
CREATE INDEX "order_item_order_id_idx" ON "order_item"("order_id");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog_product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── RLS (deny-by-default + brand tenant read; writes via bypassrls API role) ──
ALTER TABLE "order"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "order_item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_item" FORCE ROW LEVEL SECURITY;

CREATE POLICY "order_tenant_select" ON "order"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));

CREATE POLICY "order_item_tenant_select" ON "order_item"
  FOR SELECT TO authenticated
  USING (order_id IN (SELECT id FROM "order" WHERE brand_id IN (SELECT public.current_user_brand_ids())));
