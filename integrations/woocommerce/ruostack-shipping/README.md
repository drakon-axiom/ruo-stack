# RUOStack Shipping (WooCommerce plugin)

Brand-store side of the RUOStack rate proxy. At checkout it asks RUOStack for live
carrier rates and shows them as **named services** (e.g. *USPS Ground Advantage
(2–5 business days)*). Pricing — live carrier rate + hidden pick-&-pack fee +
your shipping markup — is computed server-side by RUOStack; this plugin only
displays what it's told. If RUOStack can't rate the cart, it returns a single
**$12.99 flat fallback** so checkout never blocks.

## Install

1. Copy the `ruostack-shipping` folder into `wp-content/plugins/` on the brand's
   WordPress site (or zip it and upload via **Plugins → Add New → Upload**).
2. Activate **RUOStack Shipping**.
3. **WooCommerce → Settings → Shipping → [your zone] → Add shipping method →
   RUOStack Shipping.**
4. Edit the method and fill in:
   - **RUOStack API base URL** — your RUOStack API origin (e.g. `https://api.ruostack.com`).
   - **Connection ID** and **Store key** — from **RUOStack → My Store** (the store
     key is the per-connection secret shown when you connect the store).
5. Save. Products must carry the **canonical RUOStack SKU** (use *Catalog → Add to
   my store* to provision them) so the rate request maps the cart to weights.

## How it works

On `calculate_shipping()` the plugin POSTs to `…/api/shipping/rates`:

```json
{
  "connection_id": "<uuid>",
  "items": [{ "sku": "TZ-10", "qty": 2 }],
  "destination": { "zip": "78701", "state": "TX", "country": "US" }
}
```

with header `x-ruostack-store-key: <store key>`, and renders each returned rate
as a WooCommerce shipping option. The customer price already includes the hidden
pick-&-pack fee and your markup; the fee is never itemized.

> Note: this is a thin client. All rating, fee/markup, and the flat fallback live
> in RUOStack (`/api/shipping/rates`).
