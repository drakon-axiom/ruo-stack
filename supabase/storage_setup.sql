-- ════════════════════════════════════════════════════════════════════════════
-- Storage provisioning (run separately from Prisma migrations).
--
-- `storage.objects` / `storage.buckets` are owned by `supabase_storage_admin`,
-- so the RLS-bypassing `prisma` migration role cannot CREATE POLICY on them.
-- Run this as `postgres` -- via the Management API SQL endpoint, the dashboard
-- SQL editor, or psql on the session pooler.
--
-- Do NOT add `SET ROLE supabase_storage_admin;`. This file used to open with it,
-- and it is the reason the file could not be applied anywhere: `postgres` is not
-- a member of that role and the statement fails with
--   ERROR: 42501: permission denied to set role "supabase_storage_admin"
-- from every entry point. `postgres` can nonetheless CREATE POLICY on
-- storage.objects directly, which is all this file needs -- verified on
-- 2026-08-11 against the prod project.
--
-- Applying it through the dashboard's Storage -> Policies *wizard* does not work
-- either: that flow generates its own expression from a template, discards a
-- pasted one, and names the results `<name>_0` / `_1`. Prod briefly carried two
-- such policies whose entire expression was `bucket_id = 'brand-logos'` -- every
-- authenticated user could write to every brand's folder. If you must use the
-- dashboard, take the "For full customization" editor.
--
-- The bucket itself is created via the Storage API (idempotent), e.g.:
--   supabase.storage.createBucket('brand-logos', { public: true })
-- This file only adds the path-scoped write policies, which depend on
-- public.current_user_brand_ids() (defined in the security migration).
--
-- Idempotent: every policy is dropped before it is created.
-- ════════════════════════════════════════════════════════════════════════════

-- A brand may write only under its own `brand_id/` prefix. Claims-evidence
-- photos (later phases) reuse this pattern.
DROP POLICY IF EXISTS "brand_logo_write_own_prefix" ON storage.objects;
CREATE POLICY "brand_logo_write_own_prefix" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'brand-logos'
    AND (storage.foldername(name))[1] IN (SELECT public.current_user_brand_ids()::text)
  );

DROP POLICY IF EXISTS "brand_logo_update_own_prefix" ON storage.objects;
CREATE POLICY "brand_logo_update_own_prefix" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'brand-logos'
    AND (storage.foldername(name))[1] IN (SELECT public.current_user_brand_ids()::text)
  );

