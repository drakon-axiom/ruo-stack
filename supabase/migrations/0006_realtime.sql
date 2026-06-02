-- ============================================================================
-- ruo-stack — 0006_realtime
-- Enable Supabase Realtime on `orders` so the admin fulfillment screen (and,
-- later, seller dashboards) update live as orders move through the lifecycle.
--
-- Realtime postgres_changes still honors RLS: each subscriber only receives
-- changes for rows they're allowed to SELECT (admins → all; sellers → own).
-- REPLICA IDENTITY FULL makes the previous row available in UPDATE/DELETE
-- payloads, which RLS needs to evaluate the old row and which lets clients see
-- status transitions (e.g. processing → shipped).
-- ============================================================================

alter table public.orders replica identity full;

do $$
begin
  -- Supabase provisions the `supabase_realtime` publication; guard so this
  -- migration is a no-op on a bare Postgres without it, and idempotent.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'orders'
    ) then
      alter publication supabase_realtime add table public.orders;
    end if;
  end if;
end $$;
