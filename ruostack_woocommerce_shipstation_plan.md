# RUOStack — WooCommerce ↔ ShipStation Integration Plan

*Back-end operations architecture for the RUOStack white-label fulfillment platform. Scope: WooCommerce (the only supported storefront), ShipStation (fulfillment/shipping), prepaid-wallet payments, live shipping rates, and end-to-end sync.*

**Decisions locked:**
1. **Money model:** customer pays the brand via the brand's own WooCommerce gateway; RUOStack only debits the brand's **prepaid wallet** for wholesale + shipping. RUOStack never touches retail revenue.
2. **Shipping:** **live carrier rates routed through RUOStack**, showing the **real service name** so the customer knows what they're buying; price = live carrier rate **+ configurable pick-&-pack fee (default $2.50, hidden)** **+ optional per-brand markup**; automatic **$12.99 flat-rate fallback** (fulfilled as USPS Ground Advantage).
3. **Wallet timing:** **reserve at order import, capture at ship.**
4. **Stock:** RUOStack **pushes availability** into the brand's WooCommerce store.
5. **Single warehouse** (no routing) with a **rules engine** that auto-derives weight → package → service.
6. **No refunds once shipped;** lost/damaged handled via a **Claims** process.

---

## 1. Architecture: hub-and-spoke

RUOStack is the **hub**; WooCommerce and ShipStation are spokes that never talk to each other directly.

```
  Customer ──pays──▶ WooCommerce ◀──REST API + webhooks──▶  RUOStack  ◀──API v2 (+v1 orders)──▶ ShipStation ──▶ Warehouse
  (brand's store, brand's gateway)        │                  (hub)                                  │
                                          └── stock push ◀───┤                                      └── ship-notify ▶ RUOStack
   Brand ──Stripe top-up──▶ RUOStack wallet ──debit (wholesale + shipping)──┘
```

**Why bypass the native ShipStation-for-WooCommerce plugin.** That plugin wires a store straight to ShipStation. We can't use it, because RUOStack must insert three things in the middle: the **wallet debit**, the **retail→wholesale SKU mapping**, and the **brand's return address + branding** on an **operator-owned** ShipStation account/warehouse. It also dodges a known limitation (native plugin leaves Woo orders stuck in *Processing* and doesn't reliably write tracking). RUOStack does the writeback itself.

**ShipStation account model:** **one platform-owned ShipStation account.** Brands are segmented by ShipStation **tag/store** (per-brand packing slips, reporting). Brands never receive ShipStation credentials.

---

## 2. Components to build

| Component | Where | Responsibility |
|---|---|---|
| **Woo Connector** | RUOStack service | REST client + webhook receiver per brand store: order intake, status/tracking writeback, stock push. |
| **RUOStack Shipping Method** | WooCommerce plugin (on brand store) | Custom Woo shipping method that calls `RUOStack /api/shipping/rates` at checkout; renders named services. |
| **ShipStation Connector (adapter)** | RUOStack service | Single adapter wrapping ShipStation **v2** (rates, labels, tracking, webhooks) and **v1** (order create, tags) — see §5. |
| **Rate Service** | RUOStack | Rate proxy: cart→SKUs→parcel, call rates, apply fee/markup, cache, fallback. |
| **Fulfillment Rules Engine** | RUOStack | Auto-derive weight → package/box → service (§6). |
| **Wallet/Ledger** | RUOStack | Reserve/capture/refund vs prepaid balance; holds vs available. |
| **Order Engine + State Machine** | RUOStack | Validation, exceptions, lifecycle. |
| **Sync/Reconcile Worker** | RUOStack | Webhook processing (Woo/ShipStation/Stripe), retries, reconciliation, drift alerts. |
| **Claims** | RUOStack | Lost/damaged case handling (§11). |

---

## 3. WooCommerce ↔ RUOStack

**Connection:** brand generates WooCommerce REST API keys (`ck_`/`cs_`, Read/Write) and pastes them into RUOStack. RUOStack stores them encrypted and **registers webhooks** on the store.

**Inbound — order intake (Woo → RUOStack):** webhook `order.created`/`order.updated` → RUOStack; verify **HMAC signature**; respond `200` fast; enqueue (don't process inline).

**Outbound — writeback (RUOStack → Woo) via REST API:** on ship, set status **`completed`** + attach **tracking # / carrier** (fires the brand's own "shipped" email). On exception, optional private order note.

**Stock push (RUOStack → Woo):** when a RUOStack SKU flips `out_of_stock`/`soon`, set the matched Woo product(s) to out-of-stock/not-purchasable via the alias map; restore on `in_stock`. Prevents selling the unfulfillable.

**Product provisioning (push skeleton or CSV) — SKUs match *by construction*:** instead of fuzzy-matching after the fact, RUOStack seeds the brand's store with products that already carry the **canonical RUOStack SKU**, so order matching becomes a deterministic exact-SKU lookup (aliases below drop to a fallback). From **Catalog → Add to my store**, the brand selects products and provisions them two ways:
- **API push (primary):** `POST /wc/v3/products/batch` with the store keys, creating each product as a **draft** (brand reviews, then publishes). As a live connection it also keeps **platform-owned fields** current later (COA link, weight/dims, stock status).
- **CSV export (fallback):** a WooCommerce Product CSV (native importer format) of the selected products — no write access, fully brand-controlled, but a point-in-time snapshot (no auto-updates). Mind the store weight unit (kg/lb) and public image URLs.

The **skeleton** carries platform-owned fields — **canonical SKU**, name, templated description (with the research-use-only disclaimer), images, category, **weight + dimensions** (also feeds live rates), COA link — with **suggested retail pre-filled as an editable default**. The **brand owns** retail price, custom copy, and the publish decision. Updates are **field-scoped**: RUOStack only rewrites platform-owned fields, **never** the brand's price/copy once set; SKU is treated as **immutable** and any drift is flagged.

**Aliases (the fallback join):** a `ProductAlias` maps a brand's Woo product → your wholesale SKU. With provisioning, most products map by **exact SKU** automatically; aliases only catch the edge cases — brand-renamed SKUs, pre-existing/own products, or partial imports. Unmatched items become **"No Match"** exceptions resolved in the admin **Store-Match Aliases** screen. Set once, reused for every order. The SKU map drives rate weights, fulfillment picking, and stock push.

**SKU scheme & collision handling.** Canonical format `RUO-<COMPOUND>-<DOSE><UNIT>` — uppercase/ASCII/hyphenated, **platform-unique**, **immutable**, and identical across every brand's store (e.g., `RUO-TIRZ-10MG`, `RUO-RETA-10MG`, `RUO-BPC157-5MG`, `RUO-BACWATER-3ML`, `RUO-GLOW-70MG`). One **simple product per sellable unit** (compound+dose) — no Woo variations — to keep a clean 1:1 match. The `RUO-` namespace makes accidental collisions with a brand's own products rare.

**Stable identity = the Woo `product_id`** recorded at creation (in `ProductProvisioning`), **not** the SKU — so re-pushes are idempotent and survive a brand renaming a SKU.

**Pre-flight check** (before any write): for each selected product RUOStack queries the store and classifies it:

| Result | Meaning | Action |
|---|---|---|
| **New** | no provisioning record, SKU absent | **Create** (draft) |
| **Managed** | provisioning record exists (by `product_id`) | **Update** platform-owned fields only |
| **Drifted** | managed product whose SKU was changed | **Flag** → restore canonical SKU, or re-alias to the new SKU |
| **Conflict** | SKU exists on a product RUOStack didn't create | **Never overwrite** — default **Skip + flag**; brand may **Adopt** (claim & manage it, recording its actual SKU as an alias) |

Nothing is written until the brand confirms. **Never auto-suffix** a SKU (e.g., `...-10MG-2`) — that breaks deterministic matching; a non-canonical SKU only exists if the brand opts in, and then its real SKU is captured as a `ProductAlias` so order-time matching still resolves to canonical. WooCommerce enforces store-wide unique SKUs, so the pre-flight turns a would-be import error into a guided choice. (CSV path: the native importer merges on SKU/ID — the export flags detected conflicts and documents that foreign-SKU rows would merge.)

---

## 4. Live shipping rates via RUOStack (the rate proxy)

Goal: live carrier rates at checkout, **named services shown** (so the customer understands what they're paying for), **fee/markup applied**, resilient.

**Flow (synchronous, during checkout):**
1. Customer enters address; WooCommerce calls the **RUOStack Shipping Method**'s `calculate_shipping()`.
2. The method does a server-side `POST {RUOStack}/api/shipping/rates` with: store/brand token, ship-to, and cart line items (Woo product IDs + qty).
3. RUOStack: authenticates the brand → maps items to SKUs (alias) → **Fulfillment Rules Engine** derives weight + package (§6) → calls **ShipStation v2 Get-Rates** for the enabled services → adds **pick-&-pack fee** (default $2.50, configurable, **hidden**) **+ optional per-brand markup** → returns the enabled options.
4. The Woo method renders **named** options, e.g.:
   - *USPS Ground Advantage (2–5 business days) — $9.49*
   - *UPS Ground Saver (1–5 business days) — $9.99*
   - *UPS Ground (1–5 business days) — $12.49*
   - *UPS 2nd Day Air (2 business days) — $24.99*
5. Customer's choice is saved on the Woo order, rides the order webhook into RUOStack, and is used verbatim when creating the ShipStation order/label.

**Enabled services (configurable set; no overnight):**

| Tier | Carrier service | Customer-facing label | Transit |
|---|---|---|---|
| Economy | `usps_ground_advantage` | USPS Ground Advantage | 2–5 biz days |
| Economy | `ups_ground_saver` | UPS Ground Saver | 1–5 biz days |
| Standard | `ups_ground` | UPS Ground | 1–5 biz days |
| Expedited | `ups_2nd_day_air` | UPS 2nd Day Air | 2 biz days |

*(Carrier-name note — resolved: the UPS economy service is **UPS Ground Saver** (renamed from SurePost in April 2025), **not** "UPS Ground Advantage," which doesn't exist — Ground Advantage is a USPS product. **UPS 2nd Day Air stays** as the expedited (2-day) option; "no overnight" = **UPS Next Day Air is excluded**. Heads-up: UPS Ground Saver is contract-only/residential, so it requires a UPS account connected in ShipStation to rate.)*

**Resilience (checkout must never hang on a third party):**
- **Timeout** the ShipStation call at ~2–3s.
- **Cache** rates keyed by `{dest ZIP, weight bucket, service}`, short TTL (10–30 min).
- **Flat-rate fallback: a single $12.99 option** labeled *Standard Shipping (2–5 business days)*, fulfilled as **USPS Ground Advantage**, returned when rates time out/error or a SKU is unmapped/missing weight. Checkout always returns *something*.
- Log fallback events to admin so rate-data gaps get fixed.

**Money math (per order):**
- Customer pays brand = product retail + (carrier rate + pick-&-pack + brand markup). *(brand's gateway)*
- RUOStack debits brand wallet = wholesale product cost + carrier label cost + pick-&-pack.
- ⇒ The **pick-&-pack fee is RUOStack's margin**; **carrier cost is pass-through**; any **per-brand markup is the brand's shipping profit**; the brand's product profit is retail − wholesale.
- The **pick-&-pack fee is never itemized to the customer** — it's baked into the displayed shipping price.

---

## 5. RUOStack ↔ ShipStation (v2-first, v1 only where required)

**Why two API versions.** ShipStation runs two live API generations that are **not at parity**, and their **keys aren't interchangeable**. **v2** is the modern shipping engine — live **Get-Rates**, label purchase, batch/return labels, manifests, and the `fulfillment_shipped`/`track` **webhooks**. v2 has *recently begun* adding order handling (you can create a Shipment with `create_sales_order: true` so it surfaces in the Orders tab), **but** that path is **early-release**, the Sales Order API is gated to **Advanced+ plans**, and Sales Orders are **immutable via API** (only updated on source refresh). So for reliable **order creation + per-brand tags/stores/branded packing slips today**, we use **v1's mature `/orders`**. As v2 order handling matures (and on the right plan tier), we can consolidate to all-v2.

**Approach:** a single **ShipStation Connector adapter** is the only place that knows which version a call uses — **v2 for rates, labels, tracking, and webhooks; v1 only for order create + tags.** Everything else in RUOStack calls the adapter, not ShipStation. When v2 reaches order parity, we swap it in one place. (Note: v1 is gated to Standard/Accelerate+ plans and is slated for eventual deprecation — the adapter is what protects us from that.)

**Order creation (RUOStack → ShipStation, v1):** once validated + funds reserved, create the order with ship-to, **ship-from = brand's return address**, line items mapped to **wholesale SKUs**, **requested service** (customer's selection), **package** (from rules engine), **brand tag/store**, and flags (e.g., COA insert).

**Warehouse:** picks/packs, **applies brand white-label vial labels** (RUOStack supplies artwork — a warehouse SOP), inserts COA if configured, buys the label, ships. Outer packaging plain/discreet.

**Inbound — ship-notify (ShipStation → RUOStack, v2 webhooks):** subscribe to `fulfillment_shipped` (ship) and `track` (delivery). On the event, GET the `resource_url` for **tracking #, carrier, service, actual label cost** → **capture** the wallet debit (§7), mark **Shipped**, write tracking back to Woo. `track` advances to **Delivered**.

---

## 6. Fulfillment Rules Engine (single warehouse, auto service/package/weight)

No routing (one warehouse), but everything else is rule-derived so ops doesn't hand-pick boxes or services. All rules are **admin-configurable** (no code deploy to change a threshold).

**Weight rule:** `order_weight = Σ(sku.weight × qty) + box.tare`. Billable weight = `max(actual, dimensional)` where dimensional = `(L×W×H)/divisor` of the selected box.

**Package/box rule:** a **Box catalog** (`id`, inner L×W×H, max_weight, tare). The engine picks the smallest box that fits by item count/volume and weight. Start simple and configurable — e.g., 1–3 vials → bubble mailer, 4–8 → small box, 9+ → medium box — and refine to volumetric later.

**Service rule:** a **ServiceMapping** lists enabled carrier services per tier with eligibility (max weight, domestic-only) and a selection policy. The customer picks a **named service** at checkout; the engine validates eligibility and, where a tier maps to multiple carriers, can **least-cost-select** within that tier. Cold cases (over-weight for a service, etc.) fall back to the next eligible service or the flat fallback.

**When it runs:** twice — at **rate-time** (derive package+weight to quote each enabled service) and at **order-create** (lock the package + service onto the ShipStation order/label).

---

## 7. Payment & wallet (reserve → capture)

Two independent money layers — keep them separate in code and ledger.

**Layer 1 — retail (customer → brand):** entirely inside WooCommerce via the brand's own gateway. RUOStack does **not** process/hold/remit it. (Keeps RUOStack out of retail payment-processor / money-transmitter scope.)

**Layer 2 — fulfillment cost (brand → RUOStack):** the prepaid wallet.
- **Top-up:** brand funds via **your Stripe** (Checkout); Stripe webhook credits the ledger (§9). Deposits non-refundable / non-withdrawable.
- **Reserve at import:** on validation, place a **hold** = wholesale + quoted shipping (RUOStack generated the quote, so it's exact). Holds reduce *available* balance, preventing double-spend across concurrent orders.
- **Insufficient funds:** order parks as **Awaiting Funds** (Exception); auto-releases on top-up.
- **Capture at ship:** on ship-notify, capture = wholesale + **actual** label cost + pick-&-pack; settle against the hold and book the small delta.
- **Cancel before ship:** release the hold. **No refund once shipped** — post-ship issues go through Claims (§11).

**Ledger types:** `deposit`, `hold`, `hold_release`, `capture`, `refund_credit`, `referral_credit`, `manual_adjustment`. `available = settled − active_holds`.

---

## 8. Data model additions

On top of existing entities (Brand, Product, Order, OrderItem, Customer, WalletTransaction, StoreConnection, COA…):

**Product** (+shipping) — `weight`, `length/width/height`, `packaging_rule`.
**ProductAlias** — `brand_id`, `woo_product_id`, `woo_sku`, `ruostack_sku`, `confidence`, `status` (mapped/unmapped). Set in admin **Store-Match Aliases**; auto-suggested on connect.
**ProductProvisioning** — `brand_id`, `ruostack_sku`, **`woo_product_id` (stable identity)**, `method` (api/csv), `status` (draft/published), `conflict_status` (none/drifted/conflict/adopted), `managed_fields[]`, `last_pushed_at`. Tracks products RUOStack seeded + which fields it keeps in sync; matching keys on `woo_product_id`, not SKU.
**Box** — `id`, `inner_l/w/h`, `max_weight`, `tare`. Box catalog for the rules engine.
**ServiceMapping** — `tier`, `carrier_service_code`, `display_label`, `transit_estimate`, `max_weight`, `enabled`, `selection_policy`.
**RateQuote** — `id`, `brand_id`, `cart_hash`, `dest`, `service`, `carrier_cost`, `pickpack_fee`, `brand_markup`, `customer_price`, `box_id`, `weight`, `expires_at`.
**Shipment** — `order_id`, `carrier`, `service`, `tracking_number`, `label_cost`, `status`, `shipped_at`, `delivered_at`, `exception`.
**WalletHold** — `order_id`, `amount`, `status` (active/released/captured).
**Claim** — `order_id`, `brand_id`, `type` (lost/damaged/missing_item/not_received), `status`, `resolution`, `carrier_claim_id`, `amount`, `photos[]`, `opened_at`, `sla_due_at` (§11).
**WebhookEvent** — `source` (woo/shipstation/stripe), `external_id`, `type`, `payload`, `status`, `attempts`, `processed_at` (idempotency + retry).
**BrandShippingConfig** — `brand_id`, `pickpack_fee_override`, `markup`, `enabled_services[]`.

---

## 9. Sync & consistency

**Source-of-truth map:**

| Entity | Source of truth | Propagates to |
|---|---|---|
| Order intake (customer, items) | WooCommerce | RUOStack |
| Fulfillment state | RUOStack | WooCommerce (status), brand |
| Tracking # | ShipStation | RUOStack → WooCommerce |
| Wallet / subscription | RUOStack (driven by Stripe) | authoritative |
| Catalog stock | RUOStack | WooCommerce (push) |
| Shipping rate quote | RUOStack (proxying ShipStation) | WooCommerce checkout |

**Mechanism: webhooks first, polling as backstop.**

- **Woo webhooks:** `order.created/updated` → intake.
- **ShipStation webhooks (v2):** `fulfillment_shipped` → capture + ship; `track` → delivery status.
- **Stripe webhooks** (the authoritative money triggers — RUOStack never trusts a client "success," it waits for these):
  - *Wallet:* `checkout.session.completed` / `payment_intent.succeeded` → credit ledger (`deposit`); `payment_intent.payment_failed` → notify, no credit.
  - *Billing:* `invoice.paid` → membership active/renewed; `invoice.payment_failed` → **dunning** (past-due → retry → suspend Pro features); `customer.subscription.updated/deleted` → status.
  - *Disputes/refunds:* `charge.refunded`, `charge.dispute.created/closed` → ledger adjust + flag.
- **Idempotency:** dedupe every inbound event by `(source, external_id)` (incl. Stripe event IDs); processing is replay-safe; verify signatures (Woo HMAC, Stripe signature, ShipStation auth).
- **Retries:** failed processing → exponential-backoff queue → **dead-letter** surfaced in admin **Exceptions**.
- **Reconciliation worker** (~10–15 min): compare recent Woo orders + ShipStation shipments + Stripe events to RUOStack; heal missed webhooks; flag drift (e.g., shipped-but-not-captured).
- **Health:** per-brand `last_sync_at`/`sync_status` in admin; webhook-failure alerts.

---

## 10. End-to-end order lifecycle

| # | Event | System | RUOStack action |
|---|---|---|---|
| 0 | Brand funds wallet | Stripe | credit ledger (`deposit`) |
| 1 | Customer pays at checkout | WooCommerce | retail — not touched |
| — | Rate shown at checkout | Woo→RUOStack→ShipStation v2 | rules engine derives weight/box; quote = live rate + fee (+markup); **named services**; persist RateQuote |
| 2 | `order.created` webhook | Woo→RUOStack | verify HMAC, enqueue |
| 3 | Validate | RUOStack | map SKUs; check address/customer; **reserve** wallet. Fail → Exception (No-Match / Needs-Info / Awaiting-Funds) |
| 4 | Create order | RUOStack→ShipStation v1 | push ship-to, ship-from=brand, items (wholesale SKUs), selected service, package (rules engine), brand tag |
| 5 | Pick/pack/label/ship | Warehouse/ShipStation | apply brand vial labels + COA insert; buy label |
| 6 | `fulfillment_shipped` | ShipStation v2→RUOStack | pull tracking + **actual** label cost |
| 7 | Capture | RUOStack | **capture** wallet (wholesale + actual ship + pick-&-pack); settle hold |
| 8 | Writeback | RUOStack→Woo | status `completed` + tracking → brand's shipped email |
| 9 | `track` updates | ShipStation v2→RUOStack | advance to **Delivered** |

**Order states:** `received → validating → (exception) → ready_for_fulfillment → processing → shipped → delivered`; plus `held`, `cancelled`, `claim_open`.

---

## 11. Claims (lost / damaged) — no refunds once shipped

Because there are **no customer refunds once an order ships** (the wallet is already captured and the brand already collected retail), post-ship problems are handled as **Claims**, not refunds. This protects platform margin while giving brands a clear remedy path.

**Claim types:** `lost` (no delivery / stalled tracking), `damaged`, `missing_item`, `item_not_received` (delivered-but-not-received), `wrong_item`.

**Who opens it:** the **brand** (from their dashboard, against a specific order) or **Support** on their behalf. Captured in the `Claim` entity (§8).

**Eligibility windows (configurable):** e.g., `damaged` reported within **5 days** of delivery with **photos**; `lost` opened only after tracking shows **no movement for N days** (or shows "delivered" but the customer disputes). Outside the window → not eligible.

**Flow:**
1. Open claim → attach evidence (photos for damage; tracking state for lost).
2. RUOStack triages (auto-pulls the ShipStation shipment + tracking).
3. Where the carrier is liable, **file a carrier claim** (USPS/UPS) against the label's insured/declared value.
4. **Resolution** (operator decision): **reship**, **wallet credit**, or **deny** — each reason-coded and audit-logged.
   - *Reship* = a new $0-retail fulfillment order; **who pays** (platform comp vs brand wallet) depends on fault (carrier vs brand-supplied bad address).
   - Carrier reimbursement, if any, offsets the platform's cost.

**Admin:** a **Claims queue** (Super Admin / Operations) with states `open → investigating → carrier_filed → resolved (reshipped | credited | denied)` and an SLA timer.

**Lost/damaged rules to finalize:**
- **Insurance posture:** insure shipments by default (ShipStation/carrier declared value) vs self-insure on cheap parcels — drives who absorbs loss.
- **Fault matrix:** carrier-fault (reship at platform cost) vs brand-fault bad address (re-fulfill at brand's wallet) vs customer-fault.
- **Evidence + windows** per claim type (defaults above).
- **Auto-approve threshold** for small claims vs manual review.

---

## 12. Configuration — resolved settings

| # | Setting | Decision |
|---|---|---|
| 12.1 | **Pick-&-pack fee** | Default **$2.50**, **configurable** (global default + per-brand override via `BrandShippingConfig`). **Hidden from the customer** — baked into the displayed shipping price, never itemized. |
| 12.2 | **Service tiers** | **Economy** (USPS Ground Advantage, UPS Ground Saver) · **Standard** (UPS Ground) · **Expedited 2-day** (UPS 2nd Day Air). **No overnight** — UPS Next Day Air excluded. |
| 12.3 | **Per-brand shipping markup** | **Enabled** (optional, default $0). When set, it's the brand's shipping profit on top of carrier + pick-&-pack. |
| 12.4 | **Refunds** | **None once shipped.** Lost/damaged handled via **Claims** (§11); insurance + fault rules to finalize. |
| 12.5 | **Split shipments** | **Hold** — the full order waits until every line is fulfillable (no partials). |
| 12.6 | **Warehouse / routing** | **Single warehouse, no routing.** Rules Engine auto-derives **weight → package → service** (§6). |

---

## 13. Failure modes & edge cases

- **ShipStation rates down at checkout** → $12.99 flat fallback (USPS Ground Advantage). Checkout never blocks.
- **Unmapped product (No-Match)** → rate uses fallback; order → Exception until the alias is set, then released.
- **Insufficient wallet at import** → Awaiting Funds; nudge brand; auto-release on top-up.
- **Actual label cost ≠ quote** (weight/box differs in-warehouse) → capture actual; book delta; alert over a threshold.
- **Missed webhook** → reconciliation worker heals within the poll window; idempotency no-ops duplicates.
- **Order edited/cancelled in Woo before ship** → release hold; cancel the ShipStation order.
- **Invalid address** → ShipStation validation flags → Exception (Needs Address).
- **Post-ship problem** → Claims (§11), never an auto-refund.

---

## 14. Build sequence

**Phase 1 — order pipe + provisioning.** Woo connector (keys, webhooks, HMAC, intake) → **product provisioning** (Catalog → Add to my store: API push as draft + CSV export, canonical SKUs) → SKU aliases (fallback) → wallet reserve/capture ledger + Stripe top-up webhooks → ShipStation v1 order create + v2 ship-notify → tracking writeback → state machine + Exceptions. Ship with the **$12.99 flat fallback** only (no live rates yet).

**Phase 2 — live rates + rules engine.** RUOStack Shipping Method (Woo plugin) → `/api/shipping/rates` proxy → ShipStation v2 Get-Rates → fee/markup/relabel/cache/fallback → catalog weights/dims + Box catalog + ServiceMapping → quote-driven reserve.

**Phase 3 — hardening, sync, claims.** Reconciliation worker → stock/availability push to Woo → Stripe billing/dunning → Claims queue + carrier-claim filing → admin Store-Integrations / Exceptions / Claims dashboards → reporting (label-cost vs charge, fallback rate, SLA).

---

*Reflects the 2026-06-10 working session + follow-ups. WooCommerce is the only supported storefront. Grounded against ShipStation API v2 (Get-Rates, `fulfillment_shipped`/`track` webhooks) + v1 (`/orders`, tags) and the WooCommerce REST API.*
