# RUOStack — Platform Architecture Spec (Admin + Brand, Backend + Frontend)

*Fourth and final planning doc for the RUOStack white-label fulfillment platform. Scope: the architecture that the first three docs gesture at but never define — the **operator/admin platform**, the **role/auth/audit model**, the **complex stateful UIs**, the **resolved business rules**, and the **MVP boundaries**. This is the buildable architecture layer. It does not re-derive the fulfillment pipeline (see `ruostack_woocommerce_shipstation_plan.md`), the product/screen catalog (`pepify_build_spec.md` + `pepify_screen_teardown.html`), or the money/regulatory framing (`ruostack_payments_framework.md`) — it references them and fills the gaps around them.*

*Resolves Gaps 1–5 in order. Captured 2026-06-11.*

> **How to read this.** Each gap is resolved as: **entities** (schema additions), **backend** (services, endpoints, jobs), and **frontend** (screen catalog in the same `header → KPI cards → filter tabs → search → table/empty` skeleton the Pepify teardown documents). Where a decision was previously "to finalize," it is now **decided** with rationale, flagged `[DECIDED]`. Anything still genuinely open is flagged `[OPEN — needs counsel/ops]` so it doesn't masquerade as settled.

---

## 0. System actors (the complete, corrected model)

The Pepify spec's "Brand/User 1:1" was an artifact of a single-tenant capture. The real platform is **two-sided**: a brand-facing app and an operator-facing admin, sharing one backend and one fulfillment pipeline.

| Actor | Side | Auth realm | Notes |
|---|---|---|---|
| **Brand owner** | Brand app | `brand` realm | Primary brand account; billing owner. |
| **Brand staff** | Brand app | `brand` realm | Optional team member under a brand (Gap 3). |
| **Super Admin** | Admin | `admin` realm | Full access incl. role grants, financial config. |
| **Operations** | Admin | `admin` realm | Fulfillment queue, exceptions, catalog stock, claims. |
| **Support** | Admin | `admin` realm | Live chat, brand lookup, open claims on behalf of brands, read-mostly. |
| **Finance** | Admin | `admin` realm | Ledger, reconciliation, payouts/float, refunds-to-wallet, tax exports. |
| **End customer** | None | — | Never authenticates; a `Customer`/`Address` record only. |

**Two separate auth realms** (`brand` and `admin`) with **independent session scopes, separate login surfaces, and no shared credentials.** An admin is never "also a brand." This separation is a security boundary, not a convenience.

---

# GAP 1 — The Admin (Operator) Backend & Frontend

The single largest unaddressed surface. Defined here as a first-class product with its own theme, IA, entities, and screen catalog.

## 1.1 Admin entities

```
AdminUser
  id, email, password_hash, full_name, status (active/suspended)
  role (super_admin | operations | support | finance)
  last_login_at, mfa_enabled, created_by (AdminUser.id)

AuditLog                          ← referenced by §11 claims ("audit-logged") but never defined
  id, actor_type (admin|brand|system), actor_id
  action (enum, e.g. claim.resolved, sku.stock_changed, wallet.manual_adjustment,
          role.granted, brand.suspended, alias.created, refund.issued)
  target_type, target_id
  before (jsonb), after (jsonb), reason, ip, created_at
  ── append-only; never updated or deleted; every mutating admin action writes one

CatalogProduct (the admin-owned master; brand-facing Product is a projection)
  id, canonical_sku, compound, dose, unit, name, description_template
  wholesale_cost, suggested_retail, status (in_stock|soon|out_of_stock)
  weight, length, width, height, packaging_rule, category
  coa_id (nullable), images[], updated_by, updated_at

Announcement
  id, audience (all_brands | segment | single_brand), brand_id (nullable)
  type (announcement | restock | maintenance), title, body
  publish_at, expires_at, created_by, status (draft|scheduled|published)
```

`CatalogProduct` is the **source of truth** for the price sheet, the rate-engine weights/dims, the stock-push signal, and COA links. The brand-facing `Product` (Pepify spec §5) is a **read projection** of it. This removes the ambiguity about "who edits the 36 SKUs."

## 1.2 Admin backend services

| Service | Responsibility |
|---|---|
| **Admin Auth** | `admin`-realm login, MFA, session, role-gated middleware. Every route declares a required role. |
| **Catalog Admin** | CRUD on `CatalogProduct`; stock-status flips trigger the existing Woo stock-push (`ruostack_woocommerce_shipstation_plan.md` §3). SKU is immutable once published. |
| **Fulfillment Console** | Reads the order state machine; surfaces the pre-ship queue; triggers ShipStation v1 order-create / batch label actions via the existing adapter. Does **not** re-implement fulfillment — it's a control surface over it. |
| **Exceptions Service** | Aggregates `WebhookEvent` dead-letters + order exceptions (No-Match / Needs-Info / Awaiting-Funds) + reconciliation drift (shipped-but-not-captured) into one actionable queue. |
| **Claims Admin** | Drives the `Claim` state machine (§11 of fulfillment plan); files carrier claims; records reason-coded resolutions → `AuditLog`. |
| **Brand Admin** | Brand lookup, status (active/suspended), per-brand `BrandShippingConfig`, manual wallet adjustments (Finance only, audited). |
| **Announcements** | Authors/schedules the broadcasts that become brand `Notification`s. |
| **Reconciliation Surface** | The *actionable* face of the existing reconciliation worker — not a new job, a UI+endpoints over its output. |

**Role gate matrix** (enforced server-side, not just hidden in UI):

| Surface | super_admin | operations | support | finance |
|---|---|---|---|---|
| Catalog edit | ✓ | ✓ | view | view |
| Fulfillment queue | ✓ | ✓ | view | — |
| Exceptions | ✓ | ✓ | view | view |
| Claims resolve | ✓ | ✓ | open-only | view |
| Brand suspend | ✓ | — | — | — |
| Wallet manual adjust | ✓ | — | — | ✓ |
| Role grants | ✓ | — | — | — |
| Ledger / reconciliation | ✓ | view | — | ✓ |

## 1.3 Admin frontend — screen catalog

Reuses the Pepify **dark-theme** design system and the universal skeleton (`header → KPIs → filter tabs w/ counts → search → table/empty`). Distinct admin chrome (RUOStack reversed logo on navy, a role badge in the top bar) so an operator never confuses it with a brand view.

| Screen | Purpose | Key components |
|---|---|---|
| **Admin Overview** | Platform health at a glance | KPIs: orders today, GMV, wallet float total, open exceptions, open claims, fallback-rate; webhook-health strip |
| **Catalog Manager** | The 36-SKU master | Table of `CatalogProduct`; row edit drawer (cost/retail/stock/weight/dims/packaging/COA); stock toggle fires Woo push; immutable-SKU guard |
| **Fulfillment Queue** | What's shippable / stuck pre-ship | Status tabs (ready / processing / exception); batch-select → create ShipStation orders / print labels; per-row drill to order |
| **Exceptions Console** | One queue for every blocker | Tabs: No-Match · Needs-Info · Awaiting-Funds · Webhook-DLQ · Recon-Drift; each row → resolve action (set alias, nudge brand, re-run capture) |
| **Store-Match Aliases** | Resolve unmatched products | Per-brand alias table; New/Managed/Drifted/Conflict states (fulfillment plan §3); Adopt/Skip/Re-alias actions |
| **Claims Queue** | Lost/damaged casework | States open → investigating → carrier_filed → resolved; SLA timer; evidence viewer; resolution = reship/credit/deny (reason-coded → AuditLog) |
| **Brand Manager** | Per-brand ops | Brand list + detail; subscription state, wallet balance/holds, shipping config, suspend toggle, impersonate-read (audited) |
| **Ledger & Reconciliation** | Finance surface | Wallet ledger across brands; deposit/hold/capture/refund views; drift report; float total; tax/period exports |
| **Announcements** | Author broadcasts | Compose drawer (audience, schedule); preview as it appears in brand Notifications inbox |
| **Admin Users & Roles** | super_admin only | AdminUser list, role grant/revoke, MFA enforcement, AuditLog viewer (filterable) |

---

# GAP 2 — Brand-Side Self-Service Boundaries

The brand app already exists in the Pepify teardown. These are the **undefined or dead-ending** flows, now resolved.

## 2.1 Subscription self-service `[DECIDED]`

Replace "manage/upgrade/cancel via support" with **Stripe Customer Portal**, deep-linked from the Account screen.

- **Backend:** `POST /billing/portal-session` → returns a Stripe Billing Portal URL (opens new tab, same pattern as wallet top-up). Cancel/update/payment-method all handled by Stripe; RUOStack reacts via the existing billing webhooks (fulfillment plan §9).
- **Frontend (Account → Subscription):** plan badge, renewal date, "Manage subscription" (→ portal), and a **suspension banner** state. When `invoice.payment_failed` dunning reaches suspend, the brand app renders a **Pro-suspended** interstitial gating fulfillment features, with a "Update payment" CTA → portal. This is the missing brand-facing face of payments-framework §9 dunning.

## 2.2 Provisioning & conflict UI (the genuinely hard one)

The fulfillment plan §3 specifies the *logic* (pre-flight New/Managed/Drifted/Conflict, Adopt/Skip/Re-alias, never auto-suffix). It has no *screen*. Resolved as a multi-step flow — fully designed in Gap 3 below since it's the most complex stateful UI.

## 2.3 Claims intake (brand side) `[DECIDED]`

- **Backend:** `POST /claims` (brand-scoped, against an order), `POST /claims/:id/evidence` (photo upload to object storage, returns keys stored on `Claim.photos[]`), `GET /claims` (brand's own).
- **Frontend (new brand screen: Claims):** standard skeleton. KPIs (open / resolved / credited). "Open a claim" → drawer: select order → claim type → evidence upload (photos for damage; tracking auto-pulled for lost) → submit. Status timeline view per claim. Eligibility windows enforced server-side and shown inline ("damage must be reported within 5 days of delivery").

## 2.4 BrandShippingConfig settings `[DECIDED]`

The entity exists (fulfillment plan §8) with no screen. **Decision: brand controls markup; operator controls pick-&-pack.**

- **Frontend (Shipping → Rate settings):** brand sets **optional per-order shipping markup** (their profit, default $0) and toggles which **enabled services** appear at their checkout (within the platform-allowed set). Pick-&-pack fee is **operator-only** (Brand Manager) and never shown to the brand as editable — it's RUOStack margin.

---

# GAP 3 — Auth, Account Model & the Complex Stateful UIs

## 3.1 Brand team support `[DECIDED — schema now, UI in Phase 2]`

Build the **schema** for multi-user now (cheap to include, expensive to retrofit); ship **single-user UI** in MVP.

```
Brand            id, brand_name, logo_url, website, sales_channel,
                 subscription_status, stripe_customer_id, member_since,
                 referral_code, referred_by
BrandMember      id, brand_id, user_id, role (owner | staff), invited_at, status
User             id, email, password_hash, full_name, mfa_enabled   ← realm: brand
```

`Brand` (the tenant) is now cleanly separated from `User` (a person). MVP creates exactly one `owner` `BrandMember` per brand; the invite-staff UI lands later without a migration. This directly corrects the Pepify "Brand/User 1:1."

## 3.2 Auth & audit `[DECIDED]`

- **Two realms** (`brand`, `admin`) with **independent session scopes, separate login surfaces, and no shared credentials.** A token from one realm cannot authenticate against the other.
- **MFA** required for all `admin` realm users; optional for brand.
- **AuditLog** (defined in §1.1) is written on every mutating admin action and every sensitive brand action (wallet top-up, alias change, claim open). Append-only. This is the entity §11 of the fulfillment plan assumed existed.

**Supabase realization of the two realms `[DECIDED]`.** The platform runs on a Supabase backend, whose Auth is a *single* user pool with one signing secret — so the realm boundary is expressed by **identity separation + claims + RLS**, not by two signing secrets:

- **Brand realm → Supabase Auth** (the main project's `auth.users`). This gives MFA, email confirmation/password-reset, and session management out of the box — the foundational auth surface not worth hand-rolling. A **Custom Access Token Hook** (a `public.custom_access_token_hook` Postgres function reading a server-owned roles table) injects a `realm: 'brand'` claim and the user's `brand_id`; brand-to-brand tenant isolation is enforced in **RLS** keyed on `auth.uid()` → `BrandMember` → `brand_id`.
- **Admin identity stays *out* of the customer pool** — the security boundary the spec cares about. Two acceptable shapes: (a) the hand-rolled admin JWT (separate `AdminUser` table, own signing secret, TOTP) the Phase 0 prompt specs; or (b) a **second Supabase project** used purely as the operator identity provider. Either way the admin backend connects to the **one shared (main-project) database** via the **service role**. Lean (a) for MVP simplicity.
- **RLS is the data-layer guardrail, not the primary authz.** The API connects via a privileged role (Prisma's `bypassrls` role / service role) that bypasses RLS and enforces authorization in app code; RLS is enabled **deny-by-default on every `public` table** as defense-in-depth so a bug or any future direct-client path can't leak across tenants.
- **Append-only AuditLog under a bypassing role** is enforced by a **`BEFORE UPDATE OR DELETE` trigger that raises** (robust even against the service role), with RLS as a second layer — since the privileged connection would otherwise sidestep an RLS-only rule.

*Build-level specifics (connection pooling, the auth hook SQL, Storage, footguns) live in `ruostack_phase0_build_prompt.md` → "Supabase platform notes."*

## 3.3 Complex stateful UI #1 — Product Provisioning & Conflict Resolution

The brand-facing realization of fulfillment-plan §3. A 4-step wizard, because the logic has branch states that can't collapse into one table.

```
Step 1 · Select        Catalog → checkbox products to add to store. Choose method:
                       API push (primary) or CSV export (fallback).
Step 2 · Pre-flight    Per product, backend classifies & shows a status chip:
                       ┌ New      → "Will create as draft"            [proceed]
                       ├ Managed  → "Already synced; fields updated"  [proceed]
                       ├ Drifted  → "SKU changed on your store"       [Restore SKU | Re-alias]
                       └ Conflict → "SKU exists, not created by us"   [Skip (default) | Adopt]
Step 3 · Confirm       Summary of actions; nothing written until this click.
                       (CSV path: download file + conflict-merge warnings instead.)
Step 4 · Result        Per-product outcome; drafts await brand publish in Woo.
```

- **Backend:** `POST /provisioning/preflight` (read-only classify), `POST /provisioning/commit` (idempotent on `woo_product_id`, writes `ProductProvisioning`), `GET /provisioning/status`. Never auto-suffixes a SKU; Adopt records the foreign SKU as a `ProductAlias`.
- **Frontend:** wizard with the four status chips as the core component; a persistent "managed products" table afterward showing drift flags over time.

## 3.4 Complex stateful UI #2 — Claims (brand intake + admin resolution)

Two faces of one `Claim` state machine:

```
Brand face:   open → (await triage) → resolved (reshipped|credited|denied)  + timeline
Admin face:   open → investigating → carrier_filed → resolved               + SLA timer + evidence + reason codes
```

Both read the same entity; the admin face adds the carrier-claim filing action and the reason-coded resolution that writes `AuditLog`. Designed in §1.3 (admin) and §2.3 (brand).

## 3.5 Complex stateful UI #3 — Exceptions triage

A unified operator queue over four heterogeneous sources (order blockers, webhook DLQ, recon drift, no-match). Each source type has a **type-specific resolve action** rather than a generic one — set-alias for No-Match, nudge-brand for Awaiting-Funds, re-run-capture for Recon-Drift, replay for Webhook-DLQ. Defined in §1.3 (Exceptions Console).

---

# GAP 4 — Money-Flow Architecture Gaps

## 4.1 Membership vs. wallet ledger separation `[DECIDED]`

Both run through one Stripe account but are **different money concerns**. Keep them in separate ledgers/state, never commingled:

```
SubscriptionState   brand_id, stripe_subscription_id, plan, price,
                    status (active|past_due|suspended|cancelled), current_period_end
                    ← driven only by Billing webhooks (invoice.paid / payment_failed / subscription.*)

WalletLedger        (existing) deposit | hold | hold_release | capture |
                    refund_credit | referral_credit | manual_adjustment
                    ← driven only by wallet/payment webhooks + fulfillment capture
```

A membership charge **never** touches `WalletLedger`; a wallet deposit **never** touches `SubscriptionState`. The Stripe webhook router (fulfillment plan §9) dispatches by event type to the correct ledger. This prevents a class of bug where a failed membership renewal corrupts available wallet balance.

## 4.2 Reconciliation as an actionable surface `[DECIDED]`

The worker (fulfillment plan §9) *detects* drift; the **Reconciliation Surface** (§1.3) is where Finance/Ops *acts*. Drift rows (e.g. shipped-but-not-captured) become Exceptions-console items with a **re-run-capture** action that is idempotent via `WebhookEvent (source, external_id)`.

## 4.3 Refund-to-wallet flow `[DECIDED]`

- **Trigger:** Finance role, from Brand Manager or Claims resolution (`credit`).
- **Backend:** `POST /admin/wallet/:brand_id/credit` → writes `refund_credit` ledger entry + `AuditLog`; never touches the card (refunds credit wallet only, per the closed-loop design that payments-framework §2 shows is also doing regulatory work).
- **Frontend:** confirm modal stating amount + reason code; ledger reflects it immediately.

---

# GAP 5 — Cross-Cutting Decisions (previously "to finalize")

## 5.1 Payments Adapter `[DECIDED — design]`

Mirror the ShipStation adapter pattern. One internal interface; RUOStack core never calls Stripe directly.

```
PaymentsAdapter (interface)
  createSubscription / cancelSubscription / updateSubscription
  createCheckout (wallet top-up)
  ingestWebhook (normalizes Stripe/high-risk-acquirer events → internal event types)
  issueRefundCredit / handleDispute
Implementations: StripeAdapter (today), HighRiskAcquirerAdapter (behind same interface)
```

Ledger and billing logic stay processor-agnostic. A forced migration (the likely failure mode per payments-framework §1) becomes a new adapter + reconnect flow, not a rewrite.

## 5.2 Claims business rules `[DECIDED — defaults; insurance OPEN]`

| Rule | Decision |
|---|---|
| Damage window | Report within **5 days** of delivery, photos required |
| Lost window | Open after **7 days** no tracking movement (configurable) |
| Auto-approve threshold | Claims **≤ $25** auto-approve to wallet credit; above → manual review |
| Fault matrix | Carrier-fault → reship at **platform** cost; brand-fault (bad address) → re-fulfill from **brand wallet**; customer-fault → deny |
| Insurance posture | `[OPEN — ops]` insure-by-default vs self-insure on cheap parcels; drives who absorbs loss. Decide before Claims Phase 3 build. |

## 5.3 Sales tax `[DECIDED — allocation & posture; RUOStack's own obligation OPEN]`

- **Retail sales tax = the brand's obligation. `[DECIDED]`** The brand is the **seller of record** for every peptide sale to an end customer; RUOStack never collects, holds, or remits retail tax. Confirmed in the brand agreement. RUOStack positions itself as a B2B fulfillment-software vendor, not a tax collector for its brands' retail — that part is a clean, settled decision.
- **Wallet top-up = stored value, *not* a taxable event at load** (taxed on use, if at all).
- **RUOStack's *own* membership + fulfillment services are a separate question, and it is *not* a policy choice — it's a function of state law. `[OPEN — SALT advisor]`** Whether RUOStack must collect tax on the **$97/mo membership** (and on fulfillment/service spend charged to the brand) turns on two things: (a) whether a given state treats **SaaS / the service as taxable**, and (b) whether RUOStack has crossed **economic nexus** there (post-*Wayfair* thresholds). A vendor **cannot** waive a collection obligation by declaring itself "a SaaS platform"; if RUOStack is obligated and doesn't collect, the unremitted tax — **plus penalties and interest — lands on RUOStack, not the brand.** "We do not collect" is therefore only safely true where one of the following actually holds:
    - the service is **non-taxable** in that state (SaaS is untaxed in many states), **or**
    - RUOStack has **no nexus** there yet, **or**
    - the brand has provided a valid **resale / exemption certificate** — B2B purchases consumed as an input to the brand's own taxable resale are often exempt, **but the exemption must be documented per brand**, not assumed.
- **Architectural footprint (small, build now):** add an optional `tax_exemption_certificate` to `Brand` (`state`, `certificate_ref`, `expires_at`, `status`); surface a flag for brands lacking one in any state where RUOStack's service is taxable. Stand up a lightweight **nexus monitor** — aggregate RUOStack-billed revenue by state — as a Finance report so a threshold is never crossed silently.
- **Gating:** the SALT pass (confirm RUOStack's service taxability + nexus footprint, and define the resale-certificate collection flow) happens **once the operating-state footprint is known.** It does **not** block MVP; it **does** gate scaling billing across many states. The schema fields and nexus report above are cheap to include in Phase 0 so the determination has somewhere to land later without a migration.

---

# Consolidated entity additions (this doc)

On top of all entities in the prior three docs:

```
AdminUser · AuditLog · CatalogProduct · Announcement          (Gap 1)
BrandMember · User (realm-scoped) · Brand (split from User)    (Gap 3)
SubscriptionState (split clean from WalletLedger)              (Gap 4)
PaymentsAdapter contract (architecture, not a table)           (Gap 5)
```

---

# Build sequence (architecture-complete)

**Phase 0 — foundations (build first, everything depends on it).**
Two-realm auth (brand + admin) · Brand/User/BrandMember split · AuditLog · AdminUser + role middleware · CatalogProduct master + Catalog Manager admin screen · PaymentsAdapter interface with StripeAdapter.

**Phase 1 — order pipe + admin control surface.**
Existing fulfillment Phase 1 (Woo connector, provisioning, SKU aliases, wallet reserve/capture, ShipStation v1/v2, writeback, $12.99 fallback) **plus** Fulfillment Queue + Exceptions Console + Store-Match Aliases admin screens. Brand provisioning wizard (Gap 3 UI #1). Membership/wallet ledger separation (Gap 4.1). Subscription self-service via Stripe Portal (Gap 2.1).

**Phase 2 — live rates + brand config + teams.**
Existing fulfillment Phase 2 (rate proxy, rules engine, boxes, service mapping) **plus** BrandShippingConfig settings UI (markup brand-side, pick-&-pack operator-side) · brand staff invite UI on the existing schema · Announcements admin.

**Phase 3 — claims, reconciliation, hardening.**
Existing fulfillment Phase 3 (stock push, dunning, claims engine) **plus** Claims Queue (admin) + Claims intake (brand) UIs · Reconciliation Surface + Ledger admin · refund-to-wallet flow · resolved claims rules (5.2). Resolve the two OPEN items (insurance posture, SALT pass) before this phase ships.

---

*Reflects the 2026-06-11 architecture session. Resolves Gaps 1–5 from the prior review. Decisions marked `[DECIDED]` are build-ready; items marked `[OPEN]` are business/legal determinations that gate specific later phases, not MVP. Pairs with `pepify_build_spec.md`, `pepify_screen_teardown.html`, `ruostack_woocommerce_shipstation_plan.md`, and `ruostack_payments_framework.md`.*
