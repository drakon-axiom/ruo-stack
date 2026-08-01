import type { BrandStoreConnection, PrismaClient } from '@ruostack/db';
import { batchProducts, decryptStoreCreds, getProductIdBySku, type WooProductInput, type WooProductUpdate } from './woo.js';

/**
 * Product provisioning: seed the brand's WooCommerce store with products that
 * already carry the canonical RUOStack SKU, so inbound order matching is a
 * deterministic exact-SKU lookup (fulfillment plan §3).
 *
 * New products are created as drafts (the brand reviews + publishes), with
 * suggested retail pre-filled as an editable default. Products already in the
 * store are updated FIELD-SCOPED — see `platformOwnedUpdate`.
 *
 * The payload builders live here; the decisions about WHICH products get which
 * treatment belong to the pre-flight (`store-preflight.ts`), which classifies
 * against the store before anything is written.
 */

export interface ProvisionProduct {
  id: string;
  canonicalSku: string;
  name: string;
  descriptionTemplate: string | null;
  status: string; // in_stock | soon | out_of_stock
  images: string[];
  retailCents: number;
}

export interface ProvisionResult {
  product_id: string;
  sku: string;
  name: string;
  action: 'created' | 'updated' | 'error';
  woo_id?: number;
  error?: string;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);
const SKU_META_KEY = '_ruostack_canonical_sku';

/**
 * Update payload for a product that already exists in the store — FIELD-SCOPED.
 *
 * Fulfillment plan §3: "Updates are field-scoped: RUOStack only rewrites
 * platform-owned fields, **never** the brand's price/copy once set."
 *
 * A push carries ONLY the product's IDENTITY plus the stock signal:
 *   • sku  — the identifier order matching runs on.
 *   • name — the product's identity in the catalog; kept in sync so a catalog
 *            rename reaches every store.
 *   • stock_status — the platform-driven signal (same one the stock push uses);
 *     prevents the brand selling something we can't fulfil.
 *   • the canonical-SKU marker meta — our own bookkeeping, self-healing if lost.
 *
 * Deliberately ABSENT, and NOT to be added later:
 *   • regular_price — retail is the brand's, explicitly.
 *   • description — the brand's copy. Note this means a change to the
 *     research-use-only disclaimer text does NOT propagate to stores that were
 *     already provisioned; that is the accepted trade, because propagating it
 *     would overwrite whatever the brand has written. Seeded at creation only.
 *   • images — same reasoning as copy.
 *
 * `skuToWrite` is the SKU we LAST RECORDED for this product, not necessarily the
 * canonical one. They are the same for a normally-provisioned product, but after
 * a deliberate re-alias the store keeps the brand's own SKU (with a ProductAlias
 * carrying order matching back to canonical) — writing canonical here would
 * silently undo that choice.
 */
export function platformOwnedUpdate(p: ProvisionProduct, wooId: number, skuToWrite: string): WooProductUpdate {
  return {
    id: wooId,
    sku: skuToWrite,
    name: p.name,
    manage_stock: false,
    stock_status: p.status === 'in_stock' ? 'instock' : 'outofstock',
    meta_data: [{ key: SKU_META_KEY, value: p.canonicalSku }],
  };
}

/** New product → created as a draft (the brand reviews + publishes). */
export function newWooProductInput(p: ProvisionProduct): WooProductInput {
  return {
    sku: p.canonicalSku,
    name: p.name,
    type: 'simple',
    status: 'draft',
    regular_price: dollars(p.retailCents),
    description: p.descriptionTemplate ?? undefined,
    manage_stock: false,
    stock_status: p.status === 'in_stock' ? 'instock' : 'outofstock',
    images: p.images.map((src) => ({ src })),
    meta_data: [{ key: SKU_META_KEY, value: p.canonicalSku }],
  };
}

// ── CSV fallback (WooCommerce native product importer format) ──────────────────

const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Build a WooCommerce-importer product CSV (no store write — brand-controlled). */
export function buildProductCsv(products: ProvisionProduct[]): string {
  const headers = ['Type', 'SKU', 'Name', 'Published', 'Visibility in catalog', 'Description', 'In stock?', 'Regular price', 'Images'];
  const lines = [headers.join(',')];
  for (const p of products) {
    lines.push(
      [
        'simple',
        p.canonicalSku,
        p.name,
        '0', // import as draft; brand reviews + publishes
        'visible',
        p.descriptionTemplate ?? '',
        p.status === 'in_stock' ? '1' : '0',
        dollars(p.retailCents),
        p.images.join(', '),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}
