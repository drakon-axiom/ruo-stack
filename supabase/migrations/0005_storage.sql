-- ============================================================================
-- ruo-stack — 0005_storage
-- Storage bucket for brand assets (logos, label artwork). Public-read so the
-- white-label logo can render on storefronts/labels, but writes are locked to
-- the owning seller's folder: path is `<auth.uid()>/...`.
-- ============================================================================

insert into storage.buckets (id, name, public)
  values ('brand-assets', 'brand-assets', true)
  on conflict (id) do nothing;

-- Public read (the logo is meant to be embedded publicly).
create policy "brand assets public read"
  on storage.objects for select
  using (bucket_id = 'brand-assets');

-- A seller may write ONLY inside their own top-level folder (uid/...).
create policy "brand assets insert own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "brand assets update own folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "brand assets delete own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
