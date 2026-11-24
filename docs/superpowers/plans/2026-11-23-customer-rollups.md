# Lifetime customer rollups

Execute with executing-plans and test-driven-development; one independent final review. Authorized scope includes commit, migration, deploy and push.

1. Add PostgreSQL tests showing customer records/totals and history beyond 5,000 orders, grouping equivalence (Unicode trim/lower, blank email, name+ZIP), cancellation/tenant bounds, address/phone fallback, stable paging/search/sort and empty results. Use disposable PostgreSQL only.
2. Add immutable SQL trim/key helpers and a partial expression index on brand, hashed key, date and ID. ICU root casing must match tested JS cases. Hash is only an index accelerator; always compare full keys. Keep ordinary invoker permissions. No data rewriting or definer privileges. Validate index/normalization and query plans.
3. Implement parameterized SQL lifetime aggregation plus bounded customer pages and indexed cursor-paged history. Search/customer identifiers stay in POST bodies. Keep legacy GET response for existing clients, explicitly documented as capped compatibility path; new portal uses full lifetime APIs. Counts/sums precede pagination. Consistent metadata per response, safe integer conversion.
4. Move search/sort/paging to server in portal; debounce search and ignore stale responses. History supports loading older pages with keyset cursor, keeps current details/address, handles errors/retries and missing customers. Existing interactions remain.
5. Verify full suite/typecheck/build, targeted real DB tests and representative EXPLAIN, independent review/fix pass. Guard migration target, deploy before new code, smoke test, commit/push rollout record.

Acceptance: complete lifetime totals without sending all orders/customers to Node/browser; no new cross-tenant exposure; preserved identity/fallback semantics; bounded page sizes; old clients still work. No distributed-worker or unrelated UI changes.

Implementation, review fix pass, 481 offline tests, 33 targeted database tests, typecheck/build, production migration and application deployment are complete. Origin smoke checks pass. Public verification remains blocked by the reverse proxy's expired Tailscale node key; see the rollout document for recovery requirements and deferred minors.

Public verification completed after the user reauthenticated the edge node. Both public sites, deployed assets and authorization boundaries passed; rollout complete.
