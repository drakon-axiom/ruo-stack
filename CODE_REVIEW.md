# RUOStack — Code Review

*Full-repo review for correctness, security, performance, and architectural integrity.
Covers the API security spine, the service/money layer, the DB/RLS/migration layer, both
React frontends, the shared packages, the WooCommerce plugin, and the deploy/CI config.*

Baseline health at time of review: `pnpm typecheck` clean across all 7 packages; 146 offline
unit tests pass (71 DB-integration tests self-skip without a live Postgres — expected). The
payments-isolation invariant holds (zero Stripe imports outside `packages/payments`), the
service-role key never appears in either frontend, and there is no `dangerouslySetInnerHTML`
anywhere.

---

## Overall assessment

This is a well-architected codebase, clearly above the norm for its stage. The two-realm
security boundary is real and correctly built (admin and brand identities use different signing
keys and mutually-exclusive realm assertions — a token from one pool provably cannot satisfy the
other's guard); authorization is enforced server-side through two small guard helpers with
live-role-re-read discipline; money is integer cents end-to-end with no float arithmetic; the
wallet ledger primitive is genuinely careful (per-brand advisory lock + unique idempotency key +
non-negative invariant); webhook signature verification and inbound idempotency are textbook; and
the repo is honest about its own deferred work (`POLISH_TODO.md`) and past mistakes (migration
019→021).

The weaknesses are systemic and cluster in three places, none of which is "bad math":

1. **Everything *around* the wallet primitive uses unguarded read-compute-write.** Order
   creation, edits, imports, and claim resolution check state and then mutate without row locks,
   conditional updates, or DB uniqueness backstops — so most defects are concurrency/blocker-state
   holes, not arithmetic errors.
2. **The RLS/audit layer's guarantees are overstated.** As defense-in-depth it is mostly sound,
   but the audit log is world-readable and world-insertable by its own policies, and `TRUNCATE`
   walks straight past the "append-only" trigger. The primary control (API-only access with
   PostgREST disabled) still holds, so these are second-layer gaps rather than live breaches — but
   the code comments claim a stronger property than the SQL delivers.
3. **External-semantics edges the abstractions don't cover.** Stripe's async-payment lifecycle
   (wallet credited before settlement), Stripe's subscription-item update semantics, the
   nginx/Fastify proxy-trust interaction, and `add_header` inheritance all silently defeat controls
   the code believes it has.

Frontend error handling is the other cross-cutting gap: most reads have no `.catch`, so the apps
degrade to permanent spinners or false "empty" states on any failure.

**Architectural integrity vs. the plan.** The repo has grown well past the documented "Phase 0"
slice — the full WooCommerce/ShipStation pipeline, wallet reserve/capture, claims, dunning,
reconciliation, and provisioning are all present (this is acknowledged in `POLISH_TODO.md`). The
Phase-0 invariants are all still intact: payments isolation (CI-guarded), realm isolation
(tested), append-only audit intent, catalog mastership + SKU immutability, secrets-via-env,
server-side authz. The processor seam and the store-connector seam are clean and the "implicit
wallet hold" derivation is documented rather than faked. Integrity is good; the debt is in
hardening the seams that later phases bolted on, not in the foundation.

---

## Fix first (highest severity, verified)

These are the issues that can ship the wrong product, lose money, or corrupt the record. Each was
read and confirmed in source.

| # | Area | Issue | Location |
|---|------|-------|----------|
| 1 | Fulfillment | Blocked orders (`needs_address` / `needs_mapping`) export to ShipStation as fulfillable "paid" orders → warehouse ships incomplete/unaddressable parcels and captures the wallet | `packages/shared/src/orders.ts:63`, `apps/api/src/routes/shipstation-custom-store.ts:74,92` |
| 2 | Payments | Wallet credited on `checkout.session.completed` with no `payment_status === 'paid'` check; async-payment failures map to `unknown` and are dropped → ACH/delayed top-up that later bounces keeps the credit | `packages/payments/src/stripe-adapter.ts:155`, `apps/api/src/routes/webhook.ts:117` |
| 3 | Concurrency | Duplicate Woo order import: idempotency is a `findFirst` check-then-create with **no** unique constraint on `(brandId, source, externalOrderId)`; `order.created` + `order.updated` arrive with distinct webhook ids and both pass → two orders, double reservation, double shipment | `apps/api/src/services/store-intake.ts:76`, `packages/db/prisma/schema.prisma` (Order model), `apps/api/src/routes/woo-webhook.ts:54` |
| 4 | Frontend | Store Match "Map" defaults to `catalog[0]` when nothing is selected (button stays enabled) → wrong product aliased, and the server **auto-releases** the blocked order → wrong physical item ships | `apps/admin-web/src/screens/StoreMatch.tsx:50,94`, `apps/api/src/routes/admin-aliases.ts:81` |
| 5 | Payments | `updateSubscription` passes `items: [{ price }]` with no item `id`, which *adds* a second Stripe subscription item instead of replacing it → Pro→Volume change bills both plans every cycle. Latent (no caller today) but it's the shared seam contract | `packages/payments/src/stripe-adapter.ts:62` |
| 6 | Claims | Claim resolution reads `status` outside the transaction and the reship `order.create` is non-idempotent and runs before the resolve commits → two concurrent resolves, or a retry after partial failure, double-ship | `apps/api/src/services/claims.ts:22,42,74` |
| 7 | Infra | `trustProxy: true` (trust-all) + nginx appending `X-Forwarded-For` makes `req.ip` client-spoofable → per-IP login/MFA rate limits are bypassable (rotate the header per request) and the append-only audit log records attacker-chosen IPs | `apps/api/src/app.ts:40`, `deploy/nginx/ruostack.conf:58` |

---

## Security

### Authenticated SSRF via brand-supplied `store_url` — MEDIUM
`store_url` is validated only as `z.string().url()` (`brand-store.ts:23`), then `wooRequest`
issues a server-side `fetch()` to it with no host allowlist and no private/link-local block
(`services/woo.ts:44`). Redirects follow by default. Worse, the upstream error body is reflected
to the client (`woo.ts:51` → `brand-store.ts:85`, `e.message.slice(0,160)`), giving partial
read-back. A Pro/Volume brand can point `store_url` at `http://169.254.169.254/…` or an internal
host and read responses. **Fix:** resolve the host and reject private/loopback/link-local ranges
before fetch; disable redirect-following; strip upstream bodies from client-facing errors.

### Proxy-trust makes `req.ip` spoofable — MEDIUM→HIGH (see Fix-first #7)
`trustProxy: true` trusts the leftmost XFF entry. Set it to the proxy hop count (`trustProxy: 1`)
or have nginx *overwrite* rather than append XFF (`proxy_set_header X-Forwarded-For $remote_addr`).
This is the single change that restores both the login rate-limit and audit-log IP integrity.

### TOTP codes are replayable — LOW/MEDIUM
`authenticator.options = { window: 1 }` (`admin-auth.ts:18`) accepts a ~90s window and
`authenticator.check()` is stateless — no last-consumed-step is recorded, and there is no
per-account MFA attempt counter (only the per-IP limit, itself bypassable per #7). A code observed
once (phishing proxy, shoulder-surf, logged request) is reusable for the window. **Fix:** persist
the last-accepted step per admin and reject reuse.

### Login user-enumeration via bcrypt timing — LOW
`const okPassword = admin ? await verifyPassword(...) : false` (`admin-auth.ts:82`) runs the slow
bcrypt compare only when the email exists; a non-existent email returns measurably faster,
defeating the uniform "Invalid credentials". **Fix:** always run a dummy compare against a fixed
hash when `admin` is null.

### Password-only takeover of never-enrolled admins — LOW
Before first login, a correct password alone yields an enrollment token and lets the caller set
the TOTP secret (`admin-auth.ts:86,107`). Combined with the guessable seed default
`SEED_SUPERADMIN_PASSWORD="change-me-on-first-login"` (`.env.example`) on a publicly reachable
admin host, whoever logs in first *becomes* the super_admin. **Fix:** force a password change on
first login and/or require a strong, rotated seed secret; rate-limit `/mfa/enroll`.

### Confirmed sound (checked, not defects)
Admin JWT pins `alg:['HS256']`, asserts `realm==='admin'`, and re-reads the live role from DB;
brand token uses JWKS asymmetric verify with `audience:'authenticated'` and realm/brand_id come
from the server-owned access-token hook, not user metadata; AES-256-GCM with per-encryption random
IV; bcrypt cost 12; all webhook verifiers use constant-time compares over the raw body with
idempotency keys; every brand route scopes by `req.brand!.brandId`; no mass-assignment (Zod → explicit columns).

---

## Payments & money

- **No idempotency keys on outbound Stripe mutations** (`stripe-adapter.ts:35,46,73,90,135`) —
  MEDIUM. A network timeout + application retry of `issueRefundCredit` refunds the card twice;
  inbound `externalId` dedupe does not cover outbound calls. Pass `{ idempotencyKey }`.
- **Failure events mislabeled** (`stripe-adapter.ts:169`) — MEDIUM. Every
  `payment_intent.payment_failed` (including subscription invoices) normalizes to
  `wallet.topup_failed`, and `createCheckout` sets metadata on the session but not
  `payment_intent_data`, so `pi.metadata.brand_id` is always undefined. Harmless today (dropped by
  dispatch) but persisted with the wrong type, poisoning future dunning/reconciliation.
- **No `apiVersion` pin** (`stripe-adapter.ts:30`) — LOW. With `"stripe": "^17.4.0"`, SDK upgrades
  silently shift the wire version; the defensive `current_period_end` read is already a symptom.
- **`currency` carried but never checked** before crediting (`webhook.ts:117`) — LOW. A non-USD
  session would credit foreign minor units 1:1 as USD cents.
- **`WalletAdjustSchema.amount_cents` is unbounded** (`packages/shared/src/money.ts:40`) —
  MEDIUM-LOW. Every other money schema is bounded; the finance manual-adjust accepts ±2^53 in one
  audited-but-irreversible write.

Verified good: signature verification, inbound idempotency (unique `(source, externalId)` +
`processed` short-circuit + ledger dedupe), and integer-cents throughout.

---

## Service-layer correctness & concurrency

Beyond Fix-first #1/#3/#6:

- **Funds-reservation race** (`brand-orders.ts:95`, `order-edit.ts:85`, `store-intake.ts:152`) —
  MEDIUM. `getWalletSummary` runs outside the write transaction; two concurrent orders both see
  sufficient balance → the second throws at capture → shipped-but-uncaptured drift.
- **shipnotify negative-balance capture throws** instead of degrading
  (`shipstation-custom-store.ts:159`) — MEDIUM. Contradicts the "ship anyway, flag awaiting_funds"
  comment; the label is bought but the order sticks `ready_for_fulfillment` forever, invisible to
  the drift scan. Wrap capture in try/catch and fall back to `awaiting_funds`.
- **Order edit silently clears `needs_address`/`needs_mapping`** (`order-edit.ts:87`) — MEDIUM.
  Only funds are re-checked; a qty change on an unmatched order flips blocker to `none` and it
  ships missing items.
- **Order status transitions are unconditional updates** (`brand-orders.ts:231`,
  `admin-fulfillment.ts:150`) — MEDIUM. shipped↔cancelled can race (money captured, status
  cancelled, or vice versa). Use `updateMany` with a `status` guard or row locks.
- **Flat-fallback quote overcharges by pick-&-pack** (`services/rate-quote.ts:41`, `shared/rates.ts:83`) —
  MEDIUM. The flat option is all-in ($12.99), but the quote persists `carrierCostCents:1299` *plus*
  `pickpackCents`, and `findRateQuote` sums them — same service, two prices depending on path.
- **Rate cache ignores dimensions, buckets weight to 8 oz** (`services/rate-cache.ts:21`) — MEDIUM.
  A 9 oz and a 16 oz parcel to the same ZIP share a bucket and get the first's rates.
- **Disabled store connection still imports & is force-reactivated** (`woo-webhook.ts:29`,
  `store-intake.ts:198`) — MEDIUM. A disabled/errored connection imports on webhook and silently
  flips back to `active`, clearing the recorded error.
- **No timeout on any external HTTP call** (`woo.ts:44`, `rates/shipstation*.ts`) — MEDIUM. A hung
  ShipStation stalls the checkout rate proxy and the admin stock toggle (2 sequential Woo calls per
  SKU per store, awaited inline). Add `AbortSignal.timeout`.
- **ShipStation v2 carrier-id cache never hits** (`rates/index.ts:37`) — MEDIUM (perf). The adapter
  is rebuilt per call, so every uncached quote does 2 sequential round-trips on the checkout path.
  Hoist the adapter/carrier-id cache.
- LOW: dunning notice lost on email failure but `dunningNotifiedAt` stamped (`dunning.ts:50`);
  sweep-vs-recovery race sets `expired` over a fresh `active` (`dunning.ts:60`, `subscription.ts:150`);
  `$0` deposit booked on unmapped amount (`webhook.ts:121`); `NaN` shipping cost bricks a shipnotify
  after capture (`shipstation-custom-store.ts:139`); filtered ledger summaries don't reconcile
  (`admin-ledger.ts:99`); unbounded brand order list (`brand-orders.ts:189`); Starter monthly cap is
  advisory and bypassed entirely by store imports (`brand-orders.ts:49`); silent service
  substitution to `priced[0]` (`shipping.ts:80`); drift scan horizon capped at newest 500
  (`reconciliation.ts:75`).

---

## Database, RLS & migrations

All findings here are **defense-in-depth** — the primary control is the API-only path with
PostgREST disabled. They matter because the code comments claim stronger guarantees than the SQL
provides, and because the `GRANT ALL` posture means RLS is the *only* backstop if any policy slips.

- **Audit log is world-readable** (`migrations/…0001/migration.sql:110`) — HIGH (2nd-layer). The
  only SELECT policy is `USING (true)` for `authenticated` — every other brand table is
  tenant-scoped; this one uniquely opens. If PostgREST is ever enabled or a supabase-js data path
  ships, any brand user reads every tenant's audit trail (which carries `before`/`after` order and
  wallet snapshots). Scope it to admin/service_role, or drop the policy (writes go via the bypass
  role anyway).
- **`TRUNCATE` defeats the append-only trigger** (`…0001:102`, `bootstrap_prisma_role.sql:39`) —
  HIGH (2nd-layer). The guard is `BEFORE UPDATE OR DELETE … FOR EACH ROW`; `TRUNCATE` fires no row
  trigger and is exempt from RLS, and `GRANT ALL` hands TRUNCATE to `prisma`/`service_role`/
  `authenticated`/`anon`. The "holds even against the service role" claim is false. Add a
  `BEFORE TRUNCATE … FOR EACH STATEMENT` trigger and `REVOKE TRUNCATE`.
- **Audit rows are world-insertable** (`…0001:107`, `WITH CHECK (true)`) — MEDIUM. A direct-path
  client could forge `actor_type='admin'` rows. Constrain or remove the INSERT policy.
- **Bootstrap grants are far broader than least-privilege** (`bootstrap_prisma_role.sql:31,39`) —
  MEDIUM. `anon`/`authenticated` get ALL on every table including `admin_user` (password hashes,
  encrypted MFA secrets) and `brand_store_connection` (encrypted creds), with only RLS between.
  Grant `SELECT` on brand-facing tables only; drop the unneeded `CREATEDB` on the runtime role.
- **FORCE ROW LEVEL SECURITY omitted on the credential tables** (`…0001:26`) — MEDIUM. The FORCE
  list skips `admin_user`, `admin_session`, `admin_password_reset_token`, `webhook_event` — exactly
  the sensitive ones — while every later migration applies FORCE uniformly.
- **`brand.stripe_customer_id` has no unique/index** (`…0000/migration.sql:58`) — MEDIUM. Every
  billing webhook resolves the tenant via `findFirst` on an unindexed, non-unique column: seq scan
  as tenants grow, and two brands sharing a customer id silently misattribute events. Make it
  `@unique`.
- **`archived` is not enforced on brand-facing paths** (`…0024` vs `…0001:76`) — MEDIUM. Archiving
  sets `archived:true` but not `is_published:false`, and the RLS projection + several services
  (`shipping-rates.ts:47`, `sku-resolver.ts:38`, `order-edit.ts:47`) filter on `isPublished` only,
  so a pulled-from-market product is still rateable and sellable.
- LOW: missing FK indexes on hot paths (`order_item.product_id`, `claim.order_id`, `order.box_id`);
  unconstrained UUIDs with no FK (`rate_quote.brand_id`/`box_id`, `claim.reship_order_id`); the
  public `brand-logos` bucket pattern is earmarked for reuse by claims-evidence photos (PII) and
  has no DELETE policy; the access-token hook pins multi-brand users to their oldest brand
  (`…0020:21`, `ORDER BY created_at ASC LIMIT 1`) — fine today (one brand per user), a latent bug
  once staff invites ship.

Verified good: all 27 tables have RLS enabled; the `brand_address` gap from 019 *is* closed by 021;
integer-cents money only; wallet advisory lock + unique idempotency; one-subscription-per-brand,
SKU uniqueness, and provisioning idempotency uniques all present; correct enum-lifecycle migrations
(025 adds value, 026 backfills); no schema/migration drift on spot-checked models; the hook is
parameterized plpgsql with EXECUTE revoked from authenticated/anon and fail-closed on no-match.

---

## Frontends (admin-web & brand-web)

Beyond Fix-first #4:

- **Refresh-token rotation race** (`admin-web/src/lib/api.ts:30`) — HIGH. No single-flight around
  `refresh()`, but the server rotates+revokes on every refresh (`admin-auth.ts:153`). Parallel 401s
  (any screen doing `Promise.all`) fire two refreshes with the same token; the loser is revoked and
  the failure is silent — no token clear, no redirect to `/login`. Add a single-flight refresh
  mutex and redirect-on-failure.
- **Swallowed fetch errors → permanent spinners / false empty states** — HIGH (systemic). Most
  reads have no `.catch` and no error state across ~14 screens; `admin-web/.../Claims.tsx:52` has no
  loading state at all and renders "No claims" while loading or after a failure — an operator reads
  it as an empty queue. Introduce a shared fetch hook with loading/error state.
- **Brand-supplied claim photo URLs rendered as clickable admin links with no scheme allowlist**
  (`brand-web/.../Claims.tsx:78` → `admin-web/.../Claims.tsx:135`) — MEDIUM. Zod `.url()` accepts
  `javascript:`/`data:`; `target="_blank"` blunts execution but this is a cross-tenant
  link-injection channel into evidence an operator is told to click. Restrict to `http(s)`/known host.
- **Ledger truncates to 200, Audit Log to 50, both ignore the server cursor** (`Ledger.tsx:113`,
  `AuditLog.tsx:23`) — MEDIUM. Finance reconciles against a partial ledger; the audit filter matches
  `action` by exact equality while the placeholder invites partial text, yielding false "no entries."
  Honor `next_before_seq`/`next_cursor`.
- MEDIUM: stale `service_code` submitted while a different price is displayed + unthrottled quote
  calls (`Orders.tsx:237`); catalog retail save leaves the input disabled forever on failure
  (`Catalog.tsx:36`); optimistic stock/deliver/role writes with no rollback or feedback
  (`Catalog.tsx:298`, `Fulfillment.tsx:67`); edit drawer can never *clear* weight/packaging/COA
  (`Catalog.tsx:226` → server skips `undefined`); `coaId` is free text but rendered as an href
  (`Coas.tsx:70`); tokens (incl. refresh) in localStorage — accepted risk, but total blast radius on
  any future XSS.
- LOW: negative amounts render `$-25.00` on Brands (`Brands.tsx:212`); `Add $NaN` on garbage wallet
  input; announcement "publish now" can create duplicate drafts on partial failure; tracking numbers
  interpolated into carrier URLs without `encodeURIComponent`.

Verified good: no raw-HTML rendering anywhere; all role gating is display-only and mirrored by
server guards; the brand app never sends a client-derived `brand_id`; money is cents end-to-end.

---

## Packages, integrations, deploy & CI

- **`ROLE_GATE` annotated `Record<string, …>`** (`shared/src/roles.ts:13`) — LOW. Collapses
  `Surface` to `string`, so `requireAdmin('typo')` compiles and fail-closes *everyone* on that route
  at runtime (silent outage). Use `satisfies` so `Surface` stays a real union.
- **`canBrandAccess` fails open for staff** (`shared/src/brand-roles.ts:62`) — LOW. `return !OWNER_ONLY.includes(surface)` grants any new surface to staff by default — the opposite of the admin
  matrix's fail-closed default, on the money/access side. Default-deny and enumerate staff-allowed.
- **WooCommerce plugin**: webhook secret stored plaintext in `wp_options` and reused as the
  rates-API auth key (`ruostack-shipping.php:48`) — MEDIUM-LOW; attacker-configurable `api_base`
  lets a `manage_woocommerce` user exfiltrate the key + customer destinations (`:46,83`) — LOW; API
  response fields flow unsanitized into checkout rate labels (`:99`) — LOW.
- **nginx**: `add_header` inheritance cancels the admin portal's security headers on the exact
  `/index.html` and `/assets/` responses that need them (`ruostack.conf:104` vs `120`) — MEDIUM;
  the brand portal has no security headers at all and there's no HSTS anywhere (`:37`) — MEDIUM. Add
  the headers inside each `location` (nginx does not inherit `add_header` into a block that sets its
  own).
- **API binds `0.0.0.0` by default** (`.env.example:79`) — MEDIUM-LOW. `:3901` is directly reachable
  unless the operator applies the README override, bypassing every nginx control.
- **CI has no `permissions:` block** (`.github/workflows/ci.yml`) — MEDIUM-LOW. `GITHUB_TOKEN` gets
  the repo default (possibly write-all); a compromised transitive dep during `pnpm install` could use
  it. Add `permissions: contents: read`. Actions are pinned by mutable `@v4` tag rather than SHA — LOW.
- **Stripe-import guard prefix collision** (`scripts/check-stripe-imports.mjs:11,34`) — MEDIUM-LOW.
  `file.startsWith(ALLOWED_DIR)` with no trailing separator would silently allow a future
  `packages/payments-v2/…` to import Stripe. Also misses subpath (`from 'stripe/…'`), multiline, and
  bare `import 'stripe'`. Compare against `ALLOWED_DIR + sep`.
- LOW: operator price schemas in `dto.ts` are unbounded (inconsistent with `BrandRetailSchema`'s max).

Verified good: the processor seam is real and the import guard does catch the common single-line
cases; the Woo plugin registers no REST/ajax endpoints (settings go through Woo core's nonce +
`manage_woocommerce` path); nginx request-size limits and route exposure are otherwise fine; CI
caches only the pnpm store and uses throwaway DB creds.

---

## Suggested sequence

1. **Fail-closed the fulfillment path** (#1, #3): unique constraint on
   `(brandId, source, externalOrderId)`, and exclude `needs_*` blockers from the ShipStation export
   / map them to `on_hold`. Highest real-world payoff.
2. **The wrong-product frontend bug** (#4): require an explicit selection before enabling Map.
3. **Payment settlement** (#2, #5): guard on `payment_status === 'paid'`, handle
   `async_payment_succeeded/failed`, and fix the subscription-item replacement before billing goes
   live.
4. **Proxy trust** (#7): one-line `trustProxy` scope change restores rate-limits and audit IPs.
5. **Concurrency hardening**: conditional status updates + row locks across order/claim mutations
   (#6 and the MEDIUMs).
6. **RLS/audit hardening**: TRUNCATE trigger, tenant-scope the audit SELECT/INSERT, tighten bootstrap
   grants — cheap SQL that makes the comments' claims true.
7. **Frontend resilience**: shared fetch hook (loading/error), single-flight refresh with
   redirect-on-failure, honor pagination cursors.
