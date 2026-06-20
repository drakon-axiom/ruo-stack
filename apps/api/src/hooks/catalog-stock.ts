import type { CatalogProduct } from '@ruostack/db';
import { AUDIT_ACTIONS } from '@ruostack/shared';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { decryptStoreCreds, getProductIdBySku, updateProductStock } from '../services/woo.js';

/**
 * Stock push (fulfillment plan §3): when a catalog SKU's availability changes,
 * flip the matched product in every connected WooCommerce store in/out of stock
 * so brands can't sell the unfulfillable. Best-effort + resilient — one store's
 * failure neither blocks the others nor throws into the admin stock toggle; a
 * failing store is flagged on its connection. Matched by exact canonical SKU
 * (provisioned products carry it).
 *
 * TODO: move to a queue when store counts grow (this fans out inline).
 */
export async function onCatalogStockChanged(product: CatalogProduct): Promise<void> {
  const { prisma } = getClients();
  const inStock = product.status === 'in_stock';
  const conns = await prisma.brandStoreConnection.findMany({ where: { platform: 'woocommerce', status: 'active' } });
  if (conns.length === 0) return;

  // A brand may carry this product under its canonical SKU AND/or aliased SKUs.
  const aliases = await prisma.productAlias.findMany({ where: { productId: product.id }, select: { brandId: true, wooSku: true } });
  const aliasByBrand = new Map<string, string[]>();
  for (const a of aliases) {
    const arr = aliasByBrand.get(a.brandId) ?? [];
    arr.push(a.wooSku);
    aliasByBrand.set(a.brandId, arr);
  }

  let pushed = 0;
  let missing = 0;
  let failed = 0;
  for (const conn of conns) {
    const skus = [...new Set([product.canonicalSku, ...(aliasByBrand.get(conn.brandId) ?? [])])];
    try {
      const creds = decryptStoreCreds(conn);
      let matchedHere = false;
      for (const sku of skus) {
        const wooId = await getProductIdBySku(creds, sku);
        if (wooId === null) continue;
        await updateProductStock(creds, wooId, inStock);
        pushed++;
        matchedHere = true;
      }
      if (!matchedHere) missing++;
    } catch (e) {
      failed++;
      await prisma.brandStoreConnection
        .update({ where: { id: conn.id }, data: { status: 'error', lastError: `stock push failed: ${e instanceof Error ? e.message.slice(0, 160) : ''}` } })
        .catch(() => {});
    }
  }

  if (pushed > 0 || failed > 0) {
    await writeAudit(prisma, {
      actorType: 'system',
      actorId: null,
      action: AUDIT_ACTIONS.storeStockPushed,
      targetType: 'catalog_product',
      targetId: product.id,
      after: { sku: product.canonicalSku, in_stock: inStock, pushed, missing, failed },
      ip: null,
    });
  }
  // eslint-disable-next-line no-console
  console.log(`[stock-push] ${product.canonicalSku} → ${inStock ? 'instock' : 'outofstock'}: pushed=${pushed} missing=${missing} failed=${failed}`);
}
