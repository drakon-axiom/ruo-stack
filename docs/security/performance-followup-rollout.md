# Error handling and performance follow-up

## Changes

- Preserve HTTP client-error statuses in the uniform error handler, including unsupported content types (415), oversized bodies (413), and rate limits (429). Framework error responses use public status descriptions, not diagnostic messages. Application errors and validation keep their established contracts; unexpected errors remain sanitized 500 responses.
- Schedule reconciliation, subscription lapse, dunning, and rate-quote cleanup workers after each run completes. A slow run cannot overlap itself in the same process, and stopping during a run prevents rescheduling. This is not a distributed lease and does not serialize manual invocations with timer work.
- Fetch relation counts in the fulfillment queue instead of materializing item rows solely to calculate their count. Order detail still fetches its items.
- Add opt-in customer summary/history views. Summary folding avoids allocating per-order history objects. The portal fetches history only when a customer drawer opens, with retry and stale-response protection. History uses a read-only POST with the customer key in a JSON body, so emails and name/ZIP grouping keys do not enter access-log URLs. The loaded details and Ship again address come from that same response. The default API response remains compatible with existing clients. Both views use the same brand-scoped, newest-first 5,000-order reporting window, with a stable ID tie-breaker. The portal now displays the truncation notice.
- Extract the customer drawer and its types from the main screen.

## Measurement and limits

For synthetic data containing 5,000 orders across 100 customers, serialized customer data dropped from **1,040,361 bytes to 56,571 bytes (95%)** for the summary view. This measures JSON payload size, not production latency. History views still scan the bounded order window; this change does not implement a database lifetime rollup. Benefits vary with orders per customer.

SQL customer aggregation, distributed worker leases, other large-screen refactors, cross-tab admin refresh coordination, invitation-reissue races, and logout session-family semantics remain separate follow-ups. No schema migration or financial data correction is part of this release.

## Verification

Regression tests reproduce the client-error mapping, overlapping workers, queue count materialization, and eager history payloads. Customer rollup tests preserve identity grouping, totals, phone/address fallback, and cancellation/brand query constraints. Browser tests cover on-demand history, retry, visible truncation, failed list loading, and ignoring an old customer's response after switching.

Pre-deployment verification passed: **473 offline workspace tests**, workspace type checking, all application builds, and diff whitespace checks. Database integration suites were skipped in this mode; this pass changes no schema or transactional financial writes. External API calls are mocked in route/UI tests; the HTTP tests use the real assembled Fastify application.


## Independent review

The reviewer identified customer keys entering logged URLs and an omitted rate-quote timer. Both were reproduced with failing tests and fixed. The key now travels in the request body without an arbitrary 1,000-character limit; long imported keys are covered. Rate-quote cleanup uses the same non-overlapping scheduler.

The drawer snapshot finding was treated as important because an old address could prefill Ship again after newer history loaded. A failing regression test now verifies refreshed details and address, and the action waits for history to load successfully.

Final verification after review fixes: **476 offline tests passed**, workspace type checks and production builds passed. No second independent review was performed; the fixes were verified with regression tests and the full suite.

Deferred minor: the 429 test constructs the framework-shaped error and Retry-After header; add an end-to-end rate-limit plugin threshold test in a follow-up. Existing coverage proves the handler preserves the status/header, not the plugin's threshold behavior.

Scope decisions: lifetime SQL aggregation remains deferred to preserve grouping semantics and the existing bounded window; high-volume brands still have partial totals, now visibly labeled. Worker coordination remains per process; multiple instances/manual runs can overlap. The drawer uses one current response for its details and action, but does not maintain a historical snapshot across list and drawer requests. The synthetic payload result is not a production latency benchmark.

## Production deployment — 2026-11-23

Merged and deployed application revision `ac8a68d` through `deploy/deploy.sh prod`, after frozen dependency installation and Prisma generation in the production checkout. No migrations were pending. API and both SPAs built successfully; PM2 reloaded the API and reported online (restart count 3).

Post-deployment smoke checks passed for loopback, both origin proxies, and both public HTTPS health endpoints. Both public HTML documents and entry bundles matched deployed build artifacts. Invalid/absent authentication was rejected on admin claims, brand members, MFA enrollment, and the new customer-history endpoint. The formerly failing form-content request now returns **415 unsupported_media_type**. No real customer history or financial data was read or modified by smoke checks. Existing unrelated untracked planning documents were preserved.
