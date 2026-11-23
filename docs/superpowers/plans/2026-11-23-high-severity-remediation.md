# High-Severity Security and Financial Integrity Remediation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. This document authorizes no deployment or production data changes.

**Goal:** Close the five high findings from the repository review: exposed recovery links, reusable MFA enrollment, SSRF bypasses, non-atomic claim credits, and unlocked reship reservations.

**Architecture:** Deliver four independently reviewable changes: member invitation security, admin MFA enrollment state, connection-bound outbound validation, and transactional claim resolution. Findings 4 and 5 share the wallet/claim transaction boundary and should ship together. Preserve existing tenant guards, ledger idempotency, and API response contracts except where insecure behavior must be rejected.

**Tech Stack:** TypeScript, Fastify, Prisma/PostgreSQL, Supabase Auth, React, Vitest.

**Spec:** The user's request to address the five high findings in the preceding codebase review. The requirements and acceptance cases are captured below; no separate design document exists.

## Global Constraints

- Implement only the five high findings; medium findings remain a separate backlog.
- No production database tests, migrations, network probes, or financial corrections during development. Use an explicitly configured disposable database and mocked external services.
- Retain the ten-minute admin enrollment lifetime, encrypted MFA secrets, and live account-status checks.
- Preserve per-brand wallet serialization using the existing advisory-lock key.
- Do not return or log authentication links, credentials, MFA secrets, or tokens outside their intended enrollment/invitation response.
- Follow the existing Prisma migration workflow for any schema addition; generate and inspect the migration against a disposable development database.

## Review Focus

- A confirmed member who never signed in must not qualify for an invitation reissue (Task 1).
- Enrollment replay and concurrent verification must not replace an active factor or mint multiple sessions (Task 2).
- DNS rebinding, mixed public/private answers, redirects, and equivalent IPv6 encodings must fail closed (Task 3).
- Competing credit amounts or credit-versus-denial/reship must yield one consistent claim outcome (Task 4).
- Reships and normal orders competing for the same balance must not both reserve unavailable funds (Task 4).

## Task 1: Remove account-recovery links from team management

**Files:** Modify `apps/api/src/routes/brand-members.ts`, `apps/brand-web/src/screens/Team.tsx`; create `apps/api/test/unit/member-invite-security.test.ts`.

**Interface:** Keep `POST /api/brand/members/:userId/invite-link` for active, unconfirmed invitees only. Return 409 `invite_not_pending` for established accounts. Never fall back to `type: 'recovery'`. Keep initial invitations unchanged unless tests uncover a related path.

- [ ] Write route tests using mocked Supabase and database clients. Assert confirmed users, users with a previous sign-in, suspended members, and users outside the brand cannot receive a link. Assert Supabase lookup errors fail closed and `generateLink` is never called with `recovery`.
- [ ] Run `NODE_ENV=test RUN_DB_TESTS=0 pnpm --filter @ruostack/api exec vitest run test/unit/member-invite-security.test.ts`; confirm the current code fails the established-account case.
- [ ] Require an active in-brand membership plus successful Auth lookup showing neither confirmation nor prior sign-in before generating an invite. Remove the recovery fallback. On invite failure, return a sanitized error rather than a different authentication capability.
- [ ] Align the API's pending-invitation projection and Team UI action with confirmation/sign-in status. A lookup failure is not evidence that an invitation is pending. Direct established members to the existing self-service forgot-password flow; do not add an owner-mediated recovery endpoint.
- [ ] Rerun the tests and manually verify pending-invite and established-member UI states with fixtures. Commit this change independently.

**Acceptance:** Team administration cannot mint recovery credentials for another established identity. Ordinary first-time invitations still work. Verify deployed Auth invite semantics in a staging tenant before release, without using real member accounts.

## Task 2: Make admin MFA enrollment an atomic, single-use operation

**Files:** Modify `apps/api/src/routes/admin-auth.ts`, `packages/db/prisma/schema.prisma`; add the generated Prisma migration; create `apps/api/test/unit/admin-mfa-enrollment.test.ts` and `apps/api/test/integration/admin-mfa-enrollment.test.ts`.

**State:** Add nullable fields on AdminUser for enrollment-token hash, enrollment expiry, and encrypted pending MFA secret. Keep the enabled MFA secret separate. The JWT includes a random enrollment identifier whose hash is stored server-side. A new password-verified enrollment attempt replaces the pending identifier, invalidating earlier attempts. Legacy stateless enrollment JWTs are rejected.

**Interface:** Keep existing login/enroll/verify response shapes. Refactor session creation so verification can create the session inside its transaction; preserve ordinary login behavior.

- [ ] Write tests: completed enrollment token replay cannot alter the factor; inactive admins cannot enroll/verify; expired, superseded, and legacy tokens are rejected; two concurrent verifications yield exactly one session; failed verification does not consume a valid attempt; a transaction failure leaves neither enabled MFA nor a session.
- [ ] Run offline tests to confirm the replay test fails on the current implementation.
- [ ] Add nullable schema fields and generate the additive migration in the disposable database. Do not modify existing enabled secrets.
- [ ] On password-verified login for an unenrolled active admin, persist the identifier hash and ten-minute expiry. On enroll, validate pending state under an admin-row lock and initialize the pending secret. Repeated enroll calls for the same pending attempt reuse it rather than rotating it.
- [ ] On verify, lock the same admin row; recheck active status, disabled MFA, identifier, and expiry; validate TOTP; atomically promote the pending secret, enable MFA, consume pending state, and create the session. Return tokens only after commit.
- [ ] Run unit tests and concurrent integration tests against the disposable database, plus existing admin authentication tests. Commit independently.

**Acceptance:** Only one successful completion is possible per enrollment attempt. Old tokens cannot reset an enabled factor. In-flight enrollment users restart login after rollout; existing enrolled admins retain their factors.

## Task 3: Bind SSRF validation to the outbound connection

**Files:** Modify `apps/api/src/services/ssrf-guard.ts`, `apps/api/src/services/woo.ts`, `apps/api/package.json`, `pnpm-lock.yaml`; create `apps/api/src/services/public-http.ts`, `apps/api/test/unit/public-http.test.ts`; extend `apps/api/test/unit/ssrf-guard.test.ts`.

**Interface:** Introduce `publicFetch(url: URL, init: RequestInit): Promise<Response>` for Woo requests. It owns a configured HTTP transport whose connection lookup validates all DNS answers and supplies only approved addresses to the socket. Use explicitly declared transport/IP-parser dependencies, with versions selected against the repository's supported Node runtime during implementation.

- [ ] Add address tests for hexadecimal IPv4-mapped IPv6, expanded/compressed loopback, the full link-local prefix, unique-local addresses, private IPv4, and mixed public/private DNS responses. Assert `::ffff:7f00:1` and `fe90::1` are blocked.
- [ ] Add transport tests with an injected resolver/connector: a resolver changing from public to private must never cause an internal connection; redirects are not followed; validation covers reconnects; timeouts include DNS resolution. Use fakes, not probes against metadata or internal services.
- [ ] Run tests and verify current guard failures.
- [ ] Replace string-prefix classification with normalized address/CIDR checks. Preserve original hostname for TLS certificate verification, SNI, and Host; do not implement pinning by replacing the hostname in the URL. Reject embedded URL credentials. Validate the fully constructed Woo URL.
- [ ] Route Woo calls through the connection-validating transport; preserve manual redirects and the existing 15-second request timeout. Close transport resources appropriately, and ensure any pooled connection was established through the validated path.
- [ ] Run unit tests plus mocked Woo success, HTTP-error, timeout, and redirect tests. In staging, verify legitimate store connections still work. Commit independently.

**Acceptance:** No socket can connect to a denied address through a user-supplied store hostname, including address changes between requests. HTTPS identity checks remain enabled. A separate preflight DNS check alone does not satisfy this task.

## Task 4: Make claim outcomes and wallet reservations transactional

**Files:** Modify `apps/api/src/services/wallet.ts`, `apps/api/src/services/claims.ts`; extend `apps/api/test/integration/claim-resolve.test.ts` and `apps/api/test/integration/wallet.test.ts`.

**Interfaces:** Add `appendEntryTx(tx: Prisma.TransactionClient, input: AppendEntryInput): Promise<{ entry: WalletLedger; duplicate: boolean }>` containing the locked ledger append. Preserve `appendEntry(db, input)` as a transaction-owning wrapper. Reuse `lockBrandWallet(tx, brandId)` and `getWalletSummary(tx, brandId)` for charged reships. Keep `resolveClaim`'s public signature unchanged.

- [ ] Write integration tests with synchronization barriers: credit versus deny, credit versus reship, different credit amounts, forced audit failure, two charged reships for separate claims, and charged reship versus ordinary order reservation. Assert claim metadata, ledger delta, reship count, and held/available funds agree after each race.
- [ ] Run these tests against a disposable database and confirm current inconsistencies. Existing sequential duplicate-reship coverage is insufficient.
- [ ] Extract the transaction-aware append helper. Acquire the existing per-brand wallet lock before balance reads and writes. For an existing external ID, validate brand/type/amount compatibility and reject conflicting replays. Do not query inside a PostgreSQL transaction after an unhandled unique violation has aborted it.
- [ ] In claim resolution, acquire the wallet lock first, reload the claim, and claim exclusive resolution inside the same transaction. Use a consistent wallet-before-claim lock order for all new paths. Perform credit or reship creation, final claim metadata, and audit write inside this transaction.
- [ ] For charged reships, calculate available funds under the wallet lock immediately before creating the order. Preserve `awaiting_funds` behavior when insufficient. A zero-cost reship remains possible without sufficient wallet funds.
- [ ] Verify failure at any step rolls everything back. Verify a losing resolution produces no ledger entry or reship, and competing reservations cannot both consume the same available balance. Rerun existing wallet, order-idempotency, claim, and order integration suites in the isolated database. Commit findings 4 and 5 together.

**Acceptance:** Each claim has one financial/fulfillment outcome committed with its audit. Reship reservations obey the same serialization as ordinary orders. A replay with different money parameters cannot silently reuse another amount.

## Release and verification

- [ ] Run `NODE_ENV=test RUN_DB_TESTS=0 pnpm --filter @ruostack/api exec vitest run test/unit` and `pnpm typecheck`. Baseline from review: 323 API unit tests and workspace type checks passed.
- [ ] Run targeted integration suites with `NODE_ENV=test RUN_DB_TESTS=1` and explicitly supplied disposable `DATABASE_URL`/`DIRECT_URL`; never source the production `.env`. Run files serially as already configured.
- [ ] Deploy in order: invitation fix; additive MFA schema then MFA application changes; outbound transport; transactional claims. All application changes receive staging checks before production rollout.
- [ ] Observe sanitized rejection/error counters and legitimate invitation, enrollment, store-sync, and claim success rates. Do not log bearer material or secrets. Roll forward with a correction rather than restoring an exposed authentication path.
- [ ] Prepare a read-only reconciliation report for historical claim credits versus recorded outcomes and over-reserved wallets. Investigate anomalies; any corrective financial entries are a separate reviewed action, never an automatic ledger rewrite.

## Scope excluded

Refresh rotation, subscription sweep races, last-owner races, broad UI refactoring, and queue/customer-rollup optimizations are intentionally separate work. No fixes or deployments have been performed by preparing this plan.

## Implementation status — 2026-11-23

All five code findings implemented on `fix/high-severity-remediation`, including the adjacent identity-ownership and financial-state gaps identified in independent review. Verification: 450 offline workspace tests, 37 targeted PostgreSQL integration tests, workspace typecheck, production build. See `docs/security/high-severity-remediation-rollout.md` for decisions, migration order, staging checks, and historical reconciliation queries. Release steps above remain pending; production has not been changed.
