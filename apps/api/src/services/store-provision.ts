import type { BrandStoreConnection, PrismaClient } from '@ruostack/db';
import { batchProducts, decryptStoreCreds, getProductIdBySku, type WooProductInput, type WooProductUpdate } from './woo.js';

/**
 * Product provisioning: seed the brand's WooCommerce store with products that
 * already carry the canonical RUOStack SKU, so inbound order matching is a
 * deterministic exact-SKU lookup (fulfillment plan §3).
 *
 * New products are created as drafts (the brand reviews + publishes), with
 * suggested retail pre-filled as an editable default. Products already in the
 * store are updated FIELD-SCOPED — see `platformOwnedUpdate`: their price, copy,
 * images, SKU and publish state are the brand's and are never rewritten.
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
 * platform-owned fields, **never** the brand's price/copy once set; SKU is
 * treated as immutable and any drift is flagged."
 *
 * So an update carries ONLY:
 *   • stock_status — the platform-driven signal (same one the stock push uses);
 *     prevents the brand selling something we can't fulfil.
 *   • the canonical-SKU marker meta — our own bookkeeping, self-healing if lost.
 *
 * Deliberately ABSENT:
 *   • regular_price — retail is the brand's, explicitly.
 *   • name / description / images — seeded at creation, brand-editable after.
 *   • sku — immutable. A changed SKU is the DRIFTED case: it gets flagged and
 *     resolved by an explicit operator/brand choice, never silently rewritten.
 *
 * FOLLOW-UP: the spec's "once set" implies we could still refresh copy the brand
 * has NOT customised — which matters because the description carries the
 * research-use-only disclaimer, and a compliance-text change should be able to
 * propagate. Detecting "unchanged since our last push" requires storing what we
 * last pushed, i.e. the `ProductProvisioning` record that arrives with the
 * pre-flight wizard. Until then this errs toward never clobbering brand content.
 */
export function platformOwnedUpdate(p: ProvisionProduct, wooId: number): WooProductUpdate {
  return {
    id: wooId,
    manage_stock: false,
    stock_status: p.status === 'in_stock' ? 'instock' : 'outofstock',
    meta_data: [{ key: SKU_META_KEY, value: p.canonicalSku }],
  };
}

/** New product → created as a draft (the brand reviews + publishes). */
function newWooProduct(p: ProvisionProduct): WooProductInput {
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

export async function provisionProducts(
  prisma: PrismaClient,
  connection: BrandStoreConnection,
  products: ProvisionProduct[],
): Promise<ProvisionResult[]> {
  const creds = decryptStoreCreds(connection);

  // Resolve which already exist (by SKU) so we update rather than duplicate.
  const existing = new Map<string, number | null>();
  for (const p of products) {
    existing.set(p.id, await getProductIdBySku(creds, p.canonicalSku));
  }

  const create: WooProductInput[] = [];
  // Updates are field-scoped (see `platformOwnedUpdate`) — a product already in
  // the store keeps its price, copy, images, SKU and publish state. Only the
  // platform-driven stock signal is refreshed.
  const update: WooProductUpdate[] = [];
  // woo_id → our product, so the update results map back deterministically. The
  // scoped payload no longer sends `sku`, so matching on the echoed SKU would
  // rely on Woo returning a field we didn't send.
  const byWooId = new Map<number, ProvisionProduct>();
  for (const p of products) {
    const id = existing.get(p.id) ?? null;
    if (id === null) create.push(newWooProduct(p));
    else {
      update.push(platformOwnedUpdate(p, id));
      byWooId.set(id, p);
    }
  }

  const res = await batchProducts(creds, {
    ...(create.length ? { create } : {}),
    ...(update.length ? { update } : {}),
  });

  const out: ProvisionResult[] = [];
  const bySku = new Map(products.map((p) => [p.canonicalSku, p]));
  for (const row of res.create ?? []) {
    if (!row) continue;
    const p = row.sku ? bySku.get(row.sku) : undefined;
    out.push({
      product_id: p?.id ?? '',
      sku: row.sku ?? p?.canonicalSku ?? '',
      name: p?.name ?? '',
      action: row.error ? 'error' : 'created',
      woo_id: row.id,
      error: row.error?.message,
    });
  }
  for (const row of res.update ?? []) {
    if (!row) continue;
    const p = (row.id !== undefined ? byWooId.get(row.id) : undefined) ?? (row.sku ? bySku.get(row.sku) : undefined);
    out.push({
      product_id: p?.id ?? '',
      sku: p?.canonicalSku ?? row.sku ?? '',
      name: p?.name ?? '',
      action: row.error ? 'error' : 'updated',
      woo_id: row.id,
      error: row.error?.message,
    });
  }
  await prisma.brandStoreConnection.update({ where: { id: connection.id }, data: { status: 'active', lastError: null } });
  return out;
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
