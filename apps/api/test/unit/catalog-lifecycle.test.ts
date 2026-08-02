import { describe, expect, it } from 'vitest';
import { catalogDeleteBlocker, isStoreSellable } from '@ruostack/shared';

/**
 * Catalog lifecycle rules. Both of these are the difference between "retired in
 * our catalog" and "still purchasable on a brand's storefront".
 */
describe('isStoreSellable', () => {
  it('is sellable only when in stock, published, and not archived', () => {
    expect(isStoreSellable({ status: 'in_stock', isPublished: true, archived: false })).toBe(true);
  });

  it('is not sellable when out of stock or coming soon', () => {
    expect(isStoreSellable({ status: 'out_of_stock', isPublished: true, archived: false })).toBe(false);
    expect(isStoreSellable({ status: 'soon', isPublished: true, archived: false })).toBe(false);
  });

  it('is not sellable when unpublished, even if the stock status says in_stock', () => {
    // This is the case that matters: unpublishing pushes storefronts out-of-stock
    // WITHOUT changing `status`, so a later stock toggle must not resurrect it.
    expect(isStoreSellable({ status: 'in_stock', isPublished: false, archived: false })).toBe(false);
  });

  it('is not sellable when archived, whatever else is true', () => {
    expect(isStoreSellable({ status: 'in_stock', isPublished: true, archived: true })).toBe(false);
  });
});

describe('catalogDeleteBlocker', () => {
  const clean = { isPublished: false, orderItemCount: 0, provisioningCount: 0 };

  it('allows deleting a never-published draft with no history', () => {
    expect(catalogDeleteBlocker(clean)).toBeNull();
  });

  it('blocks a published product', () => {
    expect(catalogDeleteBlocker({ ...clean, isPublished: true })).toMatch(/unpublish and archive/i);
  });

  it('blocks a product that appears on an order', () => {
    expect(catalogDeleteBlocker({ ...clean, orderItemCount: 1 })).toMatch(/existing orders/i);
  });

  it('blocks a product that is in a brand store', () => {
    // Deleting it would cascade our provisioning record away and orphan the
    // product in the brand's storefront, carrying our SKU.
    expect(catalogDeleteBlocker({ ...clean, provisioningCount: 1 })).toMatch(/brand store/i);
  });

  it('reports the publish blocker first when several apply', () => {
    const msg = catalogDeleteBlocker({ isPublished: true, orderItemCount: 3, provisioningCount: 2 });
    expect(msg).toMatch(/unpublish and archive/i);
  });
});
