-- Provisioning identity (fulfillment plan §3): what RUOStack actually created in
-- a brand's store. Stable identity is the Woo `product_id` recorded at creation,
-- NOT the SKU, so re-pushes are idempotent and survive a brand renaming a SKU.
--
-- This row is what makes the pre-flight classification possible at all: without
-- it, a product carrying our canonical SKU is indistinguishable from one the
-- brand made themselves (Managed vs Conflict), and drift cannot be detected.

-- CreateTable
CREATE TABLE "product_provisioning" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "catalog_product_id" UUID NOT NULL,
    "woo_product_id" INTEGER NOT NULL,
    "provisioned_sku" TEXT NOT NULL,
    "adopted" BOOLEAN NOT NULL DEFAULT false,
    "last_pushed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_provisioning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One row per catalog product per store, and one per store product — either
-- direction of duplication would break the idempotency the push relies on.
CREATE UNIQUE INDEX "product_provisioning_connection_id_catalog_product_id_key"
  ON "product_provisioning"("connection_id", "catalog_product_id");
CREATE UNIQUE INDEX "product_provisioning_connection_id_woo_product_id_key"
  ON "product_provisioning"("connection_id", "woo_product_id");
CREATE INDEX "product_provisioning_brand_id_idx" ON "product_provisioning"("brand_id");

-- AddForeignKey
ALTER TABLE "product_provisioning" ADD CONSTRAINT "product_provisioning_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_provisioning" ADD CONSTRAINT "product_provisioning_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "brand_store_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_provisioning" ADD CONSTRAINT "product_provisioning_catalog_product_id_fkey"
  FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS: deny-by-default + force, per the platform invariant. ────────────────
ALTER TABLE "product_provisioning" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_provisioning" FORCE ROW LEVEL SECURITY;

CREATE POLICY "product_provisioning_tenant_select" ON "product_provisioning"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));
