# Remaining authentication fixes

## 1. Cross-tab admin refresh

The browser now serializes refresh, login token writes, and logout token removal using one same-origin Web Lock. Waiting requests reread the shared state and reuse an already rotated token. A generation ID prevents a delayed 401 from retrying under a different login. Access and refresh credentials are stored together in one JSON record; existing token pairs migrate on rotation or sign-in. The auth provider tracks changes from other tabs.

Automatic rotation requires Web Locks (production uses HTTPS); browsers without support require sign-in after expiry rather than issuing racing refreshes. Login/logout writes still work without that API. Refresh requests have a 15-second timeout; writes wait for a pending rotation. Already-open old-version tabs should be reloaded after deployment to use coordination. This does not eliminate the backend logout/rotation race; fix 2 below addresses the session family.

Tests use separate module instances sharing storage and a serialized lock mock, plus delayed responses. They cover cross-tab rotation, account switches, logout, unsupported locking, migration, network failure and existing single-flight behavior. Browser API contract: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API . No production credentials were used.

Verification: 503 offline tests, workspace typecheck and build passed. Independent review blockers (HTTP-compatible generation IDs and consistent identity snapshots for initial/retried requests) were reproduced and fixed. No minor findings were deferred.

Fix 1 deployed and pushed as `1c1417c`; local/origin/public health, both applications' HTML/entry bundles, auth boundaries and 415 checks passed.

## 2. Logout session families

New admin logins create independent UUID families; rotations preserve the family. Logout accepts a consumed ancestor token and revokes every live session in that family under the same admin row lock used by refresh. If logout wins the lock first, refresh fails; if refresh wins, logout revokes the replacement. Other device logins remain valid. Malformed logout tokens return 400, and unknown tokens remain idempotent.

Migration `00000000000034_admin_session_families` adds a nullable family column and index, and revokes existing live admin sessions once because their historical lineage cannot be reconstructed reliably. The database intentionally has no family default; only the new Prisma client supplies one for new logins. Thus old processes running during deployment can only create NULL-family sessions, rejected by the new guard/refresh handler. Brand sessions are unaffected. Existing admins must sign in again. Roll back application code only if accepting the previous logout weakness; never restore revoked legacy sessions.

Production metadata preflight: 72 session rows, 6 unrevoked, table plus indexes 147,456 bytes. The migration is transactional with a five-second lock-acquisition timeout. Disposable PostgreSQL tests cover ancestors/descendants, independent logins, both concurrent lock orderings, malformed input and NULL legacy families. The migration was also executed against a populated temporary session table to verify revocation and the NULL default. All 34 targeted auth database tests, 503 offline tests, types and builds pass. No real credentials were used for tests.

Review found no blockers. Its idempotency coverage suggestion was added for unknown/missing logout tokens. During rollout, only the new code rejects NULL-family sessions; all old API processes must be replaced before declaring completion. The production deployment reloads the single PM2 API process and verifies it afterward.

Fix 2 deployed and pushed as `220a244`. Migration 34 applied successfully (35 total migrations); PM2 replaced the API process and reported online. Local/origin/public health, deployed HTML/bundles, authentication boundaries and 415 checks passed.

## 3. Invitation reissue

The reissue endpoint retains the legacy `/invite-link` URL for compatibility but never returns a generated credential. It asks Supabase to email the invitation to the invitee and returns only user ID, email, and delivery-request confirmation. Even if confirmation/sign-in races with the preliminary pending check, no invitation/recovery token is disclosed to the owner. Established/suspended members are rejected; Auth lookup failures fail closed; provider errors never fall back to recovery credentials; a mismatched provider identity is rejected without deleting any identity. Reissues are limited to ten per minute per client IP.

The Team screen uses **Email invite**, disables duplicate submissions, and reports provider acceptance or an error rather than displaying a copied link. Initial invitations still reserve a new identity and return its first link under the existing ownership checks.

Email delivery requires working Supabase Auth mail configuration. Older repository comments stated SMTP was not configured; current delivery configuration cannot be verified with the available read-only tools, and no live invitation emails were sent for testing. Provider failures surface a delivery error; there is deliberately no unsafe link-return fallback. Supabase's documented API: https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail . Current changelog and provider source were checked; no SDK dependency upgrade was needed.

Verification: 506 offline tests pass, including mocked provider races/failures and browser success/retry behavior. Typecheck and builds pass. Actual inbox delivery is not claimed. No schema migration is added by fix 3.

Final review found no critical or important issues. The remaining initial-invite help text was corrected to describe recipient-only email reissues. No code-review findings remain deferred; inbox delivery remains an explicit operational verification limit.
