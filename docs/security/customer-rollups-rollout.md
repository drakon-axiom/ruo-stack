# Lifetime customer rollups

The portal now uses PostgreSQL to calculate full-lifetime customer counts, order counts, fulfillment spend, latest identity, first/last order dates, nonempty phone fallback and latest complete shipping address. Cancelled orders remain excluded. Grouping remains normalized email, or normalized name plus exact ZIP when email is absent.

## API and UI

- `POST /api/brand/customers/search` accepts search, sort, offset and limit (default 50, maximum 100). Totals cover all non-cancelled orders for the authenticated brand, independently of search/paging; page.total is the matched customer count. Search is literal substring matching, with parameters rather than SQL interpolation. Server sorting uses ICU root collation and deterministic key tie-breaks.
- `POST /api/brand/customers/history/page` accepts the customer key, limit and optional created_at/UUID cursor. It returns full customer metadata/totals plus a bounded history page. The cursor uses date/ID ordering; new newer orders do not displace already traversed history pages. Each response has one database statement snapshot; separate pages reflect current data rather than a frozen historical snapshot.
- Search terms and customer identifiers remain in JSON bodies, outside request URLs. Every SQL query binds the authenticated brand; caller-supplied brand identifiers are ignored.
- The portal debounces search, pages customers, loads older history, retries failures and discards stale responses. Ship again uses current returned customer details.
- Legacy GET customers and POST customers/history retain their capped behavior for older clients. The portal no longer uses them. Remove these compatibility routes only after clients migrate; they are not lifetime-reporting APIs.

## Migration

`00000000000033_customer_rollup_index` adds two pure invoker-only functions and a partial expression index. The trim helper implements ECMAScript whitespace; ICU root lowercasing handles dotted I and Greek final sigma. Keys use bytewise equality. The index stores a fixed-length MD5 of the key, plus brand/date/ID, to support arbitrarily long imported recipient fields. Every lookup also checks the complete key, so MD5 collisions cannot merge customers. Hash/index comparisons explicitly use the same C collation; this is required for indexed lateral profile lookups.

The migration rewrites no application rows and changes no table/RLS grants. It uses a five-second lock timeout. It must precede the new application. Production preflight confirmed ICU root collation support and a small order relation (90,112 bytes); a normal transactional index build is appropriate for this deployment. Large future installations should build the index concurrently through a separately planned migration. Prisma cannot represent the expression/partial index in schema.prisma; the SQL migration owns it.

ICU version upgrades may change casing/collation behavior: review PostgreSQL collation-version warnings, compare identity normalization against JavaScript fixtures, and rebuild the affected index when upgrading ICU. Do not replace the identity function's semantics without an index rebuild.

## Verification

Tests use disposable PostgreSQL, not production. Coverage includes 5,101 orders, customers older than the former cutoff, JS/SQL Unicode equivalence, blank-email grouping, historical address/phone fallback, cancellation/brand bounds, literal search, stable paging, empty results, very long keys, tied history dates, and orders arriving between pages. Browser tests cover search/list pagination, history loading/retry, refreshed addresses and stale responses.

With 20,000 synthetic orders across 1,000 customers, actual EXPLAIN ANALYZE showed the history index in both query plans. Local execution was approximately 132 ms for a 50-customer search and 0.6 ms for a 10-order history page. These are local database measurements, not production latency promises. Reproduce using `apps/api/test/benchmarks/customer-rollups.mts`; its guard restricts it to the disposable local database. The initial plan's collation mismatch was caught and corrected before release.

The index adds write/storage overhead, and full-lifetime aggregation still scales with a brand's non-cancelled order count. Node/browser results are bounded; there is no 5,000-order cutoff on the new APIs. No production customer records or financial data were modified for verification.
