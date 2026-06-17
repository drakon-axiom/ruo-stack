import type { BrandStoreConnection, PrismaClient } from '@ruostack/db';
import { batchProducts, decryptStoreCreds, getProductIdBySku, type WooProductInput } from './woo.js';

/**
 * Product provisioning: seed the brand's WooCommerce store with products that
 * already carry the canonical RUOStack SKU, so inbound order matching is a
 * deterministic exact-SKU lookup (fulfillment plan §3). New products are created
 * as drafts (the brand reviews + publishes); existing ones (matched by SKU) are
 * updated in place. Price = the brand's retail (override or operator suggestion).
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
  // Update payload omits `status` so we never flip a brand's published product
  // back to draft; only the platform-owned fields are refreshed.
  const update: WooProductInput[] = [];
  for (const p of products) {
    const id = existing.get(p.id) ?? null;
    if (id === null) create.push(newWooProduct(p));
    else {
      update.push({
        id,
        sku: p.canonicalSku,
        name: p.name,
        type: 'simple',
        regular_price: dollars(p.retailCents),
        description: p.descriptionTemplate ?? undefined,
        manage_stock: false,
        stock_status: p.status === 'in_stock' ? 'instock' : 'outofstock',
        images: p.images.map((src) => ({ src })),
        meta_data: [{ key: SKU_META_KEY, value: p.canonicalSku }],
      });
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
    const p = row.sku ? bySku.get(row.sku) : undefined;
    out.push({
      product_id: p?.id ?? '',
      sku: row.sku ?? p?.canonicalSku ?? '',
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
