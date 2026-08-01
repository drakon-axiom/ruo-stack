import { describe, expect, it } from 'vitest';
import { buildProductCsv, platformOwnedUpdate, type ProvisionProduct } from '../../src/services/store-provision.js';

/**
 * Fulfillment plan §3: "Updates are field-scoped: RUOStack only rewrites
 * platform-owned fields, never the brand's price/copy once set; SKU is treated
 * as immutable and any drift is flagged."
 *
 * These pin that contract. Before this fix the update payload carried name,
 * regular_price, description and images — so any brand that imported via the CSV
 * fallback, edited their retail price and copy, then hit "push to store" had
 * those edits overwritten.
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
  const payload = platformOwnedUpdate(product, 4242);

  it('never sends the retail price — retail is the brand’s', () => {
    expect(payload).not.toHaveProperty('regular_price');
  });

  it('never sends copy or images — seeded at creation, brand-editable after', () => {
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('description');
    expect(payload).not.toHaveProperty('images');
  });

  it('never rewrites the SKU — drift is flagged, not silently corrected', () => {
    expect(payload).not.toHaveProperty('sku');
  });

  it('never touches publish state — the brand owns the publish decision', () => {
    expect(payload).not.toHaveProperty('status');
  });

  it('does send the platform-driven stock signal, keyed to the right product', () => {
    expect(payload.id).toBe(4242);
    expect(payload.stock_status).toBe('instock');
    expect(payload.manage_stock).toBe(false);
  });

  it('maps every non-in_stock catalog state to outofstock', () => {
    expect(platformOwnedUpdate({ ...product, status: 'out_of_stock' }, 1).stock_status).toBe('outofstock');
    expect(platformOwnedUpdate({ ...product, status: 'soon' }, 1).stock_status).toBe('outofstock');
  });

  it('keeps the canonical-SKU marker so our bookkeeping self-heals', () => {
    expect(payload.meta_data).toEqual([{ key: '_ruostack_canonical_sku', value: 'RUO-TIRZ-10MG' }]);
  });

  it('sends nothing beyond the four platform-owned keys', () => {
    // A whitelist assertion, so adding a field to the payload has to be a
    // deliberate act that updates this test.
    expect(Object.keys(payload).sort()).toEqual(['id', 'manage_stock', 'meta_data', 'stock_status']);
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
