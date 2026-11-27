# COA documents and lot traceability rollout

Approved workflow: warehouse selects physical lots, one stock location, one
shipment per order, whole sellable SKU units. Support/finance can view catalog
records; operations/super-admin can upload, review, publish and manage inventory.
Review records operator approval, not independent verification by this software.

## Deployment and storage

Deploy additive migrations 35–40 with the guarded production deployment script.
No migration assigns a certificate, creates stock or enables a SKU. Existing
shipped orders remain explicitly untracked. Application public URLs use
`PUBLIC_API_BASE_URL` (production `https://backend.ruostack.io`).

Run `pnpm --filter @ruostack/api exec tsx src/scripts/setup-coa-storage.ts`
with the intended environment loaded by the existing config loader. The private
`coa-private` bucket limits objects to 10 MiB PDFs. Migrations install restrictive
Storage policies when run by the Storage owner. On hosted production the Prisma
role cannot manage those policies: provisioning verifies the existing default-deny
RLS boundary (only brand-logo writes are permitted), and refuses unknown policies.
Do not grant Storage ownership to the app role. Server
service credentials remain API-only. Do not make the bucket public. Confirm
unauthenticated and normal authenticated listing/read/write are denied. Signed
upload tokens target staging objects only; finalization validates type, length,
PDF signature and SHA-256 before writing a new server-only immutable key.
Downloads use five-minute signed URLs. Withdrawal stops new URLs; an already
issued signed URL can remain valid until its five-minute expiry.

The admin catalog now has Documents and Lots sections; document management can
be used with inventory tracking disabled. Upload a PDF and lab/report/test-date,
finalize, download and inspect it, approve review, then explicitly publish if it
should be public. A replacement is a new revision. Brands can download reviewed private reports
only through their own shipped-order view; public sharing still requires publication. Older revisions and shipment
references remain unchanged. Never overwrite a finalized object.

## Opening-stock pilot (operator gate)

1. Run `pnpm --filter @ruostack/api exec tsx src/scripts/coa-migration-report.ts`
   and save its JSON privately. It classifies legacy values without fetching them.
2. Reconcile physical lot labels, units and PDF report references. Receive each
   lot into quarantine; review the linked certificate, then release the lot.
   Returns go into a new quarantined lot, not directly into released inventory.
3. Resolve already-exported open orders before enabling tracking. Record the
   physical count/reconciliation reference and enable ONE SKU in the catalog.
   There is no general off switch that bypasses tracking after activation.
4. In Fulfillment → Lots / COAs, enter the actual packed quantities and confirm.
   Confirmation reserves units; shipment deducts on-hand and reserved atomically.
   Editing or cancelling an order releases reservations. Reships need new lots.
5. Verify A=500/B=200, order12 using A3/B9 → A497/B191, reserved0, one wallet
   capture, exact certificates in portal/store/email, retry unchanged. Verify
   cancellation, recalled stock, replacement revision and expired lot behavior.
6. Obtain warehouse sign-off before expanding to more SKUs.

Unknown-lot shipment callbacks retain tracking and existing wallet behavior but
record a traceability exception. No certificate is invented. Affected SKUs remain
unavailable for new reservations until warehouse evidence resolves the exception.
Use the paged Traceability exceptions list to find older holds, and Affected orders
on a catalog lot to inspect reservations, shipments and amendments.
Record the exact evidenced report revision in Fulfillment → Lots / COAs; reconciliation deducts actual lots
once and writes an audit event. Existing shipped assignments are immutable.
For a mistaken historical assignment, select the corrected lot and record warehouse
evidence using Record correction. This moves the full allocation quantity between
lot balances and appends an immutable amendment; original evidence remains visible.
For a new report covering remaining stock, quarantine the lot, release outstanding
reservations and set its current reviewed certificate. Earlier shipments keep their
original revision. Never edit allocation rows directly.

## WooCommerce rollout and monitoring

Install Shipping plugin 0.2.0 including its `includes/` directory on the staging
store first. Validate its product reference link, authenticated order display,
HTML and plain-text test emails; custom themes must preserve the standard Woo
order item metadata hook. Local rendering fixtures are not a staging-store test.
Do not send real customer email for validation.

Woo line IDs are retained from intake. Duplicate SKUs map by explicit line ID,
not array position. Legacy orders lacking identity require operator reconciliation;
writeback will fail rather than attach a certificate to the wrong line.
Use Reconcile store mapping on a shipment job to verify the originating store and
actual Woo line IDs. The API also verifies remote customer/address, SKU and
quantities. Reconnecting another store never redirects pending old shipment jobs. Only
platform-owned metadata is updated; merchant descriptions are preserved.

The durable worker writes allocation metadata before completing the Woo order.
Retries replace the same metadata (including clearing stale certificate links)
and check a stable shipment marker before appending customer-visible tracking notes.
Stock withdrawal is isolated from certificate metadata failures on other stores.
Tracking activation queues stock reconciliation, and expiry is swept every 30 seconds.
Staging PDF cleanup also runs in the worker, with deletion retries and recorded
completion so a backlog drains across bounded batches.
There are eight automatic attempts with exponential delay (capped at one hour).
Admin Catalog → Certificate store synchronization shows pending/failed jobs and
allows retry after repairing a connection or mapping. Monitor exception counts,
failed jobs, reservation balances and delivery lag. Product stock publication is
in/out only; the shared stock quantity is never cloned into each brand store.

## Recovery and rollback boundaries

Back up the database with the existing provider backup/PITR process, and retain
private Storage objects separately: database backups alone do not restore PDF
bytes. Save migration status, release commit, report counts and deployment logs.
Practice restoration to a separate project; reconcile SHA-256 records against
restored objects before enabling downloads. Do not log service credentials or
signed upload URLs.

Pause affected SKU sales using out-of-stock/quarantine and resolve exceptions.
Do not roll back to application code that ignores enabled SKU lot enforcement.
Keep additive tables and all shipped allocations/movements. Never delete history
or restore inventory balances independently of their movement ledger. Run the
read-only migration report after recovery and reconcile every pilot SKU.

Production opening stock, published PDFs, pilot enablement and warehouse sign-off
must come from the operator. They are intentionally not manufactured by deployment.
