# COA release verification — 2026-11-27

Status: implementation and independent review fixes complete; production deployment pending backup approval. No production inventory, certificates, or SKU tracking were created or enabled.

## Verification

- Offline workspace suites: 525 tests passed.
- Database integration suites: 57 tests passed across 18 files, including COA access, allocations, amendments, export concurrency, cleanup, store reconciliation, and existing wallet/order flows.
- Origin proxy checks: 108 passed.
- WooCommerce PHP rendering fixtures passed.
- Production build and workspace typechecks passed.
- Fresh disposable database replay: migrations 00 through 40 passed.
- Restrictive Storage policy fixture denied private COA visibility even with a broad permissive policy.
- Read-only production preflight: Storage RLS enabled, expected brand-logo policies, no open Woo orders needing legacy origin reconciliation.

## Independent review resolution

All 14 findings were addressed; none were deferred:

1. Capture and verify originating store identity before shipment writeback; reconcile legacy mappings explicitly.
2. Require explicit historical report revision evidence for late assignments and corrections.
3. Lock and re-read export readiness atomically with first-export recording.
4. Clear stale Woo certificate metadata when corrected evidence is private.
5. Preserve tracking delivery despite missing certificate mapping; deduplicate shipment notes.
6. Isolate store failures and process stock withdrawal independently.
7. Queue activation and expiry stock updates; expose receiving expiry.
8. Preserve Woo line identity correctly across order edits and duplicate SKUs.
9. Expose paged recall impact and historical traceability exceptions.
10. Snapshot exception scope so later SKU activation does not expand old holds.
11. Keep internal withdrawal reasons off public pages.
12. Permit tenant-authorized private shipment certificate downloads.
13. Audit complete Storage policies, RLS, and effective role privileges.
14. Schedule bounded staging cleanup with deletion retry and completion records.

Regression coverage: coa-review-regressions, coa-export-race, coa-store-resilience,
coa-storage-policy, coa-cleanup, coa-impact, and coa-mapping test suites.

## Remaining rollout gates

- Approve a private local production database backup or confirm an existing provider backup. Automatic approval review rejected exporting the production public schema to `/tmp/ruostack-coa-predeploy-backup` because the sensitive data copy to that destination lacked explicit authorization. No export was performed.
- Deploy additive migrations/application, provision the private bucket, install origin proxy configuration, and verify live endpoints and Storage access.
- Install WooCommerce plugin 0.2.0 on an identified staging store; verify actual theme/order display and HTML/plain-text test emails.
- Operator supplies real reviewed PDFs and reconciled opening quantities, then validates one warehouse pilot before expanding tracked SKUs.

See [rollout runbook](coa-lot-rollout.md) for operational steps and rollback boundaries.
