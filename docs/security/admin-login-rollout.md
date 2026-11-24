# Admin login account-race remediation

An MFA-enabled login previously read an admin account, verified password/TOTP, updated `lastLoginAt`, then created a session without an encompassing transaction. A concurrent account change could leave those checks stale and mint a session after suspension or credential replacement. A changed role could also remain in the new token, and a failed session insert could leave a successful-login timestamp.

Login now holds the admin row lock while checking the current account, verifying TOTP, updating `lastLoginAt`, and issuing the session. Password verification stays outside the transaction; the stored hash must still match under the lock. The current account must remain active with the same enabled MFA secret. Session issuance uses the current role. Lock ordering matches refresh and suspension (admin before sessions), so suspension either precedes login and rejects it or follows issuance and revokes its session. No network requests or password hashing occur under the lock.

Eight disposable-PostgreSQL regression tests cover suspension, password/MFA changes, current-role issuance, rollback after session-insert failure, and a normal login. Six cases failed before the fix. All 26 targeted login/refresh/MFA database tests and 496 offline workspace tests pass. No production identities or credentials are used for tests. No schema migration or session invalidation is required.

Separate remaining follow-ups: cross-tab browser refresh coordination, logout session-family semantics, invitation reissue races, and optional large-screen refactoring. This patch does not claim to resolve them.

Independent review found no critical or important issues. Its suggested contention test was added: a separate transaction receives PostgreSQL `55P03` when trying to lock the admin while session creation is paused. All targeted tests, workspace typecheck/build, and whitespace checks pass. No review findings remain deferred for this patch.

Production rollout: application revision `97927c3` deployed through `deploy/deploy.sh prod` on 2026-11-23 (America/Chicago). All 34 migrations remain current. PM2 is online after reload. Loopback/origin/public health, both application HTML/entry bundles, protected-route authentication, and HTTP 415 handling pass. A synthetic nonexistent admin login returns 401. No real credentials or production identity mutations were used for verification.
