/** AuditLog actor + action vocabulary. The log is APPEND-ONLY (trigger-enforced). */
export const ACTOR_TYPES = ['admin', 'brand', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Canonical action strings written on every mutating admin / sensitive brand action. */
export const AUDIT_ACTIONS = {
  catalogCreated: 'catalog.created',
  catalogUpdated: 'catalog.updated',
  catalogPublished: 'catalog.published',
  skuStockChanged: 'sku.stock_changed',
  roleGranted: 'role.granted',
  roleRevoked: 'role.revoked',
  adminCreated: 'admin.created',
  adminSuspended: 'admin.suspended',
  adminActivated: 'admin.activated',
  brandProfileUpdated: 'brand.profile_updated',
  brandSignup: 'brand.signup',
  brandSuspended: 'brand.suspended',
  brandActivated: 'brand.activated',
  pickpackOverrideSet: 'brand.pickpack_override_set',
  // Money layer (Phase 1):
  walletTopupStarted: 'wallet.topup_started',
  walletDeposit: 'wallet.deposit',
  walletManualAdjustment: 'wallet.manual_adjustment',
  subscriptionCheckoutStarted: 'subscription.checkout_started',
  subscriptionStatusChanged: 'subscription.status_changed',
  // Orders (Phase 1):
  orderCreated: 'order.created',
  orderUpdated: 'order.updated',
  orderCancelled: 'order.cancelled',
  orderShipped: 'order.shipped',
  orderDelivered: 'order.delivered',
  orderExported: 'order.exported', // ShipStation pulled it via custom-store export
  orderResent: 'order.resent', // admin re-queued it for ShipStation export
  // Store connections (Phase 2):
  storeConnected: 'store.connected',
  storeDisconnected: 'store.disconnected',
  storeOrderImported: 'store.order_imported',
  storeTrackingPushed: 'store.tracking_pushed',
  storeWritebackFailed: 'store.writeback_failed',
  storeProductsProvisioned: 'store.products_provisioned',
  storeStockPushed: 'store.stock_pushed',
  storeAliasCreated: 'store.alias_created',
  storeAliasDeleted: 'store.alias_deleted',
  storeOrderRemapped: 'store.order_remapped',
  // Fulfillment rules engine (Phase 2):
  shippingRuleUpdated: 'shipping_rule.updated',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntryInput {
  actorType: ActorType;
  actorId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}
