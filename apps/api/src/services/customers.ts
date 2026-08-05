/**
 * Customers — the read-only CRM rollup (architecture §1.2). There is no Customer
 * table: recipients live inline on Order, so this folds the brand's orders into
 * per-recipient aggregates.
 *
 * Pure over rows the route has already fetched, same split as `ledger.ts`: the
 * route owns querying, this owns what the grouping means. That matters here
 * because the grouping has real edge cases — an order with no email, a customer
 * who moved, a Woo order that arrived without a shippable address — and none of
 * them were testable while this lived inline in the handler.
 */

/** The Order columns the rollup reads. Must be ordered NEWEST FIRST. */
export interface CustomerOrderRow {
  id: string;
  recipientName: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  walletChargeCents: number;
  status: string;
  blocker: string;
  trackingNumber: string | null;
  exportedAt: Date | null;
  createdAt: Date;
}

/**
 * A recipient block ready to prefill the manual-order form — snake_case because
 * it crosses the wire straight into the drawer's form state.
 */
export interface ShipTo {
  recipient_name: string;
  recipient_email: string | null;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface CustomerOrderSummary {
  id: string;
  status: string;
  blocker: string;
  wallet_charge_cents: number;
  tracking_number: string | null;
  exported_at: Date | null;
  created_at: Date;
}

export interface Customer {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string;
  state: string;
  country: string;
  orders: number;
  spend_cents: number;
  first_order: Date;
  last_order: Date;
  last_status: string;
  last_blocker: string;
  last_exported_at: Date | null;
  /**
   * Where a "ship again" would go: the address from this customer's most recent
   * order that actually HAS one. Null when we hold no shippable address for
   * them at all — see `shipToFrom`.
   */
  ship_to: ShipTo | null;
  order_list: CustomerOrderSummary[];
}

/**
 * Group orders by the same recipient. Email is the identity when we have one;
 * otherwise name+zip, which is deliberately conservative — it will split one
 * person who moved into two rows rather than merge two people who share a name.
 */
export function customerKey(o: Pick<CustomerOrderRow, 'recipientEmail' | 'recipientName' | 'zip'>): string {
  const email = o.recipientEmail?.trim().toLowerCase() || null;
  return email ?? `name:${o.recipientName.trim().toLowerCase()}|${o.zip}`;
}

/**
 * The order's address, or null when it isn't shippable.
 *
 * Same completeness rule the Woo intake uses to raise `needs_address`
 * (`store-intake.ts`) — a store can hand us an order with a blank shipping block,
 * and that order still becomes a real row here. Prefilling a new order from it
 * would produce an order that can't ship, so an incomplete address is treated as
 * no address and the rollup falls through to an older order that has one.
 */
export function shipToFrom(o: CustomerOrderRow): ShipTo | null {
  const address1 = o.address1.trim();
  const city = o.city.trim();
  const state = o.state.trim();
  const zip = o.zip.trim();
  if (!address1 || !city || !state || !zip) return null;
  return {
    recipient_name: o.recipientName,
    recipient_email: o.recipientEmail,
    address1,
    address2: o.address2,
    city,
    state,
    zip,
    country: o.country || 'US',
  };
}

/**
 * Fold orders into customers. `orders` MUST be newest-first — the first row seen
 * for a key seeds that customer's current identity and location.
 */
export function foldCustomers(orders: CustomerOrderRow[]): Customer[] {
  const byKey = new Map<string, Customer>();

  for (const o of orders) {
    const key = customerKey(o);
    let c = byKey.get(key);
    if (!c) {
      // First row for this key is the newest order — seed identity/location.
      c = {
        key,
        name: o.recipientName,
        email: o.recipientEmail?.trim().toLowerCase() || null,
        phone: o.recipientPhone || null,
        city: o.city,
        state: o.state,
        country: o.country,
        orders: 0,
        spend_cents: 0,
        first_order: o.createdAt,
        last_order: o.createdAt,
        last_status: o.status,
        last_blocker: o.blocker,
        last_exported_at: o.exportedAt,
        ship_to: null,
        order_list: [],
      };
      byKey.set(key, c);
    }
    c.orders += 1;
    c.spend_cents += o.walletChargeCents;
    if (o.createdAt < c.first_order) c.first_order = o.createdAt;
    if (!c.phone && o.recipientPhone) c.phone = o.recipientPhone; // backfill from any order
    // Newest-first, so the first shippable address we meet is the current one.
    if (!c.ship_to) c.ship_to = shipToFrom(o);
    c.order_list.push({
      id: o.id,
      status: o.status,
      blocker: o.blocker,
      wallet_charge_cents: o.walletChargeCents,
      tracking_number: o.trackingNumber,
      exported_at: o.exportedAt,
      created_at: o.createdAt,
    });
  }

  return Array.from(byKey.values()).sort((a, b) => b.last_order.getTime() - a.last_order.getTime());
}
