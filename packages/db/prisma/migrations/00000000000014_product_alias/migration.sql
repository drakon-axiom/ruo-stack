-- SKU alias map + No-Match exception tracking (§3 aliases).

-- CreateTable
CREATE TABLE "product_alias" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "woo_sku" TEXT NOT NULL,
    "woo_product_id" TEXT,
    "product_id" UUID NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_alias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_alias_brand_id_woo_sku_key" ON "product_alias"("brand_id", "woo_sku");
CREATE INDEX "product_alias_brand_id_idx" ON "product_alias"("brand_id");

-- AddForeignKey
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog_product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No-Match tracking on the order: the raw store line items (for re-mapping) + the
-- SKUs we couldn't resolve.
ALTER TABLE "order"
  ADD COLUMN "source_items" JSONB,
  ADD COLUMN "unmatched_skus" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ── RLS: brand tenant read on aliases; API bypassrls role writes. ──
ALTER TABLE "product_alias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_alias" FORCE ROW LEVEL SECURITY;

CREATE POLICY "product_alias_tenant_select" ON "product_alias"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));
