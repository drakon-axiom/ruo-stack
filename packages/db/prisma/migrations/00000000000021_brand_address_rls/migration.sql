-- brand_address (Address Book, migration 019) shipped without RLS, so it was the
-- one public table outside the deny-by-default posture the architecture spec
-- requires as defense-in-depth. Not exploitable today — anon/authenticated hold
-- no table privileges on it, so PostgREST cannot reach it — but the whole point
-- of the invariant is that a future grant or direct-client path can't leak across
-- tenants. Same shape as every other brand-scoped table (cf. product_alias).
ALTER TABLE "brand_address" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_address" FORCE ROW LEVEL SECURITY;

CREATE POLICY "brand_address_tenant_select" ON "brand_address"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));
