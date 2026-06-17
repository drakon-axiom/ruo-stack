-- Per-brand shipping pricing (rate proxy §12): pick-&-pack fee override (RUOStack
-- margin) + brand markup (brand's shipping profit) + enabled service list.
CREATE TABLE "brand_shipping_config" (
    "id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "pickpack_fee_override_cents" INTEGER,
    "markup_cents" INTEGER NOT NULL DEFAULT 0,
    "enabled_services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_shipping_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_shipping_config_brand_id_key" ON "brand_shipping_config"("brand_id");

-- AddForeignKey
ALTER TABLE "brand_shipping_config" ADD CONSTRAINT "brand_shipping_config_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── RLS (deny-by-default + brand tenant read; writes via bypassrls API role) ──
ALTER TABLE "brand_shipping_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_shipping_config" FORCE ROW LEVEL SECURITY;

CREATE POLICY "brand_shipping_config_tenant_select" ON "brand_shipping_config"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));
