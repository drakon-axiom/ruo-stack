# COA release verification — 2026-11-27

Status: deployed to production on 2026-11-27. Implementation and independent review fixes complete. No production inventory, certificates, or SKU tracking were created or enabled.

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

- Complete authenticated Storage access validation with an authorized staging account and real-object checks before operational acceptance. Production RLS/effective-policy audit passed; anonymous bucket and nonexistent-object probes were denied. No test user or test PDF was created.
- Install WooCommerce plugin 0.2.0 on an identified staging store; verify actual theme/order display and HTML/plain-text test emails.
- Operator supplies real reviewed PDFs and reconciled opening quantities, then validates one warehouse pilot before expanding tracked SKUs.

See [rollout runbook](coa-lot-rollout.md) for operational steps and rollback boundaries.

## Production deployment evidence

User explicitly approved the private local backup after the initial automatic-review rejection. Public-schema custom archive saved at `/tmp/ruostack-coa-predeploy-backup/public.dump` (directory mode 0700, archive 0600; 1,017,881 bytes). Archive catalog and full archive decoding passed; a database restoration was not performed. This is a database backup, not a Storage-object backup.

Migrations 35–40 applied. Private `coa-private` PDF bucket configured after RLS, effective-role, and policy audit. Origin nginx change added only `/coa/` forwarding on both application hosts; config test and reload passed. API and both SPAs built and published, PM2 reload succeeded. Live health, HTML/bundle hashes, authentication boundaries, and COA proxy routes passed.

The first deploy build exposed a missing Prisma generation step with cached dependencies. Deployment now explicitly generates the client before migration/build; the rerun succeeded. Application implementation release: `af6f361`.

Read-only report: 77 products, 0 tracking-enabled, 77 without opening lots/reviewed documents; 0 untracked shipped orders, traceability exceptions, unresolved open Woo origin mappings, or failed writebacks. Private report retained alongside the backup. Production configuration also reports missing `RESEND_API_KEY`; admin invitations and dunning notices are not delivered until email configuration is completed.
