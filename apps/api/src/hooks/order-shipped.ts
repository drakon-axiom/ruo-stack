import type { Order } from '@ruostack/db';

/**
 * Seam: when an order ships, the tracking number must be written back to the
 * connected store (WooCommerce/Wix) so the brand's customer sees it. Phase 0/1
 * ships the named no-op only — never a fake implementation.
 *
 * TODO(Phase 1.5): push tracking_number/carrier to order.external_order_id on
 * the brand's connected store via the Woo/Wix connector.
 */
export async function onOrderShipped(order: Order): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `[seam] onOrderShipped: order ${order.id} → ${order.carrier} ${order.trackingNumber} (TODO(Phase 1.5): store writeback)`,
  );
}
