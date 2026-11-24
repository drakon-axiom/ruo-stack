# Lifetime customer rollups

The portal now uses PostgreSQL to calculate full-lifetime customer counts, order counts, fulfillment spend, latest identity, first/last order dates, nonempty phone fallback and latest complete shipping address. Cancelled orders remain excluded. Grouping remains normalized email, or normalized name plus exact ZIP when email is absent.

## API and UI

- `POST /api/brand/customers/search` accepts search, sort, offset and limit (default 50, maximum 100). Totals cover all non-cancelled orders for the authenticated brand, independently of search/paging; page.total is the matched customer count. Search is literal substring matching, with parameters rather than SQL interpolation. Server sorting uses ICU root collation and deterministic key tie-breaks.
- `POST /api/brand/customers/history/page` accepts the customer key, limit and optional created_at/UUID cursor. It returns full customer metadata/totals plus a bounded history page. The cursor uses date/ID ordering; new newer orders do not displace already traversed history pages. Each response has one database statement snapshot; separate pages reflect current data rather than a frozen historical snapshot.
- Search terms and customer identifiers remain in JSON bodies, outside request URLs. Every SQL query binds the authenticated brand; caller-supplied brand identifiers are ignored.
- The portal debounces search, pages customers, loads older history, retries failures and discards stale responses. Ship again uses current returned customer details.
- Legacy GET customers and POST customers/history retain their capped behavior for older clients. The portal no longer uses them. Remove these compatibility routes only after clients migrate; they are not lifetime-reporting APIs.

## Migration

`00000000000033_customer_rollup_index` adds three pure invoker-only functions and a partial expression index. The trim helper implements ECMAScript whitespace. A generated Unicode 17.0 lowercase helper pins JavaScript mappings and contextual final-sigma rules independently of the database ICU version. An ASCII fast path keeps ordinary address/email processing inexpensive. Keys use bytewise equality. The index stores a fixed-length MD5 of the key, plus brand/date/ID, to support arbitrarily long imported recipient fields. Every lookup also checks the complete key, so MD5 collisions cannot merge customers. Hash/index comparisons explicitly use the same C collation; this is required for indexed lateral profile lookups.

The migration rewrites no application rows and changes no table/RLS grants. It uses a five-second lock timeout. It must precede the new application. Production preflight confirmed ICU root collation support and a small order relation (90,112 bytes); a normal transactional index build is appropriate for this deployment. Large future installations should build the index concurrently through a separately planned migration. Prisma cannot represent the expression/partial index in schema.prisma; the SQL migration owns it.

Identity normalization is pinned to Unicode 17.0. `packages/db/scripts/generate-customer-lower.mjs` reproducibly generates its SQL tables/context rules and refuses a different Unicode version. Upgrading that contract requires a new migration and rebuilding the identity index. Exhaustive case/context equivalence tests detect Node Unicode drift. ICU is used only for name ordering, so ICU upgrades may reorder name-sorted pages but do not alter identity keys.

## Verification

Tests use disposable PostgreSQL, not production. Coverage includes 5,101 orders, customers older than the former cutoff, JS/SQL Unicode equivalence, blank-email grouping, historical address/phone fallback, cancellation/brand bounds, literal search, stable paging, empty results, very long keys, tied history dates, and orders arriving between pages. Browser tests cover search/list pagination, history loading/retry, refreshed addresses and stale responses.

With 20,000 synthetic orders across 1,000 customers, actual EXPLAIN ANALYZE showed the history index in both query plans. Local execution was approximately 147 ms for a 50-customer search and 0.6 ms for a 10-order history page. These are local database measurements, not production latency promises. Reproduce using `apps/api/test/benchmarks/customer-rollups.mjs`; its guard restricts it to the disposable local database. The initial plan's collation mismatch was caught and corrected before release.

The index adds write/storage overhead, and full-lifetime aggregation still scales with a brand's non-cancelled order count. Node/browser results are bounded; there is no 5,000-order cutoff on the new APIs. No production customer records or financial data were modified for verification.


## Independent review and follow-up

The reviewer found two important issues. First, the database ICU version and Node disagreed on newer letters, splitting identities such as `Ɤ@test` and `ɤ@test`. Both were reproduced in failing tests; the pinned normalizer now uses the same contract for identity, displayed email and search. Tests compare every cased codepoint and case-ignorable sigma context with JavaScript, including new Unicode letters. Second, a missing customer response could leave stale drawer details/history; explicit missing-state tests now pass for initial and older-page fetches. Direct history assertions also verify the customer before the former cutoff, the 5,100-order customer's complete count, bounded rows, and final cursor retirement.

Deferred minors: if a customer disappears on the last list page, its label can display an empty/outdated range until Previous page is selected; automatically recovering the last valid offset remains follow-up. The existing floating-point currency formatter can round an extremely large lifetime amount by a cent; integer-only display formatting remains follow-up. Neither changes stored charges or ledger values.

Scope decisions: keep capped legacy endpoints to avoid breaking older clients; the updated portal uses full lifetime APIs. Separate pages reflect current data and are not a frozen snapshot. The small preflight table size supports a transactional index build; lock acquisition is limited to five seconds, but actual build time is not bounded by that setting. These deployment choices must be revisited for large installations.

Post-review verification passed: **481 offline workspace tests**, **33 targeted PostgreSQL integration tests**, workspace type checking, all application builds, and diff whitespace checks. The generated Unicode SQL exactly matches the checked-in generator's output. The final migration was replayed from scratch on disposable PostgreSQL before verification. No independent second review was performed after the regression-driven fix pass.

## Production rollout — 2026-11-23

Applied `00000000000033_customer_rollup_index` to the guarded production project; all **34 migrations** are current. A read-only post-migration transaction verified **21,474 Unicode/casing-context samples with zero mismatches**, valid/ready index state, three invoker-only helper functions, and both new queries against a verified nonexistent random brand ID. No customer records were read by that check. The running production Node binary also reports Unicode 17.0.

Deployed application revision `528abce` through the guarded production deployment script. API and SPA builds succeeded; PM2 reports `ruostack-api-prod` online with restart count 4. Loopback and both origin health checks pass. Origin HTML and entry-bundle hashes match both deployed builds, and both new customer endpoints reject unauthenticated origin requests with 401. Unrelated untracked planning documents remain intact.

**Public verification is blocked by an infrastructure issue:** both public HTTPS hosts time out. `tailscale ping 100.99.76.10` reports `peer's node key has expired` for reverse-proxy `srv1153350`. The origin remains healthy. Private edge SSH is unreachable; public SSH rejects the available credentials, and this session has no Tailscale admin credential/connector. Node reauthentication is needed before public smoke checks can finish. No tunnel/firewall/access-control changes were made, and key expiry was not disabled. The user was asked to reauthenticate the node or identify an existing authorized admin connection.
