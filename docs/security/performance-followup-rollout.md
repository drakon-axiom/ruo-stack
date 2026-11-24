# Error handling and performance follow-up

## Changes

- Preserve HTTP client-error statuses in the uniform error handler, including unsupported content types (415), oversized bodies (413), and rate limits (429). Framework error responses use public status descriptions, not diagnostic messages. Application errors and validation keep their established contracts; unexpected errors remain sanitized 500 responses.
- Schedule reconciliation, subscription lapse, and dunning workers after each run completes. A slow run cannot overlap itself in the same process, and stopping during a run prevents rescheduling. This is not a distributed lease and does not serialize manual invocations with timer work.
- Fetch relation counts in the fulfillment queue instead of materializing item rows solely to calculate their count. Order detail still fetches its items.
- Add opt-in customer summary/history views. Summary folding avoids allocating per-order history objects. The portal fetches history only when a customer drawer opens, with retry and stale-response protection. The default API response remains compatible with existing clients. Both views use the same brand-scoped, newest-first 5,000-order reporting window, with a stable ID tie-breaker. The portal now displays the truncation notice.
- Extract the customer drawer and its types from the main screen.

## Measurement and limits

For synthetic data containing 5,000 orders across 100 customers, serialized customer data dropped from **1,040,361 bytes to 56,571 bytes (95%)** for the summary view. This measures JSON payload size, not production latency. History views still scan the bounded order window; this change does not implement a database lifetime rollup. Benefits vary with orders per customer.

SQL customer aggregation, distributed worker leases, other large-screen refactors, cross-tab admin refresh coordination, invitation-reissue races, and logout session-family semantics remain separate follow-ups. No schema migration or financial data correction is part of this release.

## Verification

Regression tests reproduce the client-error mapping, overlapping workers, queue count materialization, and eager history payloads. Customer rollup tests preserve identity grouping, totals, phone/address fallback, and cancellation/brand query constraints. Browser tests cover on-demand history, retry, visible truncation, failed list loading, and ignoring an old customer's response after switching.

Pre-deployment verification passed: **473 offline workspace tests**, workspace type checking, all application builds, and diff whitespace checks. Database integration suites were skipped in this mode; this pass changes no schema or transactional financial writes. External API calls are mocked in route/UI tests; the HTTP tests use the real assembled Fastify application.
