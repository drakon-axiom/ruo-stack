import { describe, expect, it } from 'vitest';
import { buildProductCsv, platformOwnedUpdate, type ProvisionProduct } from '../../src/services/store-provision.js';

/**
 * Fulfillment plan §3: "Updates are field-scoped: RUOStack only rewrites
 * platform-owned fields, never the brand's price/copy once set."
 *
 * Policy: a push writes the product's IDENTITY (sku, name) plus the stock
 * signal — nothing else. Price, copy and images are the brand's once the product
 * exists. These tests pin that both ways: the identity fields must be sent, and
 * the brand-owned ones must never be.
 */
const product: ProvisionProduct = {
  id: 'cat-1',
  canonicalSku: 'RUO-TIRZ-10MG',
  name: 'Tirzepatide 10mg',
  descriptionTemplate: 'Research use only. Not for human consumption.',
  status: 'in_stock',
  images: ['https://cdn.example/tirz.png'],
  retailCents: 9900,
};

describe('platformOwnedUpdate — brand-owned fields are never rewritten', () => {
  const payload = platformOwnedUpdate(product, 4242, product.canonicalSku);

  it('never sends the retail price — retail is the brand’s', () => {
    expect(payload).not.toHaveProperty('regular_price');
  });

  it('never sends copy or images — the brand’s once the product exists', () => {
    // Consequence accepted deliberately: a change to the research-use-only
    // disclaimer does NOT reach already-provisioned stores, because propagating
    // it would overwrite whatever the brand has written.
    expect(payload).not.toHaveProperty('description');
    expect(payload).not.toHaveProperty('images');
  });

  it('never touches publish state — the brand owns the publish decision', () => {
    expect(payload).not.toHaveProperty('status');
  });

  it('sends the identity fields — sku and name are kept in sync', () => {
    expect(payload.sku).toBe('RUO-TIRZ-10MG');
    expect(payload.name).toBe('Tirzepatide 10mg');
  });

  it('writes the SKU it is GIVEN, not canonical — a re-alias must survive a push', () => {
    // After a deliberate re-alias the store keeps the brand's own SKU, with a
    // ProductAlias carrying order matching back to canonical. Writing canonical
    // here would silently undo that choice.
    const realiased = platformOwnedUpdate(product, 4242, 'BRAND-OWN-SKU');
    expect(realiased.sku).toBe('BRAND-OWN-SKU');
    // The marker meta still records what it maps to.
    expect(realiased.meta_data).toEqual([{ key: '_ruostack_canonical_sku', value: 'RUO-TIRZ-10MG' }]);
  });

  it('does send the platform-driven stock signal, keyed to the right product', () => {
    expect(payload.id).toBe(4242);
    expect(payload.stock_status).toBe('instock');
    expect(payload.manage_stock).toBe(false);
  });

  it('maps every non-in_stock catalog state to outofstock', () => {
    expect(platformOwnedUpdate({ ...product, status: 'out_of_stock' }, 1, 'S').stock_status).toBe('outofstock');
    expect(platformOwnedUpdate({ ...product, status: 'soon' }, 1, 'S').stock_status).toBe('outofstock');
  });

  it('keeps the canonical-SKU marker so our bookkeeping self-heals', () => {
    expect(payload.meta_data).toEqual([{ key: '_ruostack_canonical_sku', value: 'RUO-TIRZ-10MG' }]);
  });

  it('sends nothing beyond the identity + stock keys', () => {
    // A whitelist assertion, so adding a field to the payload has to be a
    // deliberate act that updates this test.
    expect(Object.keys(payload).sort()).toEqual(['id', 'manage_stock', 'meta_data', 'name', 'sku', 'stock_status']);
  });
});

describe('buildProductCsv (the fallback path that made this bite)', () => {
  it('still carries the full skeleton — a CSV import is a first write, not an update', () => {
    const csv = buildProductCsv([product]);
    const [header, row] = csv.trim().split('\n');
    expect(header).toContain('Regular price');
    expect(row).toContain('RUO-TIRZ-10MG');
    expect(row).toContain('99.00');
    expect(row).toContain('0'); // Published=0 → imported as a draft
  });

  it('quotes fields containing commas so the importer does not mis-split them', () => {
    const csv = buildProductCsv([{ ...product, name: 'Tirzepatide, 10mg' }]);
    expect(csv).toContain('"Tirzepatide, 10mg"');
  });
});
