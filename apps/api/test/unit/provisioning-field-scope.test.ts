import { describe, expect, it } from 'vitest';
import { buildProductCsv, platformOwnedUpdate, type ProvisionProduct } from '../../src/services/store-provision.ts';

/**
 * Fulfillment plan §3: "Updates are field-scoped: RUOStack only rewrites
 * platform-owned fields, never the brand's price/copy once set."
 *
 * Policy: a push writes the SKU and NOTHING else. The SKU is the one field that
 * ties the brand's product to ours (order matching runs on it); everything else
 * in that product belongs to the brand. These tests pin it as a whitelist, so
 * adding any field has to be a deliberate act that updates this test.
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

  it('never sends the name — the brand may have retitled the product', () => {
    expect(payload).not.toHaveProperty('name');
  });

  it('never touches publish state — the brand owns the publish decision', () => {
    expect(payload).not.toHaveProperty('status');
  });

  it('never sends stock — that has its own dedicated push path', () => {
    // hooks/catalog-stock.ts fans availability out to every connected store on a
    // catalog stock change. Writing it here too would just be a staler writer.
    expect(payload).not.toHaveProperty('stock_status');
    expect(payload).not.toHaveProperty('manage_stock');
  });

  it('sends the SKU — the one field that ties their product to ours', () => {
    expect(payload.sku).toBe('RUO-TIRZ-10MG');
  });

  it('writes the SKU it is GIVEN, not canonical — a re-alias must survive a push', () => {
    // After a deliberate re-alias the store keeps the brand's own SKU, with a
    // ProductAlias carrying order matching back to canonical. Writing canonical
    // here would silently undo that choice.
    expect(platformOwnedUpdate(product, 4242, 'BRAND-OWN-SKU').sku).toBe('BRAND-OWN-SKU');
  });

  it('is keyed to the right store product', () => {
    expect(payload.id).toBe(4242);
  });

  it('sends the SKU and NOTHING else', () => {
    // The whitelist. Adding any field to a push has to be a deliberate act that
    // updates this test — which is the point.
    expect(Object.keys(payload).sort()).toEqual(['id', 'sku']);
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
