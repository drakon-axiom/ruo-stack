import type { PrismaClient } from '@ruostack/db';
import {
  classifyProduct,
  isActionAllowed,
  type Classification,
  type ProvisioningAction,
  type ProvisioningState,
} from '@ruostack/shared';
import type { ProvisioningStoreClient } from './store-client.js';
import { newWooProductInput, platformOwnedUpdate, type ProvisionProduct } from './store-provision.js';

/**
 * Pre-flight + commit (fulfillment plan §3, architecture §3.3).
 *
 * Pre-flight is READ-ONLY: it classifies each selected product against the
 * store and returns what *would* happen. Nothing is written until commit, and
 * commit re-classifies before acting — the store can change between the two, and
 * a stale "New" must not become a blind overwrite.
 */

export interface PreflightRow {
  product_id: string;
  canonical_sku: string;
  name: string;
  state: ProvisioningState;
  woo_product_id: number | null;
  store_sku: string | null;
  allowed_actions: ProvisioningAction[];
  default_action: ProvisioningAction;
  note?: string;
}

interface ClassifiedProduct {
  product: ProvisionProduct;
  classification: Classification;
  /** What we last recorded in the store for this product, if anything. */
  provisionedSku: string | null;
}

/**
 * Classify each product against the store. One store round-trip per product per
 * lookup kind — acceptable because a brand provisions tens of products, not
 * thousands, and correctness here matters more than a batched read.
 */
async function classifyAll(
  prisma: PrismaClient,
  store: ProvisioningStoreClient,
  connectionId: string,
  products: ProvisionProduct[],
): Promise<ClassifiedProduct[]> {
  const records = await prisma.productProvisioning.findMany({
    where: { connectionId, catalogProductId: { in: products.map((p) => p.id) } },
  });
  const byProduct = new Map(records.map((r) => [r.catalogProductId, r]));

  const out: ClassifiedProduct[] = [];
  for (const product of products) {
    const record = byProduct.get(product.id) ?? null;

    const recordedProduct = record ? await store.getProductById(record.wooProductId) : null;
    // Only look up the canonical SKU when the answer can change the outcome:
    // no record at all, the recorded product vanished, or it drifted.
    const needsSkuLookup = !record || !recordedProduct || recordedProduct.sku !== product.canonicalSku;
    const productWithCanonicalSku = needsSkuLookup ? await store.findProductBySku(product.canonicalSku) : null;

    out.push({
      product,
      provisionedSku: record?.provisionedSku ?? null,
      classification: classifyProduct({
        canonicalSku: product.canonicalSku,
        record: record ? { wooProductId: record.wooProductId, provisionedSku: record.provisionedSku } : null,
        recordedProduct,
        productWithCanonicalSku,
      }),
    });
  }
  return out;
}

export async function preflight(
  prisma: PrismaClient,
  store: ProvisioningStoreClient,
  connectionId: string,
  products: ProvisionProduct[],
): Promise<PreflightRow[]> {
  const classified = await classifyAll(prisma, store, connectionId, products);
  return classified.map(({ product, classification }) => ({
    product_id: product.id,
    canonical_sku: product.canonicalSku,
    name: product.name,
    state: classification.state,
    woo_product_id: classification.wooProductId,
    store_sku: classification.storeSku,
    allowed_actions: classification.allowedActions,
    default_action: classification.defaultAction,
    ...(classification.note ? { note: classification.note } : {}),
  }));
}

export interface CommitOutcome {
  product_id: string;
  canonical_sku: string;
  name: string;
  state: ProvisioningState;
  action: ProvisioningAction;
  /** What actually happened — `action` is what was asked for. */
  result: 'created' | 'updated' | 'adopted' | 'sku_restored' | 'realiased' | 'skipped' | 'error';
  woo_product_id?: number;
  error?: string;
}

export interface CommitInput {
  brandId: string;
  connectionId: string;
  /** product_id → chosen action. Anything absent is skipped. */
  decisions: Map<string, ProvisioningAction>;
}

/**
 * Apply the brand's decisions. Idempotent on the store product id: re-running a
 * commit with the same decisions converges rather than duplicating, because
 * every write is keyed to a `ProductProvisioning` row upserted on
 * (connection, catalog product).
 */
export async function commit(
  prisma: PrismaClient,
  store: ProvisioningStoreClient,
  input: CommitInput,
  products: ProvisionProduct[],
): Promise<CommitOutcome[]> {
  const classified = await classifyAll(prisma, store, input.connectionId, products);
  const outcomes: CommitOutcome[] = [];

  // Bucket the writes so creates and updates each go out as one batch call.
  const toCreate: { product: ProvisionProduct; state: ProvisioningState }[] = [];
  const toUpdateStock: { product: ProvisionProduct; wooProductId: number; state: ProvisioningState; skuToWrite: string }[] = [];
  const toRestoreSku: { product: ProvisionProduct; wooProductId: number }[] = [];
  const adopts: { product: ProvisionProduct; wooProductId: number; storeSku: string }[] = [];
  const realiases: { product: ProvisionProduct; wooProductId: number; storeSku: string }[] = [];

  for (const { product, classification, provisionedSku } of classified) {
    const asked = input.decisions.get(product.id) ?? 'skip';

    // Re-validate against the FRESH classification, not the one the browser saw.
    // If the store changed under us, an action that is no longer legal is
    // downgraded to a skip rather than forced through.
    if (asked === 'skip' || !isActionAllowed(classification.state, asked)) {
      outcomes.push({
        product_id: product.id,
        canonical_sku: product.canonicalSku,
        name: product.name,
        state: classification.state,
        action: asked,
        result: 'skipped',
        ...(asked !== 'skip'
          ? { error: `'${asked}' is not valid for a ${classification.state} product — the store changed since pre-flight` }
          : {}),
      });
      continue;
    }

    switch (asked) {
      case 'create':
        toCreate.push({ product, state: classification.state });
        break;
      case 'update':
        toUpdateStock.push({
          product,
          wooProductId: classification.wooProductId!,
          state: classification.state,
          // Write back the SKU we recorded — canonical normally, the brand's own
          // after a deliberate re-alias. Never silently re-canonicalise.
          skuToWrite: provisionedSku ?? product.canonicalSku,
        });
        break;
      case 'restore_sku':
        toRestoreSku.push({ product, wooProductId: classification.wooProductId! });
        break;
      case 'adopt':
        adopts.push({ product, wooProductId: classification.wooProductId!, storeSku: classification.storeSku ?? product.canonicalSku });
        break;
      case 'realias':
        realiases.push({ product, wooProductId: classification.wooProductId!, storeSku: classification.storeSku ?? product.canonicalSku });
        break;
    }
  }

  // ── Creates ───────────────────────────────────────────────────────────────
  if (toCreate.length) {
    const results = await store.createProducts(toCreate.map(({ product }) => newWooProductInput(product)));
    const bySku = new Map(toCreate.map(({ product, state }) => [product.canonicalSku, { product, state }]));
    for (const r of results) {
      const hit = r.sku ? bySku.get(r.sku) : undefined;
      if (!hit) continue;
      if (r.error || !r.id) {
        outcomes.push({
          product_id: hit.product.id,
          canonical_sku: hit.product.canonicalSku,
          name: hit.product.name,
          state: hit.state,
          action: 'create',
          result: 'error',
          error: r.error ?? 'store did not return a product id',
        });
        continue;
      }
      await upsertProvisioning(prisma, input, hit.product.id, r.id, hit.product.canonicalSku, false);
      outcomes.push({
        product_id: hit.product.id,
        canonical_sku: hit.product.canonicalSku,
        name: hit.product.name,
        state: hit.state,
        action: 'create',
        result: 'created',
        woo_product_id: r.id,
      });
    }
  }

  // ── Field-scoped updates (stock signal only — see platformOwnedUpdate) ─────
  if (toUpdateStock.length) {
    const results = await store.updateProducts(
      toUpdateStock.map(({ product, wooProductId, skuToWrite }) => platformOwnedUpdate(product, wooProductId, skuToWrite)),
    );
    const byId = new Map(toUpdateStock.map((u) => [u.wooProductId, u]));
    for (const r of results) {
      const hit = r.id !== undefined ? byId.get(r.id) : undefined;
      if (!hit) continue;
      if (!r.error) await touchProvisioning(prisma, input.connectionId, hit.product.id);
      outcomes.push({
        product_id: hit.product.id,
        canonical_sku: hit.product.canonicalSku,
        name: hit.product.name,
        state: hit.state,
        action: 'update',
        result: r.error ? 'error' : 'updated',
        woo_product_id: hit.wooProductId,
        ...(r.error ? { error: r.error } : {}),
      });
    }
  }

  // ── Restore a drifted SKU back to canonical ───────────────────────────────
  if (toRestoreSku.length) {
    const results = await store.updateProducts(
      toRestoreSku.map(({ product, wooProductId }) => ({ id: wooProductId, sku: product.canonicalSku })),
    );
    const byId = new Map(toRestoreSku.map((u) => [u.wooProductId, u]));
    for (const r of results) {
      const hit = r.id !== undefined ? byId.get(r.id) : undefined;
      if (!hit) continue;
      if (!r.error) {
        await upsertProvisioning(prisma, input, hit.product.id, hit.wooProductId, hit.product.canonicalSku, undefined);
      }
      outcomes.push({
        product_id: hit.product.id,
        canonical_sku: hit.product.canonicalSku,
        name: hit.product.name,
        state: 'drifted',
        action: 'restore_sku',
        result: r.error ? 'error' : 'sku_restored',
        woo_product_id: hit.wooProductId,
        ...(r.error ? { error: r.error } : {}),
      });
    }
  }

  // ── Adopt: claim a pre-existing product, no store write at all ─────────────
  for (const { product, wooProductId, storeSku } of adopts) {
    await upsertProvisioning(prisma, input, product.id, wooProductId, storeSku, true);
    // Its SKU is normally already canonical (that's how we found it), so the
    // alias is a no-op in the common case — but adopting a differently-SKU'd
    // product must still resolve at order time.
    if (storeSku !== product.canonicalSku) {
      await upsertAlias(prisma, input.brandId, storeSku, product.id, wooProductId);
    }
    outcomes.push({
      product_id: product.id,
      canonical_sku: product.canonicalSku,
      name: product.name,
      state: 'conflict',
      action: 'adopt',
      result: 'adopted',
      woo_product_id: wooProductId,
    });
  }

  // ── Re-alias: keep the brand's SKU, map it back to canonical ──────────────
  for (const { product, wooProductId, storeSku } of realiases) {
    await upsertAlias(prisma, input.brandId, storeSku, product.id, wooProductId);
    await upsertProvisioning(prisma, input, product.id, wooProductId, storeSku, undefined);
    outcomes.push({
      product_id: product.id,
      canonical_sku: product.canonicalSku,
      name: product.name,
      state: 'drifted',
      action: 'realias',
      result: 'realiased',
      woo_product_id: wooProductId,
    });
  }

  return outcomes;
}

async function upsertProvisioning(
  prisma: PrismaClient,
  input: CommitInput,
  catalogProductId: string,
  wooProductId: number,
  provisionedSku: string,
  adopted: boolean | undefined,
): Promise<void> {
  await prisma.productProvisioning.upsert({
    where: { connectionId_catalogProductId: { connectionId: input.connectionId, catalogProductId } },
    create: {
      brandId: input.brandId,
      connectionId: input.connectionId,
      catalogProductId,
      wooProductId,
      provisionedSku,
      adopted: adopted ?? false,
      lastPushedAt: new Date(),
    },
    update: {
      wooProductId,
      provisionedSku,
      ...(adopted === undefined ? {} : { adopted }),
      lastPushedAt: new Date(),
    },
  });
}

async function touchProvisioning(prisma: PrismaClient, connectionId: string, catalogProductId: string): Promise<void> {
  await prisma.productProvisioning.updateMany({
    where: { connectionId, catalogProductId },
    data: { lastPushedAt: new Date() },
  });
}

/** Alias is keyed (brand, wooSku) — re-pointing an existing alias is legitimate. */
async function upsertAlias(
  prisma: PrismaClient,
  brandId: string,
  wooSku: string,
  productId: string,
  wooProductId: number,
): Promise<void> {
  await prisma.productAlias.upsert({
    where: { brandId_wooSku: { brandId, wooSku } },
    create: { brandId, wooSku, productId, wooProductId: String(wooProductId) },
    update: { productId, wooProductId: String(wooProductId) },
  });
}
