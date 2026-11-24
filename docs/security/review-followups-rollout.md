# Deferred review follow-ups

This pass closes the three minor findings recorded in the customer-rollup and performance rollout notes:

- If the matched customer count shrinks below the requested offset, the customer screen fetches the last valid page before displaying rows or a range. It also returns to offset zero when no customers match. Existing request cleanup discards stale responses; query identity protects newer search/sort changes during recovery.
- Customer currency display uses integer arithmetic for whole dollars and cents, preserving exact values through the API's safe-integer range. It keeps the existing dollar/sign style and does not alter charges or ledger values. The API already rejects totals outside the supported integer range.
- A real Fastify rate-limit test sends requests through the registered plugin, verifies the threshold, sanitized 429 response and Retry-After, confirms the blocked request never enters the handler, and checks client-IP isolation. No rate-limit production behavior changed.

Regression evidence: empty-page tests failed before the offset fix; large positive and negative cent-value tests failed before the formatter fix. Afterward, all 496 offline workspace tests, typecheck, and build passed. No schema or database write changes; database integration tests are skipped in the offline suite. Deployment/build results are recorded below after verification.

Independent review found no critical or important issues. Its suggested nonzero-page recovery case was added and passes (offset 150 → 50 when total drops to 100). Invalid currency inputs remain outside the API contract; the service rejects them before returning customer totals. No review findings remain deferred in this pass.
