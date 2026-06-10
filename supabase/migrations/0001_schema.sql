-- ============================================================================
-- ruo-stack — 0001_schema
-- White-label fulfillment SaaS for supplements & consumables.
--
-- Tenancy model: every business row is owned by a seller (auth.users.id).
-- Catalog (products/variants/lots) is platform-global and read-only to sellers.
-- All money movement goes through the wallet ledger (see 0003).
-- ============================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type user_role as enum ('seller', 'admin');

create type subscription_status as enum ('none', 'trialing', 'active', 'past_due', 'canceled');

create type sales_channel as enum ('woocommerce', 'shopify', 'wix', 'social', 'manual', 'custom');

create type wallet_txn_type as enum ('deposit', 'debit', 'refund', 'credit', 'adjustment', 'referral');

create type deposit_status as enum ('pending', 'paid', 'failed', 'expired');

create type order_status as enum (
  'pending',          -- created, not yet actioned
  'awaiting_funds',   -- wallet can't cover cost; parked
  'processing',       -- funds debited, being packed
  'shipped',          -- tracking assigned
  'delivered',
  'fulfilled',
  'cancelled',
  'refunded'
);

create type store_platform as enum ('woocommerce', 'shopify', 'wix', 'manual');

-- ----------------------------------------------------------------------------
-- profiles — one row per seller (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null default 'seller',
  full_name text,
  brand_name text,
  brand_website text,
  logo_url text,
  sales_channel sales_channel,
  experience_level text,
  -- subscription gate
  subscription_status subscription_status not null default 'none',
  subscription_bypass boolean not null default false,
  stripe_customer_id text,
  onboarding_complete boolean not null default false,
  -- return / from address used on shipping labels
  return_name text,
  return_street text,
  return_street2 text,
  return_city text,
  return_state text,
  return_zip text,
  return_phone text,
  referral_code text unique default encode(extensions.gen_random_bytes(6), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Catalog (platform-global). Supplements vertical: products -> variants -> lots
-- ----------------------------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,                 -- e.g. 'Vitamins', 'Aminos', 'Greens'
  slug text unique not null,
  description text,
  ingredients text,                       -- supplement facts / ingredient list
  serving_info text,                      -- supplement-facts panel text
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  sku text unique not null,
  size text not null,                     -- e.g. '60ct', '5lb', '500mg'
  wholesale_cost numeric(10,2) not null check (wholesale_cost >= 0), -- wallet debit
  suggested_retail numeric(10,2) check (suggested_retail >= 0),
  weight_oz numeric(8,2),                 -- for ShipStation rate/label
  in_stock boolean not null default true,
  created_at timestamptz not null default now()
);
create index on product_variants (product_id);

-- Batch/lot tracking for consumables: COA + expiry + on-hand qty per lot.
create table product_lots (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references product_variants (id) on delete cascade,
  lot_number text not null,
  coa_url text,                           -- link to certificate of analysis
  expiry_date date,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  received_at date,
  created_at timestamptz not null default now(),
  unique (variant_id, lot_number)
);
create index on product_lots (variant_id);

-- ----------------------------------------------------------------------------
-- Wallet (prepaid USD store credit) + ledger
-- ----------------------------------------------------------------------------
create table wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  balance numeric(12,2) not null default 0 check (balance >= 0),
  low_balance_threshold numeric(12,2) not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type wallet_txn_type not null,
  amount numeric(12,2) not null,          -- signed: deposits +, debits -
  balance_after numeric(12,2) not null,
  description text,
  order_id uuid,
  created_at timestamptz not null default now()
);
create index on wallet_transactions (user_id, created_at desc);

create table pending_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 1), -- $1 min
  status deposit_status not null default 'pending',
  stripe_session_id text unique,
  invoice_url text,
  created_at timestamptz not null default now(),
  last_checked_at timestamptz,
  credited_at timestamptz
);
create index on pending_deposits (user_id, status);

-- ----------------------------------------------------------------------------
-- Subscriptions (Pepify-Pro-style gate, Stripe-backed)
-- ----------------------------------------------------------------------------
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  stripe_subscription_id text unique,
  status subscription_status not null default 'none',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Orders (multi-line). order_items references catalog variants/lots.
-- ----------------------------------------------------------------------------
create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  external_order_id text,                 -- woo/shopify/wix id (idempotency)
  source store_platform not null default 'manual',
  status order_status not null default 'pending',
  customer_name text not null,
  customer_email text,
  -- shipping address (ship-to = seller's end customer)
  ship_name text,
  ship_street text,
  ship_street2 text,
  ship_city text,
  ship_state text,
  ship_zip text,
  ship_country text default 'US',
  ship_phone text,
  -- money (server-computed; never trust client)
  fulfillment_cost numeric(12,2) not null default 0,  -- wholesale + shipping debited
  shipping_cost numeric(12,2) not null default 0,
  order_total numeric(12,2),              -- what the seller charged their customer (optional)
  -- shipping
  carrier text,
  tracking_number text,
  label_url text,
  shipstation_order_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, external_order_id)
);
create index on orders (user_id, created_at desc);
create index on orders (status);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  variant_id uuid references product_variants (id),
  lot_id uuid references product_lots (id), -- which lot was used to fulfill (traceability)
  product_name text not null,             -- snapshot at order time
  sku text,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12,2) not null,       -- snapshot of wholesale_cost
  created_at timestamptz not null default now()
);
create index on order_items (order_id);

-- ----------------------------------------------------------------------------
-- Store integrations
-- ----------------------------------------------------------------------------
create table store_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform store_platform not null,
  store_url text,
  -- credentials are encrypted at the edge-function layer before insert.
  credentials_encrypted text,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, platform, store_url)
);

create table synced_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid references store_connections (id) on delete cascade,
  external_id text,
  name text,
  sku text,
  image_url text,
  price numeric(12,2),
  stock_status text,
  status text,
  updated_at timestamptz not null default now()
);
create index on synced_products (user_id);

create table sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  kind text not null,                     -- 'orders' | 'products' | 'tracking'
  status text not null,                   -- 'ok' | 'error'
  items_synced integer default 0,
  error_message text,
  duration_ms integer,
  started_at timestamptz,
  finished_at timestamptz default now()
);
create index on sync_logs (user_id, finished_at desc);

-- ----------------------------------------------------------------------------
-- Support / ops
-- ----------------------------------------------------------------------------
create table order_issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  issue_type text not null,
  message text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  note_text text not null,
  author text,                            -- 'admin' | 'system' | seller name
  created_at timestamptz not null default now()
);

create table saved_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  email text,
  street text,
  city text,
  state text,
  zip text,
  last_used_at timestamptz default now()
);
create index on saved_customers (user_id);

create table support_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  visitor_name text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table support_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references support_chats (id) on delete cascade,
  sender text not null,                   -- 'user' | 'admin' | 'ai'
  body text not null,
  created_at timestamptz not null default now()
);
create index on support_messages (chat_id, created_at);

-- ----------------------------------------------------------------------------
-- Platform-wide
-- ----------------------------------------------------------------------------
create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index on activity_log (created_at desc);

create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references auth.users (id) on delete cascade,
  referee_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending', -- pending | credited
  referrer_credit numeric(12,2) not null default 50,
  credited_at timestamptz,
  created_at timestamptz not null default now()
);

create table monitor_alerts (
  id uuid primary key default gen_random_uuid(),
  category text not null,                 -- unsupported_product | sync_failure | stuck_awaiting | missing_deduction
  order_id uuid references orders (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  details jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- updated_at trigger helper
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();
create trigger trg_wallets_updated before update on wallets
  for each row execute function set_updated_at();
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();
create trigger trg_subscriptions_updated before update on subscriptions
  for each row execute function set_updated_at();
