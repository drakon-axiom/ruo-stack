# Cross-process worker coordination

Use executing-plans, test-driven-development and one independent final review. Prior commit/deploy/push authorization persists.

1. Add failing real PostgreSQL tests for concurrent independent lock sessions, unrelated job concurrency, release on failure/disconnect, rejected transaction-pooler configuration and ownership-loss guards.
2. Implement dedicated pg.Client session advisory locks using DIRECT_URL (direct/session mode), namespace 3, stable job IDs. Fail closed when unavailable; no unlocked fallback. Heartbeat detects loss, and guarded Prisma operations/checkpoints stop further work. Always unlock/close. No long business transaction or clock-based expiry. In-flight external actions cannot be retracted; provider idempotency remains required, not an exactly-once guarantee.
3. Route scheduled/manual reconciliation and cleanup through shared coordinated entry points; wrap subscription and dunning scheduled runs. Preserve raw primitives for existing focused tests. Busy manual reconciliation returns 409; scheduled contention is a normal skip. Test entry-point wiring and failure cleanup. Fix dunning's adjacent stale-expiry race with conditional state/mirror/audit transaction, since worker exclusion cannot serialize payment renewals.
4. Verify full offline suite, real DB races, types/build and independent review/fix pass. Preflight production session connection using an isolated probe lock (no jobs/business mutations), deploy, verify health/assets/auth, and push. No schema migration expected.

Constraints: DIRECT_URL must not be transaction-pooled. No global expiry-disable or network policy changes. Keep unrelated user files. Preserve periodic stop/retry behavior; never hold an application transaction during external requests. Graceful job completion releases locks; database session termination releases locks after crashes. Connection-loss detection bounds further work but cannot undo an already dispatched operation.
