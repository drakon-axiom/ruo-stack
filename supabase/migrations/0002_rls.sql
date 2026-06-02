-- ============================================================================
-- ruo-stack — 0002_rls
-- Row-Level Security. Default-deny everything, then grant per-tenant access.
--
-- DESIGN RULES (the bugs §14 of the audit warns about):
--   * NEVER write a policy `USING (true)` for the `authenticated` role on a
--     tenant table — that leaks every seller's rows to every signed-up user.
--   * Tenant tables are scoped to `user_id = auth.uid()`.
--   * Admin access goes through is_admin(), checked server-side.
--   * Money tables (wallets, wallet_transactions, orders money fields) are
--     READ-only to sellers; all writes happen via SECURITY DEFINER functions
--     and edge functions using the service role. Clients can never UPDATE a
--     balance directly.
-- ============================================================================

-- is_admin(): true when the caller's profile.role = 'admin'.
-- SECURITY DEFINER so the lookup itself isn't blocked by RLS, with a locked
-- search_path to prevent hijacking.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;
revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- Enable RLS on every table
-- ----------------------------------------------------------------------------
alter table profiles            enable row level security;
alter table products            enable row level security;
alter table product_variants    enable row level security;
alter table product_lots        enable row level security;
alter table wallets             enable row level security;
alter table wallet_transactions enable row level security;
alter table pending_deposits    enable row level security;
alter table subscriptions       enable row level security;
alter table orders              enable row level security;
alter table order_items         enable row level security;
alter table store_connections   enable row level security;
alter table synced_products     enable row level security;
alter table sync_logs           enable row level security;
alter table order_issues        enable row level security;
alter table order_notes         enable row level security;
alter table saved_customers     enable row level security;
alter table support_chats       enable row level security;
alter table support_messages    enable row level security;
alter table announcements       enable row level security;
alter table activity_log        enable row level security;
alter table referrals           enable row level security;
alter table monitor_alerts      enable row level security;
alter table platform_settings   enable row level security;

-- ----------------------------------------------------------------------------
-- profiles: a seller reads/updates only their own row; admins see all.
-- (role column is NOT updatable by the seller — enforced in a trigger below.)
-- ----------------------------------------------------------------------------
create policy profiles_select_own on profiles
  for select using (user_id = auth.uid() or is_admin());
create policy profiles_update_own on profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profiles_admin_all on profiles
  for all using (is_admin()) with check (is_admin());

-- Prevent privilege escalation: a seller cannot promote themselves to admin
-- or flip their own subscription gate. Only admins / service role may.
create or replace function guard_profile_writes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.subscription_status is distinct from old.subscription_status
     or new.subscription_bypass is distinct from old.subscription_bypass
     or new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'protected profile field cannot be modified by seller';
  end if;
  return new;
end;
$$;
create trigger trg_guard_profile before update on profiles
  for each row execute function guard_profile_writes();

-- ----------------------------------------------------------------------------
-- Catalog: readable by any authenticated user; writable only by admins.
-- ----------------------------------------------------------------------------
create policy products_read on products
  for select using (auth.role() = 'authenticated');
create policy products_admin on products
  for all using (is_admin()) with check (is_admin());

create policy variants_read on product_variants
  for select using (auth.role() = 'authenticated');
create policy variants_admin on product_variants
  for all using (is_admin()) with check (is_admin());

create policy lots_read on product_lots
  for select using (auth.role() = 'authenticated');
create policy lots_admin on product_lots
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- Wallet + ledger: READ own only. No client writes (service role bypasses RLS).
-- ----------------------------------------------------------------------------
create policy wallets_read_own on wallets
  for select using (user_id = auth.uid() or is_admin());

create policy wallet_txn_read_own on wallet_transactions
  for select using (user_id = auth.uid() or is_admin());

create policy deposits_read_own on pending_deposits
  for select using (user_id = auth.uid() or is_admin());

create policy subscriptions_read_own on subscriptions
  for select using (user_id = auth.uid() or is_admin());

-- ----------------------------------------------------------------------------
-- Orders: seller reads own; may INSERT/UPDATE own ONLY while pending/manual.
-- Status transitions that move money (-> processing/shipped/refunded) happen
-- via edge functions (service role), never client-side.
-- ----------------------------------------------------------------------------
create policy orders_read_own on orders
  for select using (user_id = auth.uid() or is_admin());
create policy orders_insert_own on orders
  for insert with check (user_id = auth.uid());
create policy orders_update_own_limited on orders
  for update using (user_id = auth.uid() and status in ('pending', 'awaiting_funds'))
  with check (user_id = auth.uid());
create policy orders_admin_all on orders
  for all using (is_admin()) with check (is_admin());

create policy order_items_read_own on order_items
  for select using (
    exists (select 1 from orders o where o.id = order_id and (o.user_id = auth.uid() or is_admin()))
  );
create policy order_items_write_own on order_items
  for insert with check (
    exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Store connections / synced products / sync logs — own only.
-- (credentials_encrypted is never selected by the client; see lib/queries.)
-- ----------------------------------------------------------------------------
create policy store_conn_own on store_connections
  for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid());
create policy synced_products_own on synced_products
  for select using (user_id = auth.uid() or is_admin());
create policy sync_logs_own on sync_logs
  for select using (user_id = auth.uid() or is_admin());

-- ----------------------------------------------------------------------------
-- Support / ops tables — own only (admins all).
-- ----------------------------------------------------------------------------
create policy order_issues_own on order_issues
  for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid());
create policy order_notes_read on order_notes
  for select using (
    exists (select 1 from orders o where o.id = order_id and (o.user_id = auth.uid() or is_admin()))
  );
create policy saved_customers_own on saved_customers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy support_chats_own on support_chats
  for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid() or is_admin());
create policy support_messages_own on support_messages
  for all using (
    exists (select 1 from support_chats c where c.id = chat_id and (c.user_id = auth.uid() or is_admin()))
  ) with check (
    exists (select 1 from support_chats c where c.id = chat_id and (c.user_id = auth.uid() or is_admin()))
  );

create policy referrals_own on referrals
  for select using (referrer_id = auth.uid() or is_admin());

-- ----------------------------------------------------------------------------
-- Announcements: read by all authenticated; write by admin.
-- ----------------------------------------------------------------------------
create policy announcements_read on announcements
  for select using (auth.role() = 'authenticated');
create policy announcements_admin on announcements
  for all using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- Admin-only tables.
-- ----------------------------------------------------------------------------
create policy activity_log_admin on activity_log
  for select using (is_admin());
create policy monitor_alerts_admin on monitor_alerts
  for select using (is_admin());
create policy platform_settings_admin on platform_settings
  for all using (is_admin()) with check (is_admin());

-- ============================================================================
-- Auto-provision profile + wallet on signup.
-- ============================================================================
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, full_name)
    values (new.id, new.raw_user_meta_data ->> 'full_name')
    on conflict (user_id) do nothing;
  insert into public.wallets (user_id) values (new.id)
    on conflict (user_id) do nothing;
  insert into public.subscriptions (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
