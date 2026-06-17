-- ════════════════════════════════════════════════════════════════════════════
-- Storage provisioning (run separately from Prisma migrations).
--
-- `storage.objects` / `storage.buckets` are owned by `supabase_storage_admin`,
-- so the RLS-bypassing `prisma` migration role cannot CREATE POLICY on them.
-- Run this as a role that owns storage (the Storage API creates the bucket; the
-- policies are created here as `supabase_storage_admin`).
--
-- The bucket itself is created via the Storage API (idempotent), e.g.:
--   supabase.storage.createBucket('brand-logos', { public: true })
-- This file only adds the path-scoped write policies, which depend on
-- public.current_user_brand_ids() (defined in the security migration).
-- ════════════════════════════════════════════════════════════════════════════

SET ROLE supabase_storage_admin;

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

RESET ROLE;
