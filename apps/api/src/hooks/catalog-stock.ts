import type { CatalogProduct } from '@ruostack/db';

/**
 * Seam: a catalog stock-status change must eventually push to WooCommerce
 * (fulfillment plan §3). Phase 0 ships the named no-op hook only — never a fake
 * implementation that pretends to work.
 *
 * TODO(Phase 1): push the new stock status to every connected WooCommerce store
 * via the Woo connector, with retry + WebhookEvent-style idempotency.
 */
export async function onCatalogStockChanged(product: CatalogProduct): Promise<void> {
  // Intentionally a no-op in Phase 0. Logged so the seam is observable in dev.
  // eslint-disable-next-line no-console
  console.log(
    `[seam] onCatalogStockChanged: ${product.canonicalSku} → ${product.status} (TODO(Phase 1): Woo stock push)`,
  );
}
