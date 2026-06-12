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
  // Money layer (Phase 1):
  walletTopupStarted: 'wallet.topup_started',
  walletDeposit: 'wallet.deposit',
  walletManualAdjustment: 'wallet.manual_adjustment',
  subscriptionCheckoutStarted: 'subscription.checkout_started',
  subscriptionStatusChanged: 'subscription.status_changed',
  // Orders (Phase 1):
  orderCreated: 'order.created',
  orderCancelled: 'order.cancelled',
  orderShipped: 'order.shipped',
  orderDelivered: 'order.delivered',
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
