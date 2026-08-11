import { describe, expect, it } from 'vitest';
import { customerKey, foldCustomers, shipToFrom, type CustomerOrderRow } from '../../src/services/customers.ts';

/**
 * The Customers rollup. This logic lived inline in the route handler and had no
 * coverage at all; it moved into a pure service when "ship again" needed to pick
 * an address, which is the case with the sharpest failure mode — prefilling a
 * new order from an order that never had a shippable address.
 */
const at = (iso: string) => new Date(iso);

function order(over: Partial<CustomerOrderRow> = {}): CustomerOrderRow {
  return {
    id: 'o1',
    recipientName: 'Dana Reyes',
    recipientEmail: 'dana@example.com',
    recipientPhone: null,
    address1: '400 Congress Ave',
    address2: null,
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    country: 'US',
    walletChargeCents: 4200,
    status: 'shipped',
    blocker: 'none',
    trackingNumber: null,
    exportedAt: null,
    createdAt: at('2026-08-01T00:00:00Z'),
    ...over,
  };
}

describe('customerKey', () => {
  it('groups by email, case- and whitespace-insensitively', () => {
    expect(customerKey({ recipientEmail: ' Dana@Example.com ', recipientName: 'Dana', zip: '78701' })).toBe('dana@example.com');
  });

  it('falls back to name+zip when an order carries no email', () => {
    expect(customerKey({ recipientEmail: null, recipientName: 'Dana Reyes', zip: '78701' })).toBe('name:dana reyes|78701');
  });

  it('treats a blank email as no email rather than as a shared identity', () => {
    // Otherwise every anonymous order in the brand collapses into one customer.
    const a = customerKey({ recipientEmail: '   ', recipientName: 'Dana', zip: '78701' });
    const b = customerKey({ recipientEmail: '', recipientName: 'Wren', zip: '99501' });
    expect(a).not.toBe(b);
  });
});

describe('shipToFrom', () => {
  it('returns the address of a complete order', () => {
    expect(shipToFrom(order())).toEqual({
      recipient_name: 'Dana Reyes',
      recipient_email: 'dana@example.com',
      address1: '400 Congress Ave',
      address2: null,
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      country: 'US',
    });
  });

  it.each([['address1'], ['city'], ['state'], ['zip']])('returns null when %s is missing', (field) => {
    expect(shipToFrom(order({ [field]: '' }))).toBeNull();
  });

  it('treats a whitespace-only field as missing', () => {
    expect(shipToFrom(order({ address1: '   ' }))).toBeNull();
  });

  it('defaults country to US when the store sent none', () => {
    expect(shipToFrom(order({ country: '' }))?.country).toBe('US');
  });
});

describe('foldCustomers', () => {
  it('rolls repeat orders into one customer with summed spend', () => {
    const [c] = foldCustomers([
      order({ id: 'b', createdAt: at('2026-08-01T00:00:00Z'), walletChargeCents: 4200 }),
      order({ id: 'a', createdAt: at('2026-06-01T00:00:00Z'), walletChargeCents: 1000 }),
    ]);
    expect(c!.orders).toBe(2);
    expect(c!.spend_cents).toBe(5200);
    expect(c!.first_order).toEqual(at('2026-06-01T00:00:00Z'));
    expect(c!.order_list.map((o) => o.id)).toEqual(['b', 'a']);
  });

  it('seeds identity from the NEWEST order, so a customer who moved shows their current city', () => {
    const [c] = foldCustomers([
      order({ id: 'new', city: 'Denver', state: 'CO', zip: '80202', address1: '1 16th St', createdAt: at('2026-08-01T00:00:00Z') }),
      order({ id: 'old', city: 'Austin', state: 'TX', zip: '78701', createdAt: at('2026-01-01T00:00:00Z') }),
    ]);
    expect(c!.city).toBe('Denver');
    expect(c!.ship_to?.address1).toBe('1 16th St');
    expect(c!.ship_to?.city).toBe('Denver');
  });

  it('backfills a phone from an older order when the newest has none', () => {
    const [c] = foldCustomers([
      order({ id: 'new', recipientPhone: null, createdAt: at('2026-08-01T00:00:00Z') }),
      order({ id: 'old', recipientPhone: '+15125550100', createdAt: at('2026-01-01T00:00:00Z') }),
    ]);
    expect(c!.phone).toBe('+15125550100');
  });

  it('falls through to an older order when the newest has no shippable address', () => {
    // A Woo order can arrive with a blank shipping block — that's exactly what
    // the `needs_address` blocker is for. It still counts as an order, but it
    // must not become the address a reship is sent to.
    const [c] = foldCustomers([
      order({ id: 'broken', address1: '', city: '', state: '', zip: '78701', blocker: 'needs_address', createdAt: at('2026-08-01T00:00:00Z') }),
      order({ id: 'good', address1: '400 Congress Ave', city: 'Austin', createdAt: at('2026-01-01T00:00:00Z') }),
    ]);
    expect(c!.orders).toBe(2);
    expect(c!.ship_to?.address1).toBe('400 Congress Ave');
  });

  it('reports no address at all when the customer has never had a complete one', () => {
    // The UI hangs the Ship-again button off this being non-null.
    const [c] = foldCustomers([order({ address1: '', city: '', state: '', blocker: 'needs_address' })]);
    expect(c!.ship_to).toBeNull();
  });

  it('keeps two different people with the same name apart when neither has an email', () => {
    const cs = foldCustomers([
      order({ id: 'a', recipientEmail: null, recipientName: 'Alex Kim', zip: '78701' }),
      order({ id: 'b', recipientEmail: null, recipientName: 'Alex Kim', zip: '99501', city: 'Anchorage', state: 'AK' }),
    ]);
    expect(cs).toHaveLength(2);
  });

  it('orders customers by most recent order', () => {
    const cs = foldCustomers([
      order({ recipientEmail: 'newest@example.com', createdAt: at('2026-08-01T00:00:00Z') }),
      order({ recipientEmail: 'older@example.com', createdAt: at('2026-02-01T00:00:00Z') }),
    ]);
    expect(cs.map((c) => c.email)).toEqual(['newest@example.com', 'older@example.com']);
  });

  it('is empty for a brand with no orders', () => {
    expect(foldCustomers([])).toEqual([]);
  });
});
