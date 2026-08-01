import {
  batchProducts,
  getProductIdBySku,
  wooRequest,
  type WooCreds,
  type WooProductInput,
  type WooProductUpdate,
} from './woo.js';

/**
 * The narrow slice of a storefront the provisioning flow needs, behind an
 * interface. Two reasons this exists rather than calling `woo.ts` directly:
 *
 *  1. Pre-flight and commit are the highest-consequence code in the store
 *     integration — they write into a brand's live store. A seam lets the DB
 *     integration tests exercise every branch (adopt, drift, restore, conflict)
 *     against a fake store, with no network and no mock HTTP server.
 *  2. The connection layer is meant to extend past WooCommerce (Wix is on the
 *     backlog); this is where a second implementation would slot in.
 */
export interface StoreProduct {
  wooProductId: number;
  sku: string;
  name?: string;
}

export interface ProvisioningStoreClient {
  /** null when the product no longer exists in the store. */
  getProductById(id: number): Promise<StoreProduct | null>;
  /** null when no product carries that SKU. */
  findProductBySku(sku: string): Promise<StoreProduct | null>;
  createProducts(inputs: WooProductInput[]): Promise<{ sku?: string; id?: number; error?: string }[]>;
  updateProducts(updates: WooProductUpdate[]): Promise<{ id?: number; error?: string }[]>;
}

export function wooStoreClient(creds: WooCreds): ProvisioningStoreClient {
  return {
    async getProductById(id) {
      try {
        const p = await wooRequest<{ id: number; sku?: string; name?: string }>(creds, 'GET', `/products/${id}`);
        // A deleted product 404s (handled below); a trashed one can come back
        // without an id — treat both as gone.
        if (!p?.id) return null;
        return { wooProductId: p.id, sku: p.sku ?? '', name: p.name };
      } catch (e) {
        if (e instanceof Error && /→ 404/.test(e.message)) return null;
        throw e;
      }
    },

    async findProductBySku(sku) {
      const id = await getProductIdBySku(creds, sku);
      return id === null ? null : { wooProductId: id, sku };
    },

    async createProducts(inputs) {
      if (inputs.length === 0) return [];
      const res = await batchProducts(creds, { create: inputs });
      return (res.create ?? []).filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ sku: r.sku, id: r.id, error: r.error?.message }));
    },

    async updateProducts(updates) {
      if (updates.length === 0) return [];
      const res = await batchProducts(creds, { update: updates });
      return (res.update ?? []).filter((r): r is NonNullable<typeof r> => !!r).map((r) => ({ id: r.id, error: r.error?.message }));
    },
  };
}
