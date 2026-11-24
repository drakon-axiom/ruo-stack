# Remaining Concurrency Remediation Implementation Plan

> Execute using superpowers:executing-plans and test-driven-development. Continue through implementation, verification, commit, deployment, and push as authorized in the session.

**Goal:** Prevent duplicate refresh exchanges, renewal/expiry races, and loss of a brand's last active owner; then inspect historical financial consistency without mutations.
**Architecture:** Reuse transaction-scoped locks and conditional writes. Lock admin before refresh session mutation, preserving suspension's lock order. Expire subscriptions with conditional writes and commit mirror/audit together. Serialize membership mutations per brand and revalidate the actor under the lock. Coalesce client refreshes and handle late 401s without rotating again.
**Spec:** The three remaining medium findings in this conversation. Performance/queue/UI refactoring remain separate follow-up work.
**Tech stack:** Fastify, Prisma/PostgreSQL, React, Vitest.

## Tasks

- [x] Refresh: add failing PostgreSQL tests for simultaneous exchanges, rollback, expiry, and suspension. Atomically consume and replace sessions. Add admin-web Vitest tests for overlapping/late 401s and logout during refresh; implement shared in-flight refresh and stale-response protection.
- [x] Expiry: add failing interleaving tests for renewal after candidate selection, parallel sweeps, and audit failure. Conditional transaction updates must preserve renewed plan/status/date, keep the brand mirror consistent, and count only actual expirations.
- [x] Membership: add failing route tests with real PostgreSQL for concurrent demotion/removal and stale actor authorization. Serialize per-brand writes, recheck active-owner actor and target, count active owners inside transaction, and keep audit atomic. Include invite/reactivation writes in the same discipline.
- [x] Verify offline workspace suite, targeted database suites, typecheck/build, and independent final review. Fix blocking review findings with regression tests.
- [ ] Commit and merge into production main, deploy with guarded script, verify health/assets/auth boundaries, push main. Preserve unrelated untracked documents.
- [x] Run prepared historical reconciliation queries in a read-only production transaction; report aggregate anomaly counts and make no financial corrections.

## Constraints and acceptance

No schema migration is expected. Never run integration tests against production or expose credentials. Use disposable PostgreSQL and mock only external Auth verification. Each old bug must be reproduced before its implementation change. A suspension cannot race a refresh into a surviving active session. A renewal must beat a stale expiry candidate. At least one active owner must remain after concurrent operations; a demoted/suspended actor cannot continue writes based on an earlier request guard. Logout must not be undone by an outstanding refresh response.
