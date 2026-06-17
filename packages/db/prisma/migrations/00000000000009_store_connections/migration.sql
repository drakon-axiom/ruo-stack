-- WooCommerce hub-and-spoke: brand store connections + supporting enum values.

-- CreateEnum
CREATE TYPE "store_platform" AS ENUM ('woocommerce', 'wix');

-- CreateEnum
CREATE TYPE "store_connection_status" AS ENUM ('active', 'error', 'disabled');

-- AlterEnum: inbound webhooks now also arrive from WooCommerce.
ALTER TYPE "webhook_source" ADD VALUE 'woocommerce';

-- AlterEnum: a store order can land with an unmatched SKU.
ALTER TYPE "order_blocker" ADD VALUE 'needs_mapping';

-- CreateTable
CREATE TABLE "brand_store_connection" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "platform" "store_platform" NOT NULL DEFAULT 'woocommerce',
    "store_url" TEXT NOT NULL,
    "consumer_key_enc" TEXT NOT NULL,
    "consumer_secret_enc" TEXT NOT NULL,
    "webhook_secret" TEXT NOT NULL,
    "webhook_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "status" "store_connection_status" NOT NULL DEFAULT 'active',
    "last_error" TEXT,
    "last_order_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_store_connection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_store_connection_brand_id_platform_key" ON "brand_store_connection"("brand_id", "platform");

-- CreateIndex
CREATE INDEX "brand_store_connection_brand_id_idx" ON "brand_store_connection"("brand_id");

-- AddForeignKey
ALTER TABLE "brand_store_connection" ADD CONSTRAINT "brand_store_connection_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS (deny-by-default + brand tenant read; writes via bypassrls API role) ──
-- Encrypted credentials never leave the API anyway, but the tenant-read policy
-- keeps a brand from ever seeing another brand's connection row.
ALTER TABLE "brand_store_connection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_store_connection" FORCE ROW LEVEL SECURITY;

CREATE POLICY "brand_store_connection_tenant_select" ON "brand_store_connection"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));
