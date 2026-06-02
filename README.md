# ruo-stack

A **white-label fulfillment SaaS for supplements & consumables**. Sellers run
their own storefront; the platform holds inventory, fulfills orders under the
seller's brand (lot-tracked labels, branded packaging), and ships direct to the
seller's end customers. Sellers pre-fund a USD wallet; each fulfilled order
debits wholesale cost + shipping.

> Architecture inspired by a reverse-engineered reference platform, rebuilt
> clean for a lawful supplements vertical. No compliance-evasion behavior is
> included — payments go through Stripe the normal way and every product
> carries the standard FDA/DSHEA disclaimer.

## Stack

| Layer | Tech |
|---|---|
| Frontend | **Next.js 14** (App Router) + Tailwind |
| Backend / BaaS | **Supabase** — Postgres, Auth, RLS, Edge Functions (Deno) |
| Subscription + wallet billing | **Stripe** |
| Shipping labels | **ShipStation** (USPS/UPS/FedEx) |
| Store sync | WooCommerce / Shopify / Wix (Woo stubbed) |

## Repository layout

```
src/
  app/                     Next.js routes (marketing, auth, dashboard, admin, checkout)
  lib/supabase/            client (browser) / server (RLS) / admin (service role)
  lib/stripe.ts            server Stripe client
  middleware.ts            session refresh + route gating
supabase/
  migrations/
    0001_schema.sql        tables + enums (catalog → variants → lots, orders, wallet…)
    0002_rls.sql           Row-Level Security (multi-tenant isolation) + auth triggers
    0003_wallet_ledger.sql server-authoritative money: credit/debit/fulfill/refund RPCs
    0004_seed.sql          platform settings + sample lawful supplement catalog
  functions/
    create-wallet-checkout Stripe Checkout session for wallet top-up
    stripe-webhook         the ONLY writer of wallet credits + subscription status
    create-manual-order    server-priced order entry → fulfill_order()
    shipstation-buy-label  buy label, mark shipped + tracking
    process-awaiting-funds resume parked orders after a top-up
    admin-api              admin control plane (every action re-checks admin)
    woo-sync               WooCommerce integration (stub)
```

## Security model (read this before extending)

The reference platform's audit flagged two classic Supabase risks; both are
addressed here by design:

1. **Tenant isolation via RLS.** Every business table has RLS enabled and is
   scoped to `user_id = auth.uid()`. There is intentionally **no**
   `authenticated USING (true)` policy on any tenant table — that's the bug
   that leaks every user's rows to any signed-up user. Cross-tenant reads go
   through `is_admin()` (a `SECURITY DEFINER` function with a locked
   `search_path`). See `0002_rls.sql`.

2. **Server-authoritative money.** Clients can **read** their wallet but can
   never write a balance. All money movement runs through `SECURITY DEFINER`
   RPCs (`credit_wallet`, `debit_wallet`, `fulfill_order`, `refund_order`,
   `credit_deposit`) that are `REVOKE`d from clients. Amounts are recomputed
   server-side from the catalog — the client never supplies a figure that moves
   money. `balance` always equals `sum(wallet_transactions.amount)`. See
   `0003_wallet_ledger.sql`.

Additional guards:
- A `before update` trigger on `profiles` blocks sellers from changing their own
  `role`, `subscription_status`, or `subscription_bypass` (privilege escalation).
- The Stripe webhook is the **only** path that credits the wallet, and crediting
  is idempotent (`credit_deposit` no-ops if already paid), so retries and
  abandoned checkouts can't double-credit or credit early.
- `admin-api` re-checks `requireAdmin()` on every action and writes an
  `activity_log` row for privileged actions.

## Order lifecycle

```
pending ──fulfill_order()──► processing ──buy label──► shipped ──► delivered/fulfilled
   │            │
   │   (wallet too low)
   └────────────┴────────────► awaiting_funds ──top-up──► (process_awaiting_funds) ──► processing
```

`refund_order()` credits the wallet back and sets `refunded` (guards against
double-refund).

## Local development

Prereqs: Node 18+, Docker (for Supabase local), the Supabase CLI.

```bash
npm install
cp .env.example .env.local        # fill in keys

# start local Supabase (Postgres + Auth + Edge runtime)
supabase start
supabase db reset                 # applies migrations 0001–0004

npm run dev                       # http://localhost:3000
```

To make yourself an admin locally, after signing up:

```sql
update profiles set role = 'admin' where user_id = '<your-auth-uid>';
```

### Deploying the backend

```bash
supabase link --project-ref <your-project-ref>
supabase db push                  # migrations
supabase functions deploy         # edge functions

# set function secrets (NOT committed)
supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... \
  SHIPSTATION_API_KEY=... SHIPSTATION_API_SECRET=... SITE_URL=https://...
```

Point a Stripe webhook at the `stripe-webhook` function URL and subscribe to
`checkout.session.completed` and `customer.subscription.*`.

## What's stubbed / next

- **Shopify / Wix** sync (WooCommerce is implemented in `woo-sync`).
- Referrals crediting, AI/human support chat, realtime order notifications.
- Generated DB types: `npm run db:types`.

### Implemented

- **WooCommerce** (`woo-sync`): `connect` / `test_connection` / `sync_products`
  / `sync_orders` / `push_tracking` / `disconnect`. Store credentials are
  AES-256-GCM encrypted (`_shared/crypto.ts`, key = `CREDENTIALS_ENC_KEY`)
  before they hit `store_connections.credentials_encrypted`. Imported orders
  are priced from OUR catalog by SKU match — unmatched SKUs raise an
  `unsupported_product` alert and skip. Seller UI at `/dashboard/stores`.
- **Manual order entry** (`/dashboard/orders/new`) drives `create-manual-order`:
  catalog picker, saved-customers prefill, live wallet-debit total.
- **Onboarding** (`/onboarding`) + **branding** (`/dashboard/branding`) with logo
  upload to the `brand-assets` Storage bucket (own-folder-only write RLS).

## Compliance

Supplements are sold with the standard disclaimer ("These statements have not
been evaluated by the FDA…") rendered on the marketing and catalog pages and
seeded in `platform_settings`. Confirm your own labeling, DSHEA, and
state-registration obligations before going live.
