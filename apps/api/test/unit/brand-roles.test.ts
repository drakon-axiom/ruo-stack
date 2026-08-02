import { describe, expect, it } from 'vitest';
import { BRAND_SURFACES, canBrandAccess, wouldOrphanBrand } from '@ruostack/shared';

/**
 * Brand-side permission model (architecture §3.1). Before this existed,
 * `requireBrand` checked membership only — every active member could do
 * everything, which was fine with one member per brand and is exactly the thing
 * that stops being fine the moment staff can be invited.
 */
describe('canBrandAccess', () => {
  it('gives the owner every surface', () => {
    for (const s of BRAND_SURFACES) expect(canBrandAccess('owner', s)).toBe(true);
  });

  it('lets staff run the day-to-day business', () => {
    expect(canBrandAccess('staff', 'orders')).toBe(true);
    expect(canBrandAccess('staff', 'claims')).toBe(true);
    expect(canBrandAccess('staff', 'customers')).toBe(true);
    expect(canBrandAccess('staff', 'addresses')).toBe(true);
    expect(canBrandAccess('staff', 'catalog')).toBe(true);
    expect(canBrandAccess('staff', 'notifications')).toBe(true);
  });

  it('keeps PRICING away from staff, while still letting them browse the catalog', () => {
    // Retail price and shipping markup are both the brand's margin — they belong
    // with whoever owns the P&L, not whoever fulfils orders against it. But staff
    // must still be able to see products to build an order.
    expect(canBrandAccess('staff', 'catalog')).toBe(true);
    expect(canBrandAccess('staff', 'catalog_pricing')).toBe(false);
    expect(canBrandAccess('staff', 'store_config')).toBe(false);
  });

  it('keeps money away from staff', () => {
    expect(canBrandAccess('staff', 'wallet')).toBe(false);
    expect(canBrandAccess('staff', 'billing')).toBe(false);
  });

  it('keeps the store connection away from staff', () => {
    // Disconnecting breaks order intake for the entire brand.
    expect(canBrandAccess('staff', 'store_connection')).toBe(false);
  });

  it('keeps brand identity and access-granting away from staff', () => {
    expect(canBrandAccess('staff', 'profile')).toBe(false);
    expect(canBrandAccess('staff', 'branding')).toBe(false);
    expect(canBrandAccess('staff', 'members')).toBe(false);
  });
});

describe('wouldOrphanBrand', () => {
  // brand-billing and dunning both resolve the brand contact with
  // findFirst({ role: 'owner' }) — a brand with no owner silently breaks the
  // billing portal and stops dunning notices, so this is enforced.
  it('blocks removing the only owner', () => {
    expect(wouldOrphanBrand({ ownerCount: 1, targetIsOwner: true, losingOwner: true })).toBe(true);
  });

  it('blocks demoting the only owner', () => {
    expect(wouldOrphanBrand({ ownerCount: 1, targetIsOwner: true, losingOwner: true })).toBe(true);
  });

  it('allows removing an owner when another remains', () => {
    expect(wouldOrphanBrand({ ownerCount: 2, targetIsOwner: true, losingOwner: true })).toBe(false);
  });

  it('never blocks staff changes', () => {
    expect(wouldOrphanBrand({ ownerCount: 1, targetIsOwner: false, losingOwner: true })).toBe(false);
  });

  it('does not block promoting someone TO owner', () => {
    expect(wouldOrphanBrand({ ownerCount: 1, targetIsOwner: false, losingOwner: false })).toBe(false);
  });
});
