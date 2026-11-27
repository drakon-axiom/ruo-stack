-- Restrictive policies also deny access if another bucket's permissive policy
-- was accidentally written too broadly. Signed upload tokens use Storage's
-- signed endpoint; API operations use the server-only service role.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname='objects' AND pg_has_role(current_user,c.relowner,'MEMBER')) THEN
  EXECUTE 'CREATE POLICY coa_objects_boundary ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated USING (bucket_id <> ''coa-private'') WITH CHECK (bucket_id <> ''coa-private'')';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname='buckets' AND pg_has_role(current_user,c.relowner,'MEMBER')) THEN
  EXECUTE 'CREATE POLICY coa_bucket_boundary ON storage.buckets AS RESTRICTIVE FOR ALL TO anon, authenticated USING (id <> ''coa-private'') WITH CHECK (id <> ''coa-private'')';
 END IF;
END $$;

-- Hosted Supabase's app role does not own Storage tables. In that case private
-- buckets rely on default-deny RLS; deployment preflight must verify no existing
-- permissive policy admits this bucket. Do not grant Storage ownership to Prisma.
