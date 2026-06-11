# RUOStack — Phase 0 Build Prompt (Foundations)

*A build prompt for an agentic coding tool (Claude Code or equivalent). It builds **only Phase 0** of the RUOStack platform: the foundation layer everything else depends on. Hand this prompt to the agent together with the four planning docs, which are the authoritative source of truth. **Target backend: Supabase** — see "Supabase platform notes" below.*

---

## How to use this prompt

Paste this into your coding agent with the five RUOStack planning docs attached:
`pepify_build_spec.md`, `pepify_screen_teardown.html`, `ruostack_woocommerce_shipstation_plan.md`, `ruostack_payments_framework.md`, and `ruostack_platform_architecture.md`.

**Build only what §"Scope" lists. Build nothing in §"Out of scope."** When a later-phase concern is unavoidable (e.g. a stock change must eventually push to WooCommerce), implement a clearly-named, no-op **hook/seam** with a `TODO(Phase N)` comment — never a fake implementation that pretends to work.

---

## Context (two sentences)

RUOStack is a two-sided white-label fulfillment platform: a **brand app** where brand owners run a storefront and pre-fund a wallet, and an **operator/admin** back office that manages catalog, fulfillment, and finance — sharing one backend. The product operates in the research-use-only peptide vertical; keep the existing "research use only" disclaimers and compliance framing intact wherever they appear in the source docs — do not strip or editorialize them.

This is **Phase 0 of a phased build**. It deliberately ships almost no end-user features. Its job is to make the *security boundary, the audit spine, the catalog master, and the processor seam* correct so the later phases bolt on cleanly.

---

## Stack

End-to-end TypeScript on a **Supabase** backend:

- **Backend:** Node + TypeScript, **Fastify** (Express acceptable). Validation with **zod**. The API is the only consumer of the database and connects via a privileged Supabase role (see notes).
- **Platform / DB:** **Supabase** — managed **PostgreSQL** + **Auth** + **Storage**. ORM is **Prisma**, managing the **`public` schema only** (never `auth`/`storage`/`realtime`).
- **Frontend:** **React + Vite + Tailwind**. Two *separate* frontend apps (admin, brand) to enforce the realm boundary at the deploy level.
- **Auth:** **brand realm on Supabase Auth**; **admin realm identity kept out of the customer pool** (hand-rolled admin JWT, or a second Supabase project). See "Supabase platform notes."
- **Payments:** Stripe Node SDK — but **only behind the PaymentsAdapter** (see invariants).
- **Layout:** monorepo (pnpm/npm workspaces). See §"Suggested structure."

---

## Supabase platform notes (read before building)

The platform runs on Supabase, which is opinionated about auth and security. These decisions are authoritative; downstream sections reference them.

### Auth & the two realms
Supabase Auth is a **single user pool with one signing secret**, so the realm boundary is expressed by **identity separation + claims + RLS**, not two signing secrets:

- **Brand realm → Supabase Auth** (main project `auth.users`). Use it for signup, login, refresh, logout, email confirmation, and **password reset** (Supabase sends the auth emails via configurable SMTP) and **MFA** (optional for brand). The brand frontend talks to Supabase Auth via `supabase-js`.
- **Brand claims for RLS** → a **Custom Access Token Hook**: a `public.custom_access_token_hook(event jsonb)` PL/pgSQL function (granted to `supabase_auth_admin`, enabled in Auth → Hooks) that reads a **server-owned** roles/membership table and injects `realm: 'brand'` and the user's `brand_id` into the JWT. Roles/tenancy live in a DB table the user cannot write — **never** in `user_metadata`.
- **Admin realm identity stays OUT of the customer pool** (the security boundary). Ship **(a)** the hand-rolled admin JWT below (separate `AdminUser` table, own signing secret, TOTP via `otplib`) for MVP simplicity — *recommended* — or **(b)** a second Supabase project as the operator IdP. Either way the **admin backend connects to the one shared (main-project) database via the service role**.
- **MFA:** admin login cannot complete without TOTP (option a) or enforced AAL2 (option b). Brand MFA optional via Supabase Auth.

### Authorization & RLS
- The Fastify API connects via a **privileged role that bypasses RLS** and enforces authorization in **app code** (route guards + the role-gate matrix). Per Supabase's Prisma guidance, create a dedicated `prisma` role: `create user "prisma" with password '…' bypassrls createdb;` then `grant "prisma" to "postgres";` and grant it the `public` schema.
- **Enable RLS deny-by-default on every `public` table** as defense-in-depth — so a bug or any future direct-client path cannot leak across tenants. Express brand tenant isolation as RLS keyed on `auth.uid()` → `BrandMember` → `brand_id` (or the injected `brand_id` claim).
- **If the API is the only DB consumer, turn off the Supabase Data API (PostgREST)** in project API settings. Direct `supabase-js` is used only for **brand Supabase Auth** and **Supabase Storage**.
- **Append-only `AuditLog`:** because the privileged role bypasses RLS, enforce append-only with a **`BEFORE UPDATE OR DELETE` trigger that raises an exception** (holds even against the service role), with an RLS insert/select-only policy as a second layer.

### Connection strings (Prisma + Supabase) — get this right or migrations/prepared-statements break
- `DATABASE_URL` → **transaction pooler, port `6543`**, append **`?pgbouncer=true`** (transaction mode has **no prepared statements**); add `&connection_limit=1` if deployed serverless.
- `DIRECT_URL` → **port `5432`** (session pooler or direct), used for **migrations**.
- Prisma datasource: `provider="postgresql"`, `url=env("DATABASE_URL")`, `directUrl=env("DIRECT_URL")`.
- A persistent (non-serverless) Fastify container may use the session pooler (`5432`) for `DATABASE_URL` directly; the `6543`+`pgbouncer=true` config above is the portable default.
- **Footgun:** don't make schema changes in the Supabase dashboard/SQL editor *and* via Prisma migrations — Prisma treats out-of-band DDL as **drift** and may try to reset. Prisma owns `public`; baseline if syncing an existing project.

### Storage
- Use **Supabase Storage** for brand logo upload (the `Branding` screen is later, but stand up the bucket + a **path-scoped storage policy** so a brand can only write its own prefix). Claims-evidence photos (later phases) reuse this.

---

## Scope — what Phase 0 delivers

1. **Two-realm authentication** — **brand on Supabase Auth**; **admin identity kept separate** (hand-rolled admin JWT or second project), connecting via the service role. Brand/admin separation and brand-to-brand isolation enforced by **claims + RLS + server-side route guards**. A brand (Supabase Auth) token cannot satisfy an admin route guard, and vice versa.
2. **Brand / User / BrandMember split** — the tenant (`Brand`) cleanly separated from the person (the brand `User` = a Supabase `auth.users` row), joined by `BrandMember`. Signup creates the brand-side records atomically with exactly one `owner` member.
3. **AuditLog** — append-only (trigger-enforced); written on every mutating admin action and every sensitive brand action.
4. **AdminUser + role middleware** — four roles (`super_admin`, `operations`, `support`, `finance`) with the role-gate matrix enforced **server-side** on every admin route.
5. **CatalogProduct master + Catalog Manager admin screen** — the operator-owned source of truth for the 36 SKUs; SKU immutable once published; brand-facing catalog is a read projection.
6. **PaymentsAdapter interface + StripeAdapter** — the processor-portability seam, plus a signature-verifying webhook receiver with idempotency. (No wallet/subscription *flows* yet — those are Phase 1.)
7. **RLS baseline** — RLS enabled deny-by-default on every `public` table; brand tenant-isolation policies; the custom access token hook; the audit-log append-only trigger.

Plus the minimal surfaces needed to *exercise and prove* the above: admin login+MFA, a minimal admin shell, an Admin Users & Roles screen with an AuditLog viewer, brand signup/login/reset (via Supabase Auth), a brand app shell, and an Account stub.

---

## Out of scope — do NOT build in Phase 0

WooCommerce connector · ShipStation adapter (v1/v2) · rate proxy / Fulfillment Rules Engine / Box catalog / ServiceMapping · wallet **ledger mutations** (deposit/hold/capture) · order intake / order state machine · Exceptions Console · Claims (intake or admin) · Reconciliation worker · stock-**push** implementation (build the hook only) · Announcements · brand Provisioning wizard · Live Chat · referral **reward** logic (store `referred_by`, nothing more) · Profit Calculator · Tracking / Customers / Address Book screens · the full brand screen suite beyond shell + Account.

Brand subscription self-service (Stripe Portal), the wallet UI, and webhook→ledger wiring are **Phase 1** — leave clean seams, build nothing.

---

## Data model (Phase 0 entities only)

Prisma-style (`public` schema); adjust types to taste. All money in integer **cents**. All tables get `created_at`; mutable ones get `updated_at`.

```
// The brand "person" is a Supabase auth.users row. This public table holds app fields,
// keyed to the Supabase user id. Do NOT recreate password_hash/MFA here — Supabase Auth owns those.
UserProfile          // realm: brand
  id (uuid)          // == auth.users.id (FK by convention; auth schema is Supabase-owned)
  full_name
  name_last_changed_at?                  // enforces "name editable once / 7 days"

Brand                // the tenant
  id, brand_name, logo_url?, website?, sales_channel?
  subscription_status (enum: none|pro, default none)   // convenience flag; SubscriptionState is SoT in Phase 1
  stripe_customer_id?, member_since (default now)
  referral_code @unique, referred_by?                  // store only; reward logic is later

BrandMember          // join: which users belong to which brand
  id, brand_id -> Brand, user_id (uuid -> auth.users.id)
  role (enum: owner|staff), status (enum: active|invited|suspended)
  invited_at?
  @@unique([brand_id, user_id])

BrandUserRole        // server-owned source for the custom access token hook (NOT user_metadata)
  id, user_id (uuid), realm (enum: brand), brand_id -> Brand
  // hook reads this to inject realm + brand_id claims; written only by the API (service role)

AdminUser            // realm: admin — separate from the customer pool (option a)
  id, email @unique, password_hash, full_name
  role (enum: super_admin|operations|support|finance)
  status (enum: active|suspended)
  mfa_enabled (bool, default false), mfa_secret (nullable, encrypted)
  last_login_at?, created_by?  // AdminUser.id

AuditLog             // APPEND-ONLY (trigger-enforced; see Supabase notes)
  id, actor_type (enum: admin|brand|system), actor_id
  action (string)                 // e.g. catalog.updated, catalog.published, sku.stock_changed,
                                  //      role.granted, role.revoked, admin.suspended,
                                  //      brand.profile_updated, wallet.manual_adjustment
  target_type, target_id
  before (jsonb?), after (jsonb?), reason?, ip?, created_at
  // no updated_at, no soft-delete

CatalogProduct       // operator-owned master; brand Product is a projection of this
  id, canonical_sku @unique, compound, dose, unit, name, description_template
  wholesale_cost (cents), suggested_retail (cents)
  status (enum: in_stock|soon|out_of_stock, default soon)   // stock state
  is_published (bool, default false)   // governs SKU immutability + brand visibility (see note)
  weight?, length?, width?, height?, packaging_rule?        // dims feed the future rate engine
  coa_id?, images (string[]), updated_by?, updated_at

AdminSession         // revocable admin refresh tokens (option a only; Supabase Auth manages brand sessions)
  id, admin_user_id -> AdminUser, refresh_token_hash, expires_at, revoked_at?, ip?, user_agent?

AdminPasswordResetToken   // option a only; brand resets are handled by Supabase Auth
  id, admin_user_id -> AdminUser, token_hash, expires_at, used_at?

WebhookEvent         // idempotency for the Phase 0 webhook receiver (Phase 1 builds on this)
  id, source (enum: stripe), external_id, type, payload (jsonb)
  status (enum: received|processed|failed), attempts (int, default 0), processed_at?
  @@unique([source, external_id])

BrandTaxExemption    // SCHEMA ONLY in Phase 0 — no endpoints/UI; gives the SALT determination
  id, brand_id -> Brand, state, certificate_ref, expires_at?   // somewhere to land later (arch §5.3)
  status (enum: none|on_file|expired, default none)
```

> **Note (`is_published`):** the source doc lists `CatalogProduct.status` as the stock state only. To implement "SKU immutable once published" cleanly, Phase 0 adds an orthogonal **`is_published`** boolean: while `false`, the canonical SKU is editable and the product does **not** project to brands; on publish, the SKU **locks** and the product becomes brand-visible.
>
> **Note (Supabase Auth ownership):** brand credentials, password hashes, sessions, and MFA factors live in Supabase's `auth` schema — do not duplicate them in `public`. `UserProfile`/`BrandMember`/`BrandUserRole` hold only app data, keyed to `auth.users.id`.

---

## Backend

### Modules / services

- **Brand auth (Supabase Auth):** signup → creates the `auth.users` row (via Supabase Auth) **and** `Brand` + `owner` `BrandMember` + `BrandUserRole` atomically (server-side, service role); login/refresh/logout/reset handled by Supabase Auth. The API verifies Supabase-issued JWTs and the injected `realm`/`brand_id` claims on brand routes.
- **Admin auth (option a):** realm-scoped login, refresh, logout, password reset (via the `EmailAdapter`); TOTP enrollment/verification. Role-gate middleware reading a per-route required-role declaration, enforced server-side.
- **Custom Access Token Hook (SQL):** the `public.custom_access_token_hook` function + grants, plus the `BrandUserRole` read it depends on. Ship as a migration; document enabling it in Auth → Hooks.
- **Catalog Admin:** CRUD on `CatalogProduct`; publish action; stock-status action. Every mutation writes an `AuditLog`. Stock change calls a stubbed `onCatalogStockChanged(product)` hook (`TODO(Phase 1)`: Woo stock push).
- **Admin Users & Roles (super_admin only):** create admin (issues invite/initial-password), grant/revoke role, suspend/activate (suspend revokes the admin's sessions). All audited. AuditLog query endpoint with filters.
- **Brand Profile:** read `me` (profile + brand + membership); patch profile with the once-per-7-days name rule; audited as a sensitive brand action.
- **Payments seam:** `PaymentsAdapter` + `StripeAdapter` + a stub `HighRiskAcquirerAdapter`; the webhook receiver.
- **Email seam:** `EmailAdapter` interface + a `ConsoleEmailAdapter` (dev). **Scope narrows under Supabase:** brand auth emails (confirm/reset) are sent by **Supabase Auth**; the adapter covers **admin invites/resets** (option a) and future non-auth transactional mail (notifications, announcements).
- **Config:** all secrets via env, validated with zod at boot; refuse to start if any required var is missing. Ship `.env.example` (incl. `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, admin `JWT_ADMIN_SECRET` + `MFA_ENCRYPTION_KEY` for option a).
- **Bootstrap:** a `seed:superadmin` command to create the first `super_admin` (option a) — solving the empty-admin-table chicken-and-egg; force MFA enrollment on first login. (Option b: create the first operator in the admin project, then mirror an `AdminUser` row.)

### API surface (Phase 0)

Brand realm (JWTs issued by Supabase Auth; API verifies + reads `realm`/`brand_id` claims):
```
POST /api/brand/signup             full_name, email, password, ref?
                                   → Supabase Auth createUser + atomically create Brand + owner BrandMember + BrandUserRole
                                   (login/refresh/logout/forgot/reset are handled by Supabase Auth via supabase-js on the client)
GET  /api/brand/me                 profile + brand + membership
PATCH /api/brand/profile           full_name (enforce 7-day lock), brand_name, website, sales_channel → AuditLog
GET  /api/brand/catalog            read projection: published CatalogProducts (light — proves the seam)
```

Admin realm (option a; `/auth/admin/*`, `/api/admin/*`):
```
POST /auth/admin/login             email, password → TOTP required → access + refresh
POST /auth/admin/refresh | logout
POST /auth/admin/mfa/enroll        returns provisioning URI/QR secret
POST /auth/admin/mfa/verify        confirms enrollment
GET  /api/admin/catalog            list, search, filter by status      [ops, super_admin: write | support, finance: view]
POST /api/admin/catalog            create (SKU settable while unpublished)
GET  /api/admin/catalog/:id
PATCH /api/admin/catalog/:id       edit; REJECT canonical_sku change if is_published → AuditLog
POST /api/admin/catalog/:id/publish    locks SKU, makes brand-visible → AuditLog
POST /api/admin/catalog/:id/stock      set status → AuditLog + onCatalogStockChanged() hook
GET  /api/admin/admins             [super_admin only]
POST /api/admin/admins             create admin + invite → AuditLog
PATCH /api/admin/admins/:id/role   grant/revoke → AuditLog
PATCH /api/admin/admins/:id/status suspend/activate (suspend revokes sessions) → AuditLog
GET  /api/admin/audit-log          filter: actor_type, actor_id, action, target, date range
POST /api/payments/webhook         Stripe — signature-verify, idempotent persist (WebhookEvent),
                                   normalize → no-op sink with TODO(Phase 1). NO ledger mutation.
```

### PaymentsAdapter contract

Core/business code calls **only** this interface — never the Stripe SDK directly.

```ts
type NormalizedEvent =
  | { kind: 'wallet.topup_succeeded';  externalId: string; ... }
  | { kind: 'wallet.topup_failed';     externalId: string; ... }
  | { kind: 'subscription.activated' | 'subscription.past_due'
          | 'subscription.suspended' | 'subscription.cancelled'; externalId: string; ... }
  | { kind: 'dispute.opened' | 'refund.processed'; externalId: string; ... }
  | { kind: 'unknown'; externalId: string; rawType: string };

interface PaymentsAdapter {
  createSubscription(input): Promise<{ subscriptionId: string; status: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  updateSubscription(subscriptionId: string, input): Promise<{ subscriptionId: string; status: string }>;
  createCheckout(input): Promise<{ url: string; sessionId: string }>;       // wallet top-up
  createBillingPortalSession(customerId: string): Promise<{ url: string }>; // Phase 1 brand portal; define now
  verifyAndParseWebhook(rawBody: Buffer, signature: string): NormalizedEvent;
  issueRefundCredit(input): Promise<void>;
  handleDispute(input): Promise<void>;
}
```

- **StripeAdapter** — real implementations. `createCheckout` returns a live Stripe **test-mode** Checkout Session URL; `verifyAndParseWebhook` verifies the signature and maps Stripe event types → `NormalizedEvent` (so core never imports Stripe types).
- **HighRiskAcquirerAdapter** — implements the same interface, every method `throw new Error('NotImplemented: HighRiskAcquirer')`. Its existence proves the seam; do not fake behavior.
- Statement descriptors / product naming must read as **software/logistics** ("RUOStack Membership", "RUOStack Fulfillment Credit"), per payments-framework §1.3 — never peptides.

---

## Frontend

### Design system

Use the **RUOStack brand palette** (the product is RUOStack; Pepify was the reverse-engineered reference): Navy `#1F2A44`, Teal `#1D9E75` (primary/brand accent), White. Reuse the Pepify structural dark-theme tokens for surfaces (`--bg #080b14`, `--card #121829`, hairline borders, ~12–16px radii, pill buttons/tabs). Keep a **distinct success green** separate from the teal accent so status reads clearly. Logo assets are in the RUOStack logo pack (`README.md`): use the **reversed logo on navy** for admin chrome.

- **Admin:** dark theme only, RUOStack reversed logo + a **role badge** in the top bar so an operator never confuses it with a brand view.
- **Brand:** light theme for auth, dark for the app (matching Pepify), with the light/dark toggle.

Every screen follows the universal skeleton: **header → KPI cards → filter tabs (with counts) → search → table/empty state.**

### Admin screens (Phase 0)

1. **Login + MFA** — email/password, then TOTP step (enrollment on first login for the seeded super_admin).
2. **Shell** — sidebar nav (role badge, reversed logo); only Phase 0 destinations active.
3. **Catalog Manager** — table of `CatalogProduct` (search + status filter tabs); row **edit drawer** (cost/retail/stock/weight/dims/packaging/COA); **Create** action; **Publish** action; **stock toggle**. After publish, the canonical-SKU field renders **locked** (disabled + tooltip explaining immutability). Saving writes audit entries.
4. **Admin Users & Roles** (super_admin only) — admin list; **create admin**; **grant/revoke role**; **suspend/activate**; and a filterable **AuditLog viewer** (the artifact that proves the audit spine works end-to-end).

### Brand screens (Phase 0)

1. **Signup / Login / Forgot-Reset** — implemented against **Supabase Auth** via `supabase-js`. Signup accepts `?ref=CODE` → stored as `referred_by`. Password reset + email confirmation use Supabase Auth's email flow (link lands per SMTP config; in local dev, via the Supabase inbucket/test inbox).
2. **Shell** — sidebar showing the full Pepify IA groups, but **non-Phase-0 items disabled / routed to a "Coming soon" placeholder** so the structure is visible without implying it's built.
3. **Account stub** — Profile Information (full name with the 7-day lock surfaced inline; Research Company Name), Email (Supabase Auth change-email flow is fine), Password (Supabase Auth reset), and a **Subscription** section showing plan state as a placeholder (no Stripe Portal yet — Phase 1).

---

## Critical invariants (non-negotiable — call out in code review)

1. **Realm isolation.** Brand identity is Supabase Auth; **admin identity is kept out of the customer pool** (separate signing secret / separate project). Brand routes verify Supabase JWTs + the `realm: 'brand'` claim; admin routes verify the admin credential. No code path lets a brand token satisfy an admin route guard or vice versa — verified by test. Realm/role for the brand lives in a **server-owned table feeding the access-token hook**, never in `user_metadata`.
2. **AuditLog is append-only.** Enforced by a **`BEFORE UPDATE OR DELETE` trigger that raises** (robust even against the RLS-bypassing service role), plus an RLS insert/select-only policy. One entry is written for **every** mutating admin action and every sensitive brand action.
3. **RLS deny-by-default on every `public` table.** RLS is enabled platform-wide as defense-in-depth; the API's privileged role bypasses it but app code enforces authz. Brand tenant isolation is expressed as RLS so a direct-client path cannot read another brand's rows. If the Data API (PostgREST) isn't needed, it is turned off.
4. **Payments isolation.** The Stripe SDK is imported in the `payments` adapter package **only**. Add a CI check (grep/lint) failing the build if `stripe` is imported outside the adapter directory.
5. **Catalog mastership + SKU immutability.** `CatalogProduct` is the single source of truth; the brand catalog is a **read projection** (never independently written). `canonical_sku` is rejected on edit once `is_published` is true. Never auto-suffix a SKU.
6. **Secrets.** No keys in code or committed config. All via env, validated at boot; app refuses to start if a required secret is absent. `.env.example` only. The **service role key is server-only** — never shipped to a frontend.
7. **Server-side authorization.** Role gates enforced on the server per route, not merely hidden in the UI. Suspending an admin revokes their active sessions.
8. **MFA.** Admin login cannot complete without a verified TOTP factor (option a) or enforced AAL2 (option b).
9. **Schema ownership.** Prisma manages the `public` schema only; never `auth`/`storage`. No out-of-band DDL in the dashboard that would cause Prisma drift.

---

## Testing (focus the suite here)

Write integration tests proving the security/correctness-critical behaviors specifically:

- A brand (Supabase Auth) token on any `/api/admin/*` route → 401/403; an admin token on any `/api/brand/*` route → 401/403.
- An `operations` admin hitting a `super_admin`-only route (role grant, admin suspend) → 403.
- **RLS:** authenticated as brand A's user via a direct Supabase client, a query for brand B's rows returns nothing (cross-tenant isolation), and RLS is enabled on every `public` table (assert none are RLS-disabled).
- Editing a `CatalogProduct` writes a before/after `AuditLog` row; **UPDATE/DELETE on `audit_log` is rejected even via the service role** (trigger).
- Changing `canonical_sku` after publish → rejected with a clear error.
- Toggling stock writes an audit row and invokes `onCatalogStockChanged`.
- Brand **signup atomicity**: a forced failure mid-signup leaves **no** orphan `Brand`, `BrandMember`, `BrandUserRole`, or `auth.users` row.
- `verifyAndParseWebhook` rejects a bad signature; a duplicate `(source, external_id)` is a no-op (idempotency).
- CI guard: Stripe SDK imported only inside the payments adapter package.

---

## Definition of done (Phase 0)

- [ ] Supabase project provisioned; Prisma connected via the dedicated `bypassrls` role using `DATABASE_URL` (6543, `pgbouncer=true`) + `DIRECT_URL` (5432); first migration applied; PostgREST disabled (API-only).
- [ ] RLS enabled deny-by-default on every `public` table; the custom access token hook injects `realm`/`brand_id`; a second brand cannot read the first brand's data via a direct client.
- [ ] `seed:superadmin` creates the first super_admin; first login forces TOTP enrollment (option a).
- [ ] Super_admin (with TOTP) can create an `operations` admin; that admin logs in but is **403** on role-grant and brand-suspend routes.
- [ ] A brand can sign up via Supabase Auth (Brand + owner BrandMember + BrandUserRole created atomically) and log in; forgot/reset works through Supabase Auth.
- [ ] Catalog Manager: create → publish → SKU field locks; editing cost writes an audit entry visible in the AuditLog viewer; SKU edit after publish is rejected; stock toggle audits + fires the stub hook.
- [ ] Cross-realm tokens are rejected (both directions).
- [ ] `audit_log` UPDATE/DELETE is blocked by the trigger even via the service role.
- [ ] `PaymentsAdapter.createCheckout` returns a live Stripe **test-mode** URL; the webhook endpoint verifies signatures, persists idempotently, normalizes events, and performs **no** ledger mutation.
- [ ] `HighRiskAcquirerAdapter` implements the full interface and throws `NotImplemented`.
- [ ] App boots only with all required env vars; `.env.example` present; service-role key never reaches a frontend.
- [ ] The test suite in §"Testing" passes; the Stripe-import CI guard is in place.

---

## Suggested structure

```
/apps
  /api          Fastify app — routes, middleware, services, bootstrap (seed:superadmin)
  /admin-web    React + Vite + Tailwind — admin realm (dark)
  /brand-web    React + Vite + Tailwind — brand realm (light/dark, supabase-js for auth)
/packages
  /db           Prisma schema (public only) + generated client + migrations
  /shared       shared types, NormalizedEvent enum, role-gate matrix, adapter interfaces
  /payments     PaymentsAdapter + StripeAdapter + HighRiskAcquirerAdapter (the ONLY place Stripe is imported)
  /email        EmailAdapter + ConsoleEmailAdapter (admin/non-auth mail)
/supabase       config.toml, migrations (incl. custom_access_token_hook + audit append-only trigger + RLS policies)
```

---

## First steps for the agent

1. Read all five planning docs; treat them as authoritative and build **only** the Phase 0 slice above.
2. **Provision Supabase + connect Prisma** per "Supabase platform notes": create the `bypassrls` Prisma role, set `DATABASE_URL`/`DIRECT_URL`, scaffold the monorepo + Prisma schema (`public` only) + first migration, and disable PostgREST if API-only.
3. Land the **security spine first, with its tests**: brand auth on Supabase Auth + the access-token hook; admin auth kept separate (option a) with role-gate middleware; **RLS deny-by-default + brand tenant policies**; the **audit append-only trigger**. Get realm isolation, RLS cross-tenant, and append-audit tests green before anything sits on top.
4. Build **Catalog Manager** (CRUD + publish + stock + SKU-immutability guard + AuditLog on mutations).
5. Build **Admin Users & Roles + AuditLog viewer** (proves roles + audit end-to-end).
6. Build the **PaymentsAdapter + StripeAdapter + stub** + the webhook receiver (idempotent, no ledger).
7. Build the **brand shell + Account stub** (supabase-js auth) and the read-only catalog projection endpoint.
8. Run the full acceptance checklist.

Stop at the Phase 0 boundary. Surface any ambiguity or any place the docs conflict rather than guessing.

---

*Phase 0 of the RUOStack build, on a Supabase backend. Pairs with `ruostack_platform_architecture.md` (the architecture this implements) and the three docs it references. Build only this slice; leave honest seams for Phases 1–3.*
