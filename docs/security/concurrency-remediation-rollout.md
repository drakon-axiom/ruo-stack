# Concurrency remediation — 2026-11-23

This follow-up addresses the three medium concurrency findings left after the high-severity remediation:

- Refresh tokens are consumed and replaced in one transaction while locking the admin row. Concurrent exchanges have a single winner, replacement failures roll back consumption, and suspension uses the same lock order. The admin browser shares refresh requests, retries late 401 responses with the current token, and discards responses arriving after logout or a new login.
- Subscription expiry conditionally updates the selected status and paid-through date. A renewal makes the old candidate ineligible. Expiry, the brand status mirror, and its audit commit together; parallel sweeps count/audit each actual expiry once.
- Membership mutations acquire a per-brand transaction advisory lock (namespace 2). They recheck the actor's active owner membership and the target under that lock, then enforce the active-owner count. Invite commits and reactivation use the same lock. Suspended owners are not counted as active owners.

No schema changes or migration are needed. The per-brand lock covers application membership writers; direct SQL writers must follow the same discipline. Browser refresh coalescing is per tab; this release does not add cross-tab coordination.

## Verification

The prior behavior was reproduced with failing tests before each implementation change. The offline workspace suite passed 456 tests, and eight targeted PostgreSQL suites passed 59 tests. Workspace type checking and all application builds passed. Database tests ran against disposable local PostgreSQL, not production; external Supabase Auth verification was mocked in membership route tests.

Independent review found no blocking issue. Its suggested regression tests were added for both refresh/suspension lock orders, login during refresh, and a network-rejected refresh. The known whitespace issue was corrected. Cross-tab coordination, invitation reissue against external Auth, and session-family revocation on logout are separate protocol concerns outside these three findings.

## Historical reconciliation

Ran the three SQL checks in `high-severity-remediation-rollout.md` against the guarded production project at **2026-11-24 01:26:14 UTC** (November 23 local time). They ran in a single repeatable-read, read-only transaction with a statement timeout. Only aggregate counts were returned:

| Check | Anomalies |
| --- | ---: |
| Claim/credit inconsistencies | 0 |
| Wallet over-reservations | 0 |
| Reopened resolutions with existing metadata | 0 |

These results describe that snapshot and those checks; they are not a complete financial audit. No ledger, audit, claim, or wallet corrections were made.

## Remaining scope

Performance work on queues and customer aggregation, and refactoring large UI screens, remain follow-up items.
