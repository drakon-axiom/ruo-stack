# COA and Lot Traceability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect trustworthy COA records to products, physical lots, quantities and shipped orders, and display the appropriate certificates in the brand portal and WooCommerce.

**Architecture:** Private, versioned certificate storage; lot inventory with append-only movements and transactional allocations; immutable shipment-to-certificate references. Publish customer-facing links through explicitly public certificate routes and a retryable WooCommerce integration.

**Tech Stack:** Existing TypeScript/Fastify API, Prisma/PostgreSQL, React portals, Supabase Storage, ShipStation Custom Store integration and WooCommerce PHP plugin.

**Spec:** `docs/superpowers/specs/2026-11-24-coa-lot-traceability-design.md` (proposed; workflow decisions must be settled before execution).

## Global Constraints

- One unit means one sellable unit of a canonical SKU. No implicit mass/pack conversion.
- Initial scope supports multiple lots per order line, but one shipment per order and one stock location. Confirm this operational assumption before implementing inventory.
- Never infer the physical lot from a tracking callback or the product's current certificate.
- Existing money/address/SKU blocker behavior and wallet idempotency must remain intact.
- Published PDF revisions and shipped allocations are immutable. Corrections are new revisions/audited amendments.
- No automatic historical lot or quantity backfill. No server-side fetch of arbitrary legacy URLs.
- PDF uploads: maximum 10 MiB, private storage, generated keys, checked content/type/size, reviewed before publication.
- Public certificate routes expose no order/customer data. Tenant authorization is required for order-specific views.
- No external provider I/O while holding business database locks.
- Preserve unrelated user files. All mutation/race/migration tests use disposable PostgreSQL, never production.

## Review Focus

- Order edits currently replace item IDs: allocations must be released before item deletion; shipped references must survive. Cover in Task 5.
- Missing lot information on a real shipment: record truth and an explicit exception without inventing traceability or double-capturing money. Cover in Task 5.
- Certificate withdrawal or recall after publication: stop new use without rewriting historical shipment evidence. Cover in Tasks 2, 4 and 6.
- A WooCommerce metadata field does not render itself: demonstrate actual product/order/email links using the updated plugin. Cover in Task 7.
- Legacy opaque IDs, long links, multiple lots, and quantity contention: never manufacture provenance or oversell. Cover in Tasks 1 and 4.

## Delivery sequence

A. Tasks 1–3: usable COA document management and truthful portal display.
B. Tasks 4–6: pilot lot quantities and confirmed shipment traceability.
C. Task 7: end-customer storefront/order/email delivery.
D. Task 8: migration, reconciliation and wider rollout.

Do not enable lot enforcement globally when only document management is ready.

### Task 1: Correct the existing field and claims; preserve legacy data

**Files:** `apps/admin-web/src/screens/Catalog.tsx`, `apps/brand-web/src/screens/Coas.tsx`, `apps/brand-web/src/components/welcomeSlides.ts`, `packages/shared/src/dto.ts`, `packages/shared/src/catalog-import.ts`; new `packages/shared/src/coa.ts` and focused portal/API tests.

**Interfaces:** Produce `classifyLegacyCoa(value: string | null): { kind: 'url' | 'reference' | 'empty'; value: string | null }`. URL links accept HTTPS only, with a 2,048-character limit for new URL inputs. Legacy plain IDs remain text references, never hrefs. Keep current API/CSV field compatibility during migration.

- [ ] Write failing tests: `COA-123` is displayed as a reference, not a link; a 500-character valid HTTPS URL is supported; `javascript:`/`data:`/credential-bearing URLs are rejected as links; no value produces a verification claim; failed portal loads show retry.
- [ ] Run focused tests and verify failures before changing implementation.
- [ ] Clarify editor labels/help, remove unconditional “Third-party verified” and “Every product” copy, and distinguish legacy references from safe links. Validate new URL inputs without rejecting preservation of old opaque IDs.
- [ ] Run API/shared/UI tests and typecheck; commit independently.

### Task 2: Add versioned certificate storage and review/publish APIs

**Files:** `packages/db/prisma/schema.prisma`; new next-numbered migration (determine number at execution); new `apps/api/src/services/coa-documents.ts`, `apps/api/src/routes/admin-coas.ts`, `apps/api/test/integration/coa-documents.test.ts`; `apps/api/src/app.ts`, `packages/shared/src/coa.ts`, audit-action definitions, deployment storage setup/runbook.

**Interfaces:** `createCoaUpload(actor, { productId, filename, sizeBytes }): Promise<{ revisionId, uploadUrl }>`; `finalizeCoaUpload(actor, revisionId)`; `reviewCoaRevision(actor, revisionId, decision)`; `publishCoaRevision(actor, revisionId)`. Every operation checks catalog permissions. Signed file downloads expire after 5 minutes. Define DTOs once in shared code.

- [ ] Write failing tests for authorization, cross-product association, file size >10 MiB, wrong file signature/type, missing object, finalized-content checksum, unreviewed publication, immutable published object keys, and failed upload cleanup/retry.
- [ ] Implement document/revision tables, private bucket policies, upload-finalization checks, review/publication transitions and audit records. Bucket must deny anonymous listing/writes; the service role is API-only. Use SHA-256 content integrity and unique object keys; reuploading creates a new revision.
- [ ] Add a storage adapter seam for tests; finalize only when the actual stored object matches the upload contract. Provide orphan-object cleanup that cannot delete referenced objects.
- [ ] Replay migration and prove storage/permission boundaries with disposable fixtures; run focused tests and typecheck; commit.

### Task 3: Build the admin COA manager and product associations

**Files:** new `apps/admin-web/src/screens/catalog/ProductCoas.tsx`, `apps/admin-web/src/screens/catalog/CoaUpload.tsx`, portal tests; modify `apps/admin-web/src/screens/Catalog.tsx` and `apps/api/src/routes/admin-catalog.ts`.

**Interfaces:** Consume Task 2 DTOs. Product drawer exposes certificate list, report/lab/test-date metadata, file upload, review, publish/withdraw, and revision history. Review and public publication are separate explicit actions.

- [ ] Write UI tests for upload/finalization failure/retry, read-only roles, review required before publish, revision replacement and stale response suppression.
- [ ] Add the manager without further enlarging the catalog screen monolith. Show actual statuses: draft, awaiting review, reviewed, published, withdrawn. Do not represent operator review as independent lab validation.
- [ ] Validate with mocked storage and API tests, accessible controls and production build; commit. Document management may now be piloted independently of inventory.

### Task 4: Add lots, receiving, inventory movements and reservation primitives

**Files:** next schema migration; new `apps/api/src/services/lot-inventory.ts`, `apps/api/src/routes/admin-lots.ts`, `apps/admin-web/src/screens/catalog/ProductLots.tsx`, `apps/api/test/integration/lot-inventory.test.ts`; shared lot DTOs and audit actions.

**Interfaces:** `receiveLot(tx, input, actor, idempotencyKey)`, `adjustLot(tx, lotId, delta, reason, actor, idempotencyKey)`, `reserveLots(tx, orderId, allocations, actor, idempotencyKey)`, `releaseLotReservations(tx, orderId, actor, idempotencyKey)`. Allocation input is `{ orderItemId, lotId, qty }[]`; quantities are positive whole SKU units. Available/on-hand/reserved must fit database integer limits.

- [ ] Write failing real-DB tests: receive 500 → reserve 12 → available 488/on-hand 500; release restores availability; two competing 300-unit reservations cannot both succeed; same idempotency key does not double-receive; reused key with different input returns conflict; wrong product, quarantined/recalled lot, missing approved COA, negative counts and overflow are rejected.
- [ ] Implement lot and append-only movement tables, balance constraints, atomic conditional updates/row locks, release/recall and explicit stock adjustment reasons. Preserve prior movements on corrections. Product/lot identity is immutable after use. For tracked SKUs, availability requires both operator sellability and released, eligible unreserved stock; a manual in-stock toggle cannot bypass exhausted/quarantined inventory.
- [ ] Add receiving/adjustment UI with received, on-hand, reserved, available and shipped quantities. Certificate revision must match the canonical product. Derive exhaustion rather than manually setting it.
- [ ] Test recalled reserved lots, expiry boundaries (if expiry policy is enabled), and reconciliation of balances against movements. Commit after DB tests/typecheck pass.

### Task 5: Integrate lot selection with every order lifecycle path

**Files:** new `apps/api/src/services/order-lots.ts`; `apps/api/src/services/order-edit.ts`, `apps/api/src/routes/brand-orders.ts`, `apps/api/src/services/store-intake.ts`, `apps/api/src/services/claims.ts`, `apps/api/src/routes/admin-fulfillment.ts`, `apps/api/src/routes/shipstation-custom-store.ts`, `apps/admin-web/src/screens/Fulfillment.tsx`; new allocation/race tests.

**Interfaces:** `confirmOrderLots(tx, orderId, allocations, actor, idempotencyKey)`; `consumeConfirmedOrderLots(tx, orderId, shipmentKey)`; `getOrderLotReadiness(tx, orderId)`. Separate readiness values: untracked, needs_allocation, needs_confirmation, ready, exception. Snapshot certificate revision, lot code and SKU identity; no link to a mutable current-certificate value for historical display.

- [ ] Map the actual transaction/lock order for edit, cancellation, wallet reservation, manual ship, ShipStation shipnotify and reship before adding locks. Keep wallet capture after the shipment commit where it already runs. All multi-lot locks use deterministic ID ordering; inventory-only operations must not introduce a reverse dependency on wallet locks.
- [ ] Write failing tests for split lots (A ×3 + B ×9 fulfills qty12), insufficient stock, invalid quantities, duplicate callbacks, cancel/ship races, order edits replacing item IDs, duplicate order intake, stale confirmations, recalled stock and reship orders. Reship orders allocate their own stock; they do not inherit the original shipment's COA by assumption.
- [ ] Reserve only when an order is released for fulfillment (not indefinitely for unfunded/unmapped orders). Warehouse confirms selected physical lots. For enabled SKUs, gate normal ShipStation export on complete confirmation; preserve existing blocker precedence and funding calculations.
- [ ] Release unshipped allocations before destructive item edits and cancellation, in the same local transaction; re-evaluate/reallocate revised items. Shipped allocations cannot be deleted by edits. Consume lots once within the gated shipment transition. Explicitly amend historical mistakes instead of overwriting them.
- [ ] For unexpected physical shipments lacking confirmation, persist tracking/current wallet semantics and a traceability exception; publish no fabricated certificate assignment. Add an exception-resolution screen and audit trail. For pre-shipment manual actions, require confirmation normally.
- [ ] Run all affected order, wallet, claims, shipping and concurrency tests, then typecheck/build and commit.

### Task 6: Show the right certificates in the portal and safe share pages

**Files:** new `apps/api/src/routes/brand-coas.ts`, `apps/api/src/routes/public-coas.ts`; `apps/api/src/routes/brand-orders.ts`, `apps/api/src/routes/admin-fulfillment.ts`, `apps/brand-web/src/screens/Coas.tsx`, `apps/brand-web/src/screens/Orders.tsx`; new focused certificate/order components and access tests.

**Interfaces:** `GET /api/brand/coas` (paged product/lot reference library); `GET /api/brand/orders/:id/coas` (brand-scoped shipped allocations); `GET /coa/:publicId` (published certificate metadata/download only); `GET /coa/products/:publicId` (published product reference page listing eligible lot certificates). Public IDs are opaque, stable per revision and revocable; no order/customer fields in URLs or responses.

- [ ] Write failing tests for cross-brand order access, draft/private files, withdrawn reports, split-lot quantities, stable historical revision after replacement, legacy untracked orders, and expiration of signed storage URLs.
- [ ] Replace the current COA screen with product/lot/report/date/status filters, View/Download/Copy link actions and explicit “reference” versus “shipped with this order” context. Order details show exact lot quantities only after confirmation/shipment; unresolved shipments display the exception.
- [ ] Publish only operator-approved public documents; preserve historical withdrawn markers rather than silently substituting files. Add pagination, loading/retry and stale-response handling.
- [ ] Verify permissions and share routes with synthetic data; run UI/API tests and build; commit.

### Task 7: Connect WooCommerce product, order and email displays

**Files:** `apps/api/src/services/store-provision.ts`, `apps/api/src/services/woo.ts`, `apps/api/src/hooks/order-shipped.ts`; new durable COA-writeback job service/table and worker integration; `integrations/woocommerce/ruostack-shipping/ruostack-shipping.php` plus dedicated PHP include files and README; integration fixtures/tests.

**Interfaces:** Platform-owned product metadata `_ruostack_coa_url` points to a stable published product-reference page; order-item `_ruostack_coa_allocations` contains `{ lot_code, qty, certificate_url }[]` from shipped snapshots. Map Woo order line IDs explicitly to canonical items, including duplicate SKU lines; never assume array position identifies an item.

- [ ] Write failing tests for actual product-page rendering, customer-order/email links, escaping/untrusted metadata, duplicate SKU order lines, split lots, unchanged merchant descriptions, withdrawn links, store downtime and idempotent retries.
- [ ] Extend the existing WooCommerce plugin to render the metadata on the appropriate product/order/email hooks. Product reference links must not imply that every listed lot shipped in an order. Respect Woo customer-order access checks; do not expose private order data through public certificates.
- [ ] Persist writeback jobs with idempotency keys in the local shipment/document-publication transaction; call Woo only after commit. Add bounded retries, operator-visible failures and reconciliation. Reuse `apps/api/src/hooks/catalog-stock.ts` to publish tracked-SKU in/out-of-stock changes from eligible availability; do not replicate the full shared stock count independently into every brand store. Third-party checkout is not a distributed inventory transaction: orders arriving after stock exhaustion wait for stock and never consume nonexistent lots. Install/update the plugin on pilot stores before claiming customer visibility.
- [ ] Verify against a staging WooCommerce store and synthetic orders/emails; do not send real customer mail for tests. Run PHP syntax checks, rendering tests and API integration tests; commit.

### Task 8: Reconcile data and roll out gradually

**Files:** new `apps/api/src/scripts/coa-migration-report.ts`, `docs/operations/coa-lot-rollout.md`, deployment configuration and feature controls. Reuse the existing guarded deployment process.

**Interfaces:** A read-only report classifies every legacy `coaId` without reading/downloading remote content and lists products lacking reviewed documents/opening lot balances. Controls enable document UI and per-SKU lot tracking independently; do not hide enforcement behind a UI-only flag.

- [ ] Write tests proving legacy IDs remain references, existing shipped orders remain explicitly untracked, disabled SKUs retain current behavior, and enabled SKU enforcement cannot be bypassed by manual/ShipStation/reship paths.
- [ ] Operator reconciles real opening quantities, verifies lot labels against PDFs and chooses public documents. Seed only explicitly reviewed mappings; no invented stock, lots or historical certificate assignments.
- [ ] Run all offline and affected disposable-DB tests, build/typecheck, independent security/concurrency review, migration replay, upload/download permission tests and a staging fulfillment/store smoke flow. Resolve important findings before production.
- [ ] Deploy additive schema/storage setup, then document UI, then a selected-SKU warehouse pilot, then storefront plugin/writeback. Verify initial receipt, mixed-lot shipment, quantity deduction, cancellation, retry and historical certificate stability end to end.
- [ ] Expand only after inventory reconciliation and warehouse sign-off. Record deployment hashes, counts, migration status, exception monitoring, backup/restore procedure and rollback boundaries. Never delete shipped allocations as a rollback technique.

## Acceptance example

Receive Lot A = 500 units with COA A; receive Lot B = 200 with COA B. Fulfill one 12-unit order using A ×3 and B ×9. Verify remaining on-hand A=497/B=191, no residual reservation, one financial capture, two correct certificates in the brand order and retail order/email, and unchanged historical documents after uploading a replacement revision. Retry the shipment event: every quantity and charge remains unchanged.

## Implementation gate

This is a proposed plan, not a deployment request. Confirm the warehouse lot-selection source, single-shipment scope, quantity unit and publication permissions before starting schema/fulfillment implementation. If those answers differ, revise Tasks 4–7 first. No application code, production data or deployment has been changed in preparing this plan.
