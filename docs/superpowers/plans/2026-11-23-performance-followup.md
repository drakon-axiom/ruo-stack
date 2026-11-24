# Error handling and performance follow-up

Scope: preserve endpoint authorization and business rules while reducing avoidable queue work and customer payloads. Continue authorized commit/deploy/push. No schema change.

1. Reproduce unsupported content type (415), oversized bodies (413), and rate-limit (429) mapping failures. Preserve framework client statuses with safe messages; unknown/server errors remain sanitized 500. Verify real Fastify requests.
2. Prevent timer workers from overlapping within one process through a shared runner, tested with fake clocks and deferred work, including failure recovery and stop. Use relation counts in the admin fulfillment list instead of loading full items. Preserve response fields.
3. Add opt-in customer summaries without allocating history objects. Keep the legacy default response compatible. Add brand-scoped on-demand history using the same bounded scan and grouping; show truncation and loading/errors. Extract customer drawer/types. Preserve grouping, address fallback, costs, cancelled exclusion and tenant isolation. Test equivalence and lazy loading behavior.
4. Run workspace tests/typecheck/build and one independent final review; fix blockers, commit, deploy, verify health/assets/client error/auth status, push.

Constraints: in-process worker guard is not a distributed lease. Keep customer scan cap (5000); full database rollup and other large-screen refactors remain follow-up. Never run tests against production. Preserve unrelated untracked documents.
