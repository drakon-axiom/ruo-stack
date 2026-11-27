-- Restrictive policies also deny access if another bucket's permissive policy
-- was accidentally written too broadly. Signed upload tokens use Storage's
-- signed endpoint; API operations use the server-only service role.
DO $$ BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
  EXECUTE 'CREATE POLICY coa_objects_boundary ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated USING (bucket_id <> ''coa-private'') WITH CHECK (bucket_id <> ''coa-private'')';
 END IF;
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  EXECUTE 'CREATE POLICY coa_bucket_boundary ON storage.buckets AS RESTRICTIVE FOR ALL TO anon, authenticated USING (id <> ''coa-private'') WITH CHECK (id <> ''coa-private'')';
 END IF;
END $$;
