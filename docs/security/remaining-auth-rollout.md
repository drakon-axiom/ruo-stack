# Remaining authentication fixes

## 1. Cross-tab admin refresh

The browser now serializes refresh, login token writes, and logout token removal using one same-origin Web Lock. Waiting requests reread the shared state and reuse an already rotated token. A generation ID prevents a delayed 401 from retrying under a different login. Access and refresh credentials are stored together in one JSON record; existing token pairs migrate on rotation or sign-in. The auth provider tracks changes from other tabs.

Automatic rotation requires Web Locks (production uses HTTPS); browsers without support require sign-in after expiry rather than issuing racing refreshes. Login/logout writes still work without that API. Refresh requests have a 15-second timeout; writes wait for a pending rotation. Already-open old-version tabs should be reloaded after deployment to use coordination. This does not eliminate the backend logout/rotation race; fix 2 below addresses the session family.

Tests use separate module instances sharing storage and a serialized lock mock, plus delayed responses. They cover cross-tab rotation, account switches, logout, unsupported locking, migration, network failure and existing single-flight behavior. Browser API contract: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API . No production credentials were used.

Verification: 503 offline tests, workspace typecheck and build passed. Independent review blockers (HTTP-compatible generation IDs and consistent identity snapshots for initial/retried requests) were reproduced and fixed. No minor findings were deferred.

## 2. Logout session families

Pending.

## 3. Invitation reissue

Pending.
