-- ════════════════════════════════════════════════════════════════════════════
-- RUOStack Phase 0 — Security spine (RLS, access-token hook, audit append-only).
-- Applied as a Prisma migration so Prisma owns ALL public DDL and never sees
-- this as drift. Do NOT also run this out-of-band in the dashboard.
--
-- Defense-in-depth model: the API connects via the privileged `prisma` role
-- (bypassrls) and enforces authorization in app code. RLS below is the
-- second layer so a bug or any future direct-client path cannot leak across
-- tenants. The audit trigger holds EVEN against the RLS-bypassing service role.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Enable RLS deny-by-default on EVERY public table ──────────────────────
-- With RLS enabled and no permissive policy, non-bypassrls roles get nothing.
ALTER TABLE "user_profile"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_member"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_user_role"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_user"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_session"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_password_reset_token" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_product"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_event"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "brand_tax_exemption"        ENABLE ROW LEVEL SECURITY;

-- Force RLS even for the table owner, so ownership can't silently bypass it.
-- (The `prisma` role bypasses via BYPASSRLS, which is the intended app path.)
ALTER TABLE "user_profile"               FORCE ROW LEVEL SECURITY;
ALTER TABLE "brand"                      FORCE ROW LEVEL SECURITY;
ALTER TABLE "brand_member"               FORCE ROW LEVEL SECURITY;
ALTER TABLE "brand_user_role"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "catalog_product"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "brand_tax_exemption"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_log"                  FORCE ROW LEVEL SECURITY;

-- ── 2. Brand tenant-isolation policies (for any direct-client path) ──────────
-- A brand user (auth.uid()) may read only rows for brands they belong to via
-- brand_member. The API path bypasses RLS; these protect the direct path.

-- Helper: brand_ids the current auth user belongs to.
CREATE OR REPLACE FUNCTION public.current_user_brand_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bm.brand_id
  FROM public.brand_member bm
  WHERE bm.user_id = auth.uid()
    AND bm.status = 'active';
$$;

-- user_profile: a user sees only their own profile row.
CREATE POLICY "user_profile_self_select" ON "user_profile"
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- brand: members can read their brand(s).
CREATE POLICY "brand_member_select" ON "brand"
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_brand_ids()));

-- brand_member: a user sees membership rows for their own brands.
CREATE POLICY "brand_member_tenant_select" ON "brand_member"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));

-- brand_user_role: a user sees only their own role rows.
CREATE POLICY "brand_user_role_self_select" ON "brand_user_role"
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- catalog_product: published rows are readable by any authenticated brand user
-- (the brand-facing catalog is a read projection of published products).
CREATE POLICY "catalog_published_select" ON "catalog_product"
  FOR SELECT TO authenticated
  USING (is_published = true);

-- brand_tax_exemption: members can read their brand's exemptions.
CREATE POLICY "brand_tax_exemption_tenant_select" ON "brand_tax_exemption"
  FOR SELECT TO authenticated
  USING (brand_id IN (SELECT public.current_user_brand_ids()));

-- NOTE: no INSERT/UPDATE/DELETE policies for brand tables → writes via a direct
-- client are denied for everyone except the bypassrls API role. Admin tables
-- (admin_user, admin_session, ...) and webhook_event get NO policies at all →
-- fully deny-by-default to any non-bypassrls connection.

-- ── 3. Audit log: append-only, robust even against the service role ──────────
-- A BEFORE UPDATE OR DELETE trigger that RAISES holds regardless of RLS/bypass.
CREATE OR REPLACE FUNCTION public.audit_log_block_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_block_mutations();

-- Second layer: RLS insert/select-only policy (no update/delete policy exists).
CREATE POLICY "audit_log_insert" ON "audit_log"
  FOR INSERT TO authenticated, service_role
  WITH CHECK (true);
CREATE POLICY "audit_log_select" ON "audit_log"
  FOR SELECT TO authenticated, service_role
  USING (true);

-- ── 4. Custom Access Token Hook ──────────────────────────────────────────────
-- Injects realm:'brand' + brand_id into the brand JWT, read from the
-- SERVER-OWNED brand_user_role table (never user_metadata). Enable it in
-- Supabase → Auth → Hooks → "Custom Access Token" after deploy.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims      jsonb;
  v_user_id   uuid;
  v_brand_id  uuid;
BEGIN
  v_user_id := (event ->> 'user_id')::uuid;
  claims := COALESCE(event -> 'claims', '{}'::jsonb);

  SELECT bur.brand_id INTO v_brand_id
  FROM public.brand_user_role bur
  WHERE bur.user_id = v_user_id
    AND bur.realm = 'brand'
  ORDER BY bur.created_at ASC
  LIMIT 1;

  IF v_brand_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{realm}', '"brand"'::jsonb, true);
    claims := jsonb_set(claims, '{brand_id}', to_jsonb(v_brand_id::text), true);
  END IF;

  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$$;

-- Grants required by Supabase Auth to call the hook.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
-- The hook reads brand_user_role; allow the auth admin to read it. Because
-- brand_user_role has FORCE RLS and supabase_auth_admin is NOT bypassrls (and
-- has no auth.uid() while minting a token), a permissive SELECT policy for the
-- auth admin is required or the hook reads zero rows and injects no claims.
GRANT SELECT ON public.brand_user_role TO supabase_auth_admin;
CREATE POLICY "auth_admin_read_brand_user_role" ON "brand_user_role"
  FOR SELECT TO supabase_auth_admin USING (true);

-- ── 5. Storage ───────────────────────────────────────────────────────────────
-- The brand-logo bucket + path-scoped policies live in `supabase/storage_setup.sql`,
-- NOT here. `storage.objects` is owned by `supabase_storage_admin`; the RLS-bypassing
-- `prisma` role that runs these migrations cannot CREATE POLICY on it, so storage is
-- provisioned out-of-band (bucket via the Storage API, policies as the storage admin).
-- It still depends on public.current_user_brand_ids() defined above.
