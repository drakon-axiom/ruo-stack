import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { randomToken } from '../../src/crypto.js';
import { commit, preflight } from '../../src/services/store-preflight.js';
import type { ProvisioningStoreClient, StoreProduct } from '../../src/services/store-client.js';
import type { ProvisionProduct } from '../../src/services/store-provision.js';

// Pre-flight + commit against a real DB and a FAKE store. Self-skips unless
// RUN_DB_TESTS=1. The fake is the point: it lets every branch (adopt, drift,
// restore, conflict) run without a network or a mock HTTP server, and it records
// what was written so we can assert we never touched a brand-owned field.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

/** In-memory storefront. */
class FakeStore implements ProvisioningStoreClient {
  products = new Map<number, StoreProduct>();
  nextId = 100;
  createdPayloads: unknown[] = [];
  updatedPayloads: unknown[] = [];

  seed(sku: string, id?: number): StoreProduct {
    const wooProductId = id ?? this.nextId++;
    const p = { wooProductId, sku };
    this.products.set(wooProductId, p);
    return p;
  }

  async getProductById(id: number) {
    return this.products.get(id) ?? null;
  }
  async findProductBySku(sku: string) {
    return [...this.products.values()].find((p) => p.sku === sku) ?? null;
  }
  async createProducts(inputs: { sku: string }[]) {
    this.createdPayloads.push(...inputs);
    return inputs.map((i) => {
      // Woo enforces store-wide unique SKUs — mirror that.
      if ([...this.products.values()].some((p) => p.sku === i.sku)) {
        return { sku: i.sku, error: 'Invalid or duplicated SKU.' };
      }
      const p = this.seed(i.sku);
      return { sku: i.sku, id: p.wooProductId };
    });
  }
  async updateProducts(updates: { id: number; sku?: string }[]) {
    this.updatedPayloads.push(...updates);
    return updates.map((u) => {
      const p = this.products.get(u.id);
      if (!p) return { id: u.id, error: 'not found' };
      if (u.sku !== undefined) {
        if ([...this.products.values()].some((o) => o.sku === u.sku && o.wooProductId !== u.id)) {
          return { id: u.id, error: 'Invalid or duplicated SKU.' };
        }
        p.sku = u.sku;
      }
      return { id: u.id };
    });
  }
}

describe.skipIf(!RUN)('provisioning pre-flight + commit (DB integration)', () => {
  let brandId: string;
  let connectionId: string;
  let productId: string;
  let sku: string;
  let store: FakeStore;
  let product: ProvisionProduct;

  beforeAll(async () => {
    const brand = await prisma.brand.create({ data: { brandName: 'Prov Co', referralCode: `PV-${randomToken(5)}` } });
    brandId = brand.id;
    const conn = await prisma.brandStoreConnection.create({
      data: {
        brandId,
        platform: 'woocommerce',
        storeUrl: 'https://example.test',
        consumerKeyEnc: 'x',
        consumerSecretEnc: 'y',
        webhookSecret: randomToken(16),
      },
    });
    connectionId = conn.id;
    sku = `RUO-PV${randomToken(4).toUpperCase()}-10MG`;
    const cat = await prisma.catalogProduct.create({
      data: {
        canonicalSku: sku,
        compound: 'PV',
        name: 'Provisioning Test 10mg',
        wholesaleStarter: 1000,
        wholesalePro: 900,
        wholesaleVolume: 800,
        suggestedRetail: 5000,
        isPublished: true,
      },
    });
    productId = cat.id;
    product = {
      id: productId,
      canonicalSku: sku,
      name: cat.name,
      descriptionTemplate: 'Research use only.',
      status: 'in_stock',
      images: [],
      retailCents: 5000,
    };
  });

  afterAll(async () => {
    await prisma.productProvisioning.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.productAlias.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brandStoreConnection.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.catalogProduct.delete({ where: { id: productId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    store = new FakeStore();
    await prisma.productProvisioning.deleteMany({ where: { brandId } });
    await prisma.productAlias.deleteMany({ where: { brandId } });
  });

  const doCommit = (action: string) =>
    commit(prisma, store, { brandId, connectionId, decisions: new Map([[productId, action as never]]) }, [product]);

  it('classifies an untouched store as New and creates a provisioning record', async () => {
    const rows = await preflight(prisma, store, connectionId, [product]);
    expect(rows[0]?.state).toBe('new');
    expect(rows[0]?.default_action).toBe('create');

    const [outcome] = await doCommit('create');
    expect(outcome?.result).toBe('created');

    const rec = await prisma.productProvisioning.findFirst({ where: { connectionId, catalogProductId: productId } });
    expect(rec?.wooProductId).toBe(outcome?.woo_product_id);
    expect(rec?.provisionedSku).toBe(sku);
    expect(rec?.adopted).toBe(false);
  });

  it('is Managed on the second pass, and re-committing does NOT duplicate', async () => {
    await doCommit('create');
    const first = await prisma.productProvisioning.findFirstOrThrow({ where: { connectionId, catalogProductId: productId } });

    const rows = await preflight(prisma, store, connectionId, [product]);
    expect(rows[0]?.state).toBe('managed');

    await doCommit('update');
    const all = await prisma.productProvisioning.findMany({ where: { connectionId, catalogProductId: productId } });
    expect(all).toHaveLength(1);
    expect(all[0]?.wooProductId).toBe(first.wooProductId);
    expect(store.products.size).toBe(1); // no second product created
  });

  it('a Managed update writes ONLY the stock signal — never price, copy or SKU', async () => {
    await doCommit('create');
    store.updatedPayloads = [];
    await doCommit('update');

    expect(store.updatedPayloads).toHaveLength(1);
    expect(Object.keys(store.updatedPayloads[0] as object).sort()).toEqual(['id', 'manage_stock', 'meta_data', 'stock_status']);
  });

  it('detects Drift when the brand renames the SKU in their store', async () => {
    const [created] = await doCommit('create');
    store.products.get(created!.woo_product_id!)!.sku = 'BRAND-RENAMED';

    const rows = await preflight(prisma, store, connectionId, [product]);
    expect(rows[0]?.state).toBe('drifted');
    expect(rows[0]?.store_sku).toBe('BRAND-RENAMED');
    expect(rows[0]?.default_action).toBe('skip'); // never silently corrected
    expect(rows[0]?.allowed_actions).toEqual(['restore_sku', 'realias', 'skip']);
  });

  it('restore_sku puts the canonical SKU back and clears the drift', async () => {
    const [created] = await doCommit('create');
    const wooId = created!.woo_product_id!;
    store.products.get(wooId)!.sku = 'BRAND-RENAMED';

    const [outcome] = await doCommit('restore_sku');
    expect(outcome?.result).toBe('sku_restored');
    expect(store.products.get(wooId)?.sku).toBe(sku);

    const rows = await preflight(prisma, store, connectionId, [product]);
    expect(rows[0]?.state).toBe('managed');
  });

  it('realias keeps the brand’s SKU and records the alias back to canonical', async () => {
    const [created] = await doCommit('create');
    const wooId = created!.woo_product_id!;
    store.products.get(wooId)!.sku = 'BRAND-RENAMED';

    const [outcome] = await doCommit('realias');
    expect(outcome?.result).toBe('realiased');
    // The store keeps the brand's SKU — we adapt to them, not the reverse.
    expect(store.products.get(wooId)?.sku).toBe('BRAND-RENAMED');

    const alias = await prisma.productAlias.findFirst({ where: { brandId, wooSku: 'BRAND-RENAMED' } });
    expect(alias?.productId).toBe(productId);

    const rec = await prisma.productProvisioning.findFirstOrThrow({ where: { connectionId, catalogProductId: productId } });
    expect(rec.provisionedSku).toBe('BRAND-RENAMED');
  });

  it('flags a Conflict for a foreign product and NEVER writes to it by default', async () => {
    const foreign = store.seed(sku); // brand's own product, same SKU, not ours

    const rows = await preflight(prisma, store, connectionId, [product]);
    expect(rows[0]?.state).toBe('conflict');
    expect(rows[0]?.default_action).toBe('skip');

    const [outcome] = await doCommit('skip');
    expect(outcome?.result).toBe('skipped');
    expect(store.updatedPayloads).toHaveLength(0);
    expect(store.createdPayloads).toHaveLength(0);
    expect(store.products.get(foreign.wooProductId)?.sku).toBe(sku);
    expect(await prisma.productProvisioning.count({ where: { connectionId } })).toBe(0);
  });

  it('refuses an update/create decision on a Conflict even if the client asks', async () => {
    store.seed(sku);

    for (const forced of ['update', 'create']) {
      const [outcome] = await doCommit(forced);
      expect(outcome?.result).toBe('skipped');
      expect(outcome?.error).toMatch(/not valid for a conflict/i);
    }
    expect(store.updatedPayloads).toHaveLength(0);
    expect(store.createdPayloads).toHaveLength(0);
  });

  it('adopt claims the existing product without writing to the store', async () => {
    const foreign = store.seed(sku);

    const [outcome] = await doCommit('adopt');
    expect(outcome?.result).toBe('adopted');
    expect(store.updatedPayloads).toHaveLength(0); // adoption is bookkeeping only

    const rec = await prisma.productProvisioning.findFirstOrThrow({ where: { connectionId, catalogProductId: productId } });
    expect(rec.wooProductId).toBe(foreign.wooProductId);
    expect(rec.adopted).toBe(true);

    // Now managed, so subsequent pushes maintain it normally.
    const rows = await preflight(prisma, store, connectionId, [product]);
    expect(rows[0]?.state).toBe('managed');
  });

  it('treats a deleted store product as New again and recreates it', async () => {
    const [created] = await doCommit('create');
    store.products.delete(created!.woo_product_id!);

    const rows = await preflight(prisma, store, connectionId, [product]);
    expect(rows[0]?.state).toBe('new');
    expect(rows[0]?.note).toMatch(/no longer in your store/i);

    const [outcome] = await doCommit('create');
    expect(outcome?.result).toBe('created');
    // The record is re-pointed at the new store product, not duplicated.
    const all = await prisma.productProvisioning.findMany({ where: { connectionId, catalogProductId: productId } });
    expect(all).toHaveLength(1);
    expect(all[0]?.wooProductId).toBe(outcome?.woo_product_id);
  });

  it('surfaces a store-side duplicate-SKU error instead of silently suffixing', async () => {
    // Pre-flight said New, then someone else grabbed the SKU before commit.
    const rows = await preflight(prisma, store, connectionId, [product]);
    expect(rows[0]?.state).toBe('new');
    store.seed(sku);

    const [outcome] = await doCommit('create');
    // Commit re-classifies: it's a Conflict now, so the create is refused.
    expect(outcome?.result).toBe('skipped');
    expect(outcome?.state).toBe('conflict');
    expect(store.createdPayloads).toHaveLength(0);
  });
});
