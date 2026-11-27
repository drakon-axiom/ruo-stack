# COA documents and lot traceability — proposed design

Status: proposal for review, not an approved implementation. No runtime or production changes are part of this document.

## Outcome

An operator uploads a certificate, associates it with a product lot and a received quantity, and confirms the lots used to fulfill an order. Brands can view certificates in their portal, and retail customers can open published certificates from their store/order. Historical orders retain the exact certificate revision and lot quantities recorded at shipment.

Example: SKU X has Lot A with 500 units and COA A. An order ships 12 units from A; on-hand becomes 488 and its history records A × 12 with the immutable COA A revision. Another order may ship A × 3 and B × 9, displaying both certificates and quantities.

## Current constraints

- `CatalogProduct.coaId` is a nullable string, not a document relation. The portal renders it as a URL although the editor calls it an ID. API validation permits only 120 characters and does not validate URLs.
- The COA portal claims third-party verification merely because that field is populated.
- There are no stock quantities, lots, shipment allocations, or COA snapshots on order items. Existing stock state is a manual in-stock/out-of-stock toggle; WooCommerce inventory management is disabled.
- ShipStation Custom Store notifications do not currently identify the lot physically picked. Orders have one shipment/tracking state; partial shipments are not modeled.
- Order edits currently delete/recreate items. New allocation references require deliberate handling before that operation.
- Catalog propagation intentionally preserves brand-owned storefront copy. A metadata value alone will not display a COA on WooCommerce; storefront rendering must also be implemented.

## Proposed scope and operating rule

Implement document management first, then lot accounting and fulfillment traceability, then storefront delivery. Keep every stage independently testable and deploy behind controls until its prerequisites exist.

Proposed default pending the user's workflow choice: warehouse staff explicitly confirm the picked lots in RUOStack before the normal ShipStation export/label flow. Automatic oldest-eligible-lot suggestions may assist selection but never assert which lot actually shipped. If an existing warehouse system is authoritative, replace manual confirmation with its explicit lot/quantity feed before enabling enforcement; tracking callbacks alone are insufficient.

One unit means one sellable unit of a canonical SKU (for example one vial or one pack). Do not infer conversions from milligrams or container size. Initial scope supports multiple lots per order line, but not multiple partial shipments, warehouses, or unit conversions. Those require a separately designed shipment/inventory model.

## Data ownership

- `CoaDocument`: logical report associated with a canonical product; report number and laboratory are metadata, not globally unique identifiers.
- `CoaRevision`: immutable PDF object, checksum, size, original filename, recorded test date, uploader, review state, reviewer/time, and publication state. A correction creates a new revision. Review means an operator checked the document; do not claim independent verification that the system has not established.
- `ProductLot`: product, unique product/lot-code pair, received date, optional expiry, current certificate revision, release/quarantine/recall state, and inventory balances. Exhaustion is derived from available stock.
- `LotMovement`: append-only receipt, adjustment, reservation, release and shipment events, each with an idempotency key and actor/reason.
- `OrderLotAllocation`: order item, product lot, positive integer quantity, reservation/confirmation/consumption state, and the certificate revision frozen at confirmation/shipment. Shipped assignments are immutable; corrections are explicit, audited amendments.
- Separate order fulfillment readiness/COA exception state from the existing financial/address/SKU blocker field. Inventory readiness must not accidentally change wallet reservation accounting.

Inventory: available = on-hand − reserved. Reservations do not consume physical stock. Shipment decreases both on-hand and reserved exactly once. Cancellation releases only unshipped reservations. Returns enter quarantine through an explicit receipt/adjustment; never automatically restore sellable units. Prevent negative available/on-hand quantities and overflow. Tracked-SKU availability also respects operator sellability; synchronize in/out-of-stock status to connected stores, without pretending every store owns the full shared quantity. A late store order can wait for inventory, but cannot consume nonexistent stock.

## Documents and visibility

Use a private Supabase Storage bucket, generated object keys, PDF-only uploads (10 MiB maximum), type/signature/size checks, and explicit operator review before publication. Uploaded content is untrusted; serve it as an attachment with restrictive headers rather than injecting it into application HTML. Private downloads use short-lived signed URLs after authorization. Do not fetch arbitrary external URLs on the server.

Catalog COAs are reference documents for released lots. Brand order views are brand-scoped and show the actual allocated lots and quantities. Stable public certificate links expose only explicitly published product/lot/document metadata, never order or customer details. Public links resolve to short-lived file URLs; do not store expiring URLs in WooCommerce.

Replacing a lot's current certificate affects future assignments only. Old orders keep their original revision. Withdrawing a certificate marks it unavailable/withdrawn with an appropriate notice; do not silently redirect old orders to a different report. Recall/quarantine prevents new allocations and identifies affected reservations and past orders.

## Shipment behavior and integrations

Normal fulfillment of tracked SKUs requires complete confirmed allocations and approved/released lots before export. Support mixed-lot order lines. If an external callback reports an already-physical shipment without valid allocation, preserve shipment/wallet truth and open an explicit traceability exception; do not invent a lot or reject the financial event solely to conceal missing traceability.

Commit inventory consumption, allocation snapshots and the local shipment transition together. Keep external storage/store calls outside database transactions. Preserve current wallet-capture idempotency and cancellation race protections. Publish store updates through a durable, retryable job after local commit.

WooCommerce gets stable product reference links and order-item certificate/lot/quantity metadata. Extend the existing RUOStack WooCommerce integration to render the product link and order/email links, with appropriate customer-order access checks and escaping. Do not rewrite merchant-authored descriptions. Installing the updated plugin on connected stores is an explicit rollout dependency. Manual orders use portal share/download actions; new email automation is not required.

## Migration and rollout

Preserve `coaId` as a deprecated legacy reference initially. Classify valid HTTPS URLs versus opaque IDs for operator review; do not invent batches, import files by fetching untrusted URLs, or infer historic quantities. Existing shipments remain explicitly untracked unless verified historical records are supplied.

Roll out document functionality first. Pilot lot tracking on selected SKUs only after verified opening quantities and reviewed COAs exist. Keep existing untracked SKUs working until individually enabled. Validate warehouse confirmation and WooCommerce rendering end to end before broader enforcement. Disable new allocation/export automation during rollback; never erase inventory history or silently reopen tracked stock for unrestricted fulfillment.

## Decisions to confirm before execution

1. Source of actual lot selection: warehouse confirmation (proposed), operator-overridable automatic allocation, or a warehouse-system feed.
2. Confirm that initial scope can keep today's single-shipment-per-order model and one stock location; otherwise extend shipment modeling before inventory work.
3. Which COA fields/files may be public versus brand-only, and who reviews/releases them. Proposed permissions reuse catalog write for document/lot management and fulfillment write for allocation.
4. Confirm the sellable unit represented by quantity and designate an opening-stock reconciliation owner.
