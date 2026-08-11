import type { Order } from '@ruostack/db';
import { AUDIT_ACTIONS } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { decryptStoreCreds, pushTracking } from '../services/woo.ts';

/**
 * On ship, write the tracking number back to the connected store so the brand's
 * customer sees it (and the store fires its own "shipped" email). WooCommerce:
 * mark the order completed + attach tracking. Manual orders have no store and
 * no-op. This NEVER throws into the ship path — the wallet is already captured;
 * a writeback failure is flagged on the connection + audited for retry/ops.
 */
export async function onOrderShipped(order: Order): Promise<void> {
  if (order.source !== 'woocommerce' || !order.externalOrderId || !order.trackingNumber) return;

  const { prisma } = getClients();
  const conn = await prisma.brandStoreConnection.findFirst({
    where: { brandId: order.brandId, platform: 'woocommerce' },
  });
  if (!conn) return; // store disconnected since import — nothing to write back to

  try {
    await pushTracking(decryptStoreCreds(conn), order.externalOrderId, {
      carrier: order.carrier ?? 'Carrier',
      number: order.trackingNumber,
    });
    await prisma.brandStoreConnection.update({ where: { id: conn.id }, data: { status: 'active', lastError: null } });
    await writeAudit(prisma, {
      actorType: 'system',
      actorId: null,
      action: AUDIT_ACTIONS.storeTrackingPushed,
      targetType: 'order',
      targetId: order.id,
      after: { external_order_id: order.externalOrderId, carrier: order.carrier, tracking: order.trackingNumber },
      ip: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 160) : 'writeback failed';
    await prisma.brandStoreConnection
      .update({ where: { id: conn.id }, data: { status: 'error', lastError: `tracking writeback failed: ${message}` } })
      .catch(() => {});
    await writeAudit(prisma, {
      actorType: 'system',
      actorId: null,
      action: AUDIT_ACTIONS.storeWritebackFailed,
      targetType: 'order',
      targetId: order.id,
      after: { external_order_id: order.externalOrderId, error: message },
      ip: null,
    }).catch(() => {});
  }
}
