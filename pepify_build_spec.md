# Pepify — Build Spec / Blueprint

*A reusable product specification reverse-engineered from pepify.pro (white-label fulfillment platform). Captured from a live logged-in brand account on 2026-06-10. This is the buildable blueprint — pair it with `pepify_screen_teardown.html` for the visual screen catalog.*

> **Reusing this for a different industry:** the platform is essentially a **white-label dropshipping + prepaid-wallet fulfillment OS**. Nothing about the architecture is peptide-specific. Swap the product catalog, the "COA / lab verification" trust layer, and the compliance copy for your industry's equivalents, and the rest of the system transfers directly.

---

## 1. What the platform is (one paragraph)

A brand owner signs up, pays a flat **monthly membership**, connects their own online store (or submits orders manually), and pre-funds a **prepaid wallet**. Their customers buy on the brand's own storefront and pay the brand directly. The platform fulfills each order under the **brand's own label** (white-label), and automatically deducts the wholesale product cost + flat shipping from the wallet. The brand keeps the spread. The platform never touches the brand's customer revenue — it only collects membership + wallet top-ups.

---

## 2. Actors & roles

| Actor | Description |
|---|---|
| **Brand owner (primary user)** | Runs a storefront; the only logged-in role in the app. Has a brand identity (name + logo). |
| **End customer** | Buys on the brand's store. Never logs into the platform; exists as a Customer/Address record. |
| **Platform operator (admin)** | Back office: manages catalog, stock, fulfillment, announcements, support, COAs. *(Admin UI not user-visible; inferred.)* |
| **AI/Human support agent** | Live-chat assistant with human escalation; framed as a "dedicated account rep". |

---

## 3. Business / monetization model

- **Membership:** flat **$97/mo "Pro"** (price-anchored as "raising to $200"). Gates wholesale pricing + fulfillment. Billed via Stripe; "no contracts, cancel anytime".
- **Wholesale margin:** each SKU has a `wholesale_cost` and `suggested_retail`; the brand sets its own retail and keeps the difference.
- **Flat shipping:** **$12.95/order** (USPS Ground Advantage), passed through.
- **Prepaid wallet float:** deposits are **non-refundable / non-withdrawable** (refunds credit back to wallet only).
- **Referral loop:** $50 wallet credit to referrer + $50 welcome bonus to referee upon Pro upgrade.
- **Break-even framing** is sold explicitly (membership ÷ per-order profit ≈ orders needed/mo).

---

## 4. Information architecture / sitemap

```
PUBLIC (light theme)
├── /                     Landing (hero, how-it-works, catalog carousel, wallet,
│                         interactive profit calc, pricing, testimonials, FAQ, footer)
├── /onboarding           Create account (accepts ?ref=CODE)
├── /login
└── /forgot-password

APP (dark theme, SPA behind /dashboard)
├── CORE
│   ├── Overview          KPIs, sync health, charts, gamification, announcements, get-started checklist
│   ├── Orders            KPIs + status tabs + search + table; "New Manual Order" drawer
│   ├── Tracking          shipment KPIs + search + live carrier tracking
│   ├── Action Required   Orders filtered to blockers (Needs Address / Customer Info / Awaiting Funds)
│   ├── Customers         customer KPIs (LTV, retention) + list
│   ├── Address Book      saved customers + "Add Customer" drawer; powers order auto-fill
│   └── Wallet            prepaid balance, spend KPIs, ledger; "Add Funds" modal (Stripe)
├── STORE
│   └── My Store          connect WooCommerce / Wix, or manual; API-key form + sync rules
├── CATALOG
│   ├── Research Peptides  wholesale price sheet (cost / retail / margin / status)
│   └── COAs              third-party lab certificates, copy-link/view per product
├── BRAND & TOOLS
│   ├── Branding          logo upload → printed on labels
│   ├── Shipping          return-address form, carrier info, fulfillment explainer
│   └── Profit Calculator interactive per-order P&L + projections table
├── SUPPORT
│   ├── Live Chat         AI chat + human escalation
│   ├── Referrals         code + share link + referral KPIs
│   └── Account           profile, email, password, subscription, gamification
└── GLOBAL
    ├── Notifications Inbox  filterable feed (Orders / Announcements / Order Notes / Issues)
    └── Top bar             theme toggle, notifications, profile menu, dismissible "tips" banner
```

---

## 5. Data model (core entities)

> Suggested relational schema. Names are illustrative.

**Brand / User** (1:1 in current app)
- `id`, `full_name` (editable once / 7 days), `email`, `password_hash`
- `brand_name` ("Research Company Name"), `logo_url`, `website`, `sales_channel`
- `subscription_status` (none / pro), `stripe_customer_id`, `member_since`
- `referral_code`, `referred_by`
- `wallet_balance` (or derive from ledger), `daily_goal_target`
- gamification: `profile_completeness`, `achievements[]`, `goal_streak`, `best_day`

**Product (SKU)**
- `id`, `name`, `size_variant` (e.g. "5mg"), `wholesale_cost`, `suggested_retail`
- derived: `est_margin_pct`, `est_profit`, `est_total_cost` (= cost + shipping)
- `status` (in_stock / soon / out_of_stock), `coa_id` (nullable), `category`
- *(Catalog had 36 active SKUs across ~25 product families with size variants.)*

**Order**
- `id`, `brand_id`, `customer_id`, `source` (manual / woocommerce / wix), `external_order_id`
- `status` (ready_for_fulfillment → processing → shipped → delivered)
- `blocker` (none / needs_address / needs_customer_info / awaiting_funds)
- `wholesale_total`, `shipping_total`, `wallet_charge`, `created_at`
- `tracking_number`, `carrier`, `shipped_at`, `delivered_at`

**OrderItem** — `order_id`, `product_id`, `qty`, `unit_wholesale_cost`

**Customer** — `id`, `brand_id`, `name`, `email`, `lifetime_value`, `first_order_at`
**Address** — `customer_id`, `street`, `apt`, `city`, `state`, `zip`, `phone` (auto-fill source)

**WalletTransaction** — `id`, `brand_id`, `type` (deposit / fulfillment_charge / refund_credit / referral_credit), `amount`, `balance_after`, `stripe_payment_id`, `created_at`

**StoreConnection** — `id`, `brand_id`, `platform` (woocommerce / wix), `store_url`, `api_key`, `api_secret`, `last_sync_at`, `sync_status`, `product_match_status`

**COA** — `id`, `product_family`, `lab` ("Janoshik"), `method` ("HPLC/LC-MS"), `report_url`

**Referral** — `id`, `referrer_brand_id`, `referee_email`, `status` (invited / signed_up / upgraded), `reward_credited`

**ReturnAddress** — `brand_id`, `company_name`, `street`, `apt`, `city`, `state`, `zip`, `phone`

**Notification** — `id`, `brand_id` (or global), `type` (order / announcement / order_note / issue), `title`, `body`, `created_at`, `read`

**Subscription** — `brand_id`, `stripe_subscription_id`, `plan` (pro), `price`, `status`, `synced_at`

---

## 6. Key user flows

**A. Acquisition → activation**
1. Land on `/` → "Get Started" → `/onboarding` (name, email, password). No card required.
2. Land in `/dashboard` with a **"Get Started — 1/3"** checklist: connect store · fund wallet · upload label.
3. Subscribe to **Pro ($97/mo)** via Stripe to unlock wholesale pricing + fulfillment.

**B. Store setup**
1. My Store → pick WooCommerce/Wix → enter store URL + API key/secret → accept terms.
2. Platform pulls products + orders immediately, then **auto-syncs every 15 min** ("Sync Now" available).
3. Unmatched products flagged with a **"No match"** badge until renamed to match the catalog.

**C. Order lifecycle**
1. Order arrives (synced from store **or** manual entry via drawer).
2. If missing data/funds → routed to **Action Required** (needs_address / needs_customer_info / awaiting_funds).
3. When ready → fulfillment: pick → apply brand label → pack (discreet) → ship.
4. **Wallet auto-deducts** wholesale + shipping. Tracking number generated, surfaced in Tracking, and **pushed back to the connected store**.
5. Status flows ready → processing → shipped → delivered.

**D. Money flow**
- Customer pays brand on brand's store → brand funds Pepify wallet (Stripe) → wallet covers wholesale + shipping per order → spread = brand profit. Refunds credit back to wallet (non-withdrawable).

**E. Trust / verification**
- COAs (third-party lab reports) are copy-linked into the brand's product descriptions so end customers can verify independently.

---

## 7. Integrations

| Capability | Provider in Pepify | Notes for a clone |
|---|---|---|
| Payments / subscription / wallet top-up | **Stripe** (checkout opens in new tab; card never touches their servers) | Stripe Checkout + Billing + webhooks for auto-credit |
| Store sync (orders/products/tracking) | **WooCommerce REST API** (ck_/cs_), **Wix** | OAuth/API-key per platform; 15-min polling + manual sync |
| Shipping / tracking | **USPS Ground Advantage** ($12.95 flat) | carrier API for labels + tracking webhooks |
| Trust docs | **Janoshik Analytical** (HPLC/LC-MS COAs) | swap for your industry's certification source |
| Support | AI chat + human escalation | LLM assistant + ticketing/escalation |
| Email | password reset, email change, notifications | transactional email provider |

---

## 8. Cross-cutting patterns to replicate

- **Two-theme system:** light for public/auth, dark for the app.
- **Consistent screen skeleton:** page header → KPI cards → filter tabs (with counts) → search → table/empty state.
- **Empty states everywhere** with a single primary CTA (the app demos well with zero data).
- **Slide-over drawers** for create forms; **center modals** for money actions.
- **Gamification层:** daily goal + streak, profile-completeness meter, 10-badge achievement grid, "tip of the day". Drives activation.
- **Education = marketing:** wallet explainer, fulfillment steps, and the profit calculator appear both on the landing page and in-app.
- **Compliance framing** baked into flows (terms checkbox on store-connect, "research use only" disclaimers, COA trust layer).

---

## 9. Suggested tech stack (for a clone)

- **Frontend:** React (SPA) + Tailwind; Recharts for the dashboard charts; component lib for cards/tabs/drawers/modals.
- **Backend:** Node/TS or Python; Postgres (schema above); background workers for store polling + sync.
- **Auth:** email/password + reset links; session/JWT.
- **Payments:** Stripe (Checkout, Billing, Customer Portal, webhooks).
- **Integrations:** per-platform connectors (WooCommerce REST, Wix), carrier API, transactional email.
- **Infra:** queue for sync/fulfillment jobs; webhook receivers for Stripe + carrier + store events.

---

## 10. Phased build plan

**MVP (sell + fulfill manually)**
1. Auth + onboarding + brand profile + logo upload.
2. Product catalog (wholesale price sheet) + admin to manage SKUs/stock.
3. Manual order entry + order lifecycle + status board.
4. Prepaid wallet + Stripe top-up + auto-deduct on fulfillment.
5. Membership paywall (Stripe subscription).
6. Overview dashboard (KPIs + empty states).

**Phase 2 (automation)**
7. Store connectors (WooCommerce first) + 15-min sync + tracking push-back.
8. Tracking hub + Action Required routing.
9. Customers + Address Book auto-fill.
10. Profit Calculator + projections.

**Phase 3 (trust, growth, retention)**
11. COA/verification library + copy-link pattern.
12. Referrals + rewards.
13. Gamification (goals, streaks, badges, profile completeness).
14. Notifications inbox + announcements + Live Chat/support.

---

## 11. Reference data (catalog snapshot, 2026-06-10)

36 SKUs; representative rows (Product · Your Cost · Suggested Retail · Margin):

- Bacteriostatic Water 3mL — $8 / $12 / 33%
- T-5 5mg — $17 / $55 / 69% · T-60 60mg — $68 / $185 / 63%
- R-5 5mg — $18 / $55 / 67% · R-40 40mg — $98 / $225 / 56%
- B-157 5mg — $16 / $45 / 64%
- BPC10+TB10+GHK50 (Glow) 70mg — $72 / $175 / 59%
- TB-500 5mg — $22 / $55 / 60% · GHK-Cu 50mg — $13 / $38 / 66%
- MOTS-C 10/20/40mg — from $21 / $48 / 56%
- Tesamorelin 20mg — $130 / $315 / 59% (highest ticket)
- "Soon" (pending COA): NAD+, Oxytocin, MT-2 10mg, Epithalon 10mg, Tesamorelin 10mg

Margins cluster **53–69%** before membership/shipping. Flat shipping $12.95; free custom labeling included.

*(Prices, SKUs, and stock reflect a single capture and will change. Treat as illustrative, not authoritative.)*
