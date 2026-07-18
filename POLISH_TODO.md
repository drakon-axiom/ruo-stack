# RUOStack — Polish & Deferred-Work Backlog

The WooCommerce/ShipStation plan (Phases 1–3) is feature-complete on `main`, and the
brand portal's **quick-win** screens (Overview, Profit Calculator, Referrals, COAs,
Shipping) are built. This file tracks everything intentionally deferred so it isn't lost.

## Portal screens not yet built
- **Customers** — new `Customer` model, populated from order recipients; search + lifetime-value rollups.
- **Address Book** — saved `Address` model + auto-fill on the manual-order form.
- **Branding** — logo upload via Supabase Storage + a logo PATCH endpoint (`Brand.logoUrl` already exists); brand color theming.
- **Live Chat** — 3rd-party embed or in-house thread (deferred; placeholder stays in nav).
- **Notifications inbox** (top-bar bell) — announcements / order-notes / issues feed (needs backend).
- **Gamification layer** — daily-goal + streak, 10-badge achievements, revenue/profit charts, tip-of-the-day, profile-completeness meter. (Explicitly out of the "functional-clean" pass.)
- **Shipping custom return-address** — no brand return-address model yet (Shipping screen shows a "coming soon" note for this).
- **COA upload/management** — brand-side COA upload + Supabase Storage; independent batch-testing program. (Today COAs are operator-set per product via `CatalogProduct.coaId`.)

## Backend / ops polish
- **Automated carrier-claim filing** (USPS/UPS APIs) — `carrier_claim_id` is recorded manually today.
- **Per-brand sync health** (`last_sync_at` / `sync_status`) surfaced in admin + webhook-failure alerting.
- **Payment-recovered (dunning recovery) email** — the suspend/grace flow exists; the "you're back in good standing" email does not.
- **One-click drift heals** — e.g. capture a shipped-but-not-captured order from the admin exceptions screen, beyond just flagging it.
- **Claims rules to finalize** — insurance posture, fault matrix, evidence/windows config, auto-approve threshold.
- **Auto-suggested aliases on connect** (fuzzy SKU match) + Drifted / Conflict / Adopt provisioning cases.
- **Tax exemptions UI/endpoints** — `BrandTaxExemption` model exists but is unused (SALT).
- **Wix store connections** — only WooCommerce is built; the connection layer is generic enough to extend.
- **Webhook-secret rotate-in-place** — a store connection's `webhookSecret` rotates today only via disconnect → reconnect (a fresh token on each connect). Add a lightweight "rotate secret" action so a brand can cycle it without tearing down the connection.
