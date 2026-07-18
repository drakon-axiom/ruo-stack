-- Custom Access Token Hook: also require an ACTIVE brand_member.
--
-- Previously the hook injected realm/brand_id from brand_user_role alone, so a
-- suspended member (brand_member.status <> 'active') whose brand_user_role row
-- still existed kept getting valid brand claims. Join brand_member and require
-- status = 'active' so suspension stops fresh tokens from carrying brand claims.
-- (Request-time enforcement in requireBrand covers already-issued JWTs.)
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
  JOIN public.brand_member bm
    ON bm.user_id = bur.user_id AND bm.brand_id = bur.brand_id
  WHERE bur.user_id = v_user_id
    AND bur.realm = 'brand'
    AND bm.status = 'active'
  ORDER BY bur.created_at ASC
  LIMIT 1;

  IF v_brand_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{realm}', '"brand"'::jsonb, true);
    claims := jsonb_set(claims, '{brand_id}', to_jsonb(v_brand_id::text), true);
  END IF;

  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$$;

-- The hook now also reads brand_member. Mirror the brand_user_role grant: because
-- brand_member has FORCE RLS and supabase_auth_admin is not bypassrls (and has no
-- auth.uid() while minting a token), a permissive SELECT policy is required or the
-- join reads zero rows and no claims are injected.
GRANT SELECT ON public.brand_member TO supabase_auth_admin;
CREATE POLICY "auth_admin_read_brand_member" ON "brand_member"
  FOR SELECT TO supabase_auth_admin USING (true);
