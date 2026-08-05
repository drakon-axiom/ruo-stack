import { describe, expect, it } from 'vitest';
import { shipstationStatus } from '@ruostack/shared';

// A blocked order must NEVER map to 'paid' (Awaiting Shipment) — that would let
// the warehouse ship an unfunded / unaddressable / unmapped order. Only a fully
// unblocked, non-terminal order is fulfillable.
describe('shipstationStatus', () => {
  it('maps an unblocked ready order to paid (fulfillable)', () => {
    expect(shipstationStatus({ status: 'ready_for_fulfillment', blocker: 'none' })).toBe('paid');
    expect(shipstationStatus({ status: 'processing', blocker: 'none' })).toBe('paid');
  });

  it('maps EVERY blocker to on_hold, never paid', () => {
    for (const blocker of ['awaiting_funds', 'needs_address', 'needs_customer_info', 'needs_mapping']) {
      expect(shipstationStatus({ status: 'ready_for_fulfillment', blocker })).toBe('on_hold');
    }
  });

  it('reflects terminal states regardless of blocker', () => {
    expect(shipstationStatus({ status: 'shipped', blocker: 'none' })).toBe('shipped');
    expect(shipstationStatus({ status: 'delivered', blocker: 'none' })).toBe('shipped');
    expect(shipstationStatus({ status: 'cancelled', blocker: 'needs_mapping' })).toBe('cancelled');
  });
});
