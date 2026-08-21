/** AuditLog actor + action vocabulary. The log is APPEND-ONLY (trigger-enforced). */
export const ACTOR_TYPES = ['admin', 'brand', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/** Canonical action strings written on every mutating admin / sensitive brand action. */
export const AUDIT_ACTIONS = {
  catalogCreated: 'catalog.created',
  catalogUpdated: 'catalog.updated',
  catalogPublished: 'catalog.published',
  catalogUnpublished: 'catalog.unpublished',
  catalogArchived: 'catalog.archived',
  catalogUnarchived: 'catalog.unarchived',
  catalogDeleted: 'catalog.deleted',
  catalogImported: 'catalog.imported', // one aggregate row per CSV import run
  catalogExported: 'catalog.exported', // one aggregate row per CSV export run
  skuStockChanged: 'sku.stock_changed',
  roleGranted: 'role.granted',
  roleRevoked: 'role.revoked',
  adminCreated: 'admin.created',
  adminSuspended: 'admin.suspended',
  adminActivated: 'admin.activated',
  brandProfileUpdated: 'brand.profile_updated',
  brandEmailChanged: 'brand.email_changed',
  brandBrandingUpdated: 'brand.branding_updated',
  brandSignup: 'brand.signup',
  brandMemberInvited: 'brand.member_invited',
  brandMemberRoleChanged: 'brand.member_role_changed',
  brandMemberRemoved: 'brand.member_removed',
  brandMemberReactivated: 'brand.member_reactivated',
  brandSuspended: 'brand.suspended',
  brandActivated: 'brand.activated',
  pickpackOverrideSet: 'brand.pickpack_override_set',
  // Money layer (Phase 1):
  walletTopupStarted: 'wallet.topup_started',
  walletDeposit: 'wallet.deposit',
  walletManualAdjustment: 'wallet.manual_adjustment',
  subscriptionCheckoutStarted: 'subscription.checkout_started',
  subscriptionStatusChanged: 'subscription.status_changed',
  // Plan registry admin edits (Task 7): name/features/shippingCutoff only.
  planUpdated: 'plan.updated',
  // Price-change transaction (Task 8): one entry when the inert PENDING
  // plan_price row is inserted (Step A, no side effects yet), a second when
  // the atomic commit flips it active (Step C, carries before/after + reason).
  planPricePending: 'plan.price_pending',
  planPriceChanged: 'plan.price_changed',
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
  // Reconciliation (Phase 3):
  reconciliationRun: 'reconciliation.run',
  // Claims (Phase 3):
  claimOpened: 'claim.opened',
  claimUpdated: 'claim.updated',
  claimResolved: 'claim.resolved',
  // Ledger / reconciliation (architecture §1.3, Gap 4.2):
  driftCaptureHealed: 'reconciliation.capture_healed',
  // Announcements (architecture §1.3):
  announcementCreated: 'announcement.created',
  announcementUpdated: 'announcement.updated',
  announcementPublished: 'announcement.published',
  announcementArchived: 'announcement.archived',
  announcementDeleted: 'announcement.deleted',
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
