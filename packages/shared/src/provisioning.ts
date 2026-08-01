import { z } from 'zod';

/**
 * Product provisioning pre-flight (fulfillment plan §3, architecture §3.3).
 *
 * Before ANY write, each selected product is classified against the brand's
 * store. The whole point is that a brand's store is *theirs*: it holds products
 * we didn't create, edits we don't own, and a publish decision that isn't ours.
 * WooCommerce also enforces store-wide unique SKUs, so a blind push turns a
 * would-be import error into silent damage. Pre-flight turns it into a choice.
 *
 * Two rules the whole design rests on:
 *   1. NEVER auto-suffix a SKU (`…-10MG-2`). That silently breaks the
 *      deterministic exact-SKU matching every order depends on. A non-canonical
 *      SKU exists only if the brand opts in — and then their real SKU is
 *      captured as a ProductAlias so order-time matching still resolves.
 *   2. Stable identity is the store's product id, never the SKU.
 */
export const PROVISIONING_STATES = ['new', 'managed', 'drifted', 'conflict'] as const;
export type ProvisioningState = (typeof PROVISIONING_STATES)[number];

export const PROVISIONING_ACTIONS = ['create', 'update', 'skip', 'adopt', 'restore_sku', 'realias'] as const;
export type ProvisioningAction = (typeof PROVISIONING_ACTIONS)[number];

const STATE_LABEL: Record<ProvisioningState, string> = {
  new: 'New',
  managed: 'Managed',
  drifted: 'Drifted',
  conflict: 'Conflict',
};
export const provisioningStateLabel = (s: ProvisioningState): string => STATE_LABEL[s];

const STATE_EXPLAIN: Record<ProvisioningState, string> = {
  new: 'Will be created as a draft for you to review and publish.',
  managed: 'Already in your store. Stock status is refreshed — your price and copy are untouched.',
  drifted: 'The SKU changed in your store. Orders will stop matching until this is resolved.',
  conflict: 'That SKU is already on a product RUOStack did not create. Nothing will be overwritten.',
};
export const provisioningStateExplain = (s: ProvisioningState): string => STATE_EXPLAIN[s];

/** What the store knows about a product we asked it about. */
export interface StoreProductRef {
  wooProductId: number;
  sku: string;
}

/** Our own record of having provisioned this catalog product into this store. */
export interface ProvisioningRecordRef {
  wooProductId: number;
  provisionedSku: string;
}

export interface ClassifyInput {
  canonicalSku: string;
  /** Our provisioning row for (connection, catalog product), if any. */
  record: ProvisioningRecordRef | null;
  /** The store product our record points at — null if it's gone from the store. */
  recordedProduct: StoreProductRef | null;
  /** Any store product currently carrying the canonical SKU. */
  productWithCanonicalSku: StoreProductRef | null;
}

export interface Classification {
  state: ProvisioningState;
  /** The store product this decision acts on, when one exists. */
  wooProductId: number | null;
  /** The SKU as it currently stands in the store (drifted/conflict/managed). */
  storeSku: string | null;
  allowedActions: ProvisioningAction[];
  defaultAction: ProvisioningAction;
  /** Human-readable qualifier for the row, when the plain state undersells it. */
  note?: string;
}

/**
 * Classify one product. Pure — all store/DB lookups are done by the caller, so
 * every branch here is directly testable.
 */
export function classifyProduct(input: ClassifyInput): Classification {
  const { canonicalSku, record, recordedProduct, productWithCanonicalSku } = input;

  if (record) {
    // We provisioned this before. Is it still there?
    if (!recordedProduct) {
      // Deleted in the store since we created it. Recreate — but if something
      // else has since taken the canonical SKU, that's a conflict, not a create.
      if (productWithCanonicalSku) {
        return {
          state: 'conflict',
          wooProductId: productWithCanonicalSku.wooProductId,
          storeSku: productWithCanonicalSku.sku,
          allowedActions: ['skip', 'adopt'],
          defaultAction: 'skip',
          note: 'The product we created was deleted, and another product now uses this SKU.',
        };
      }
      return {
        state: 'new',
        wooProductId: null,
        storeSku: null,
        allowedActions: ['create', 'skip'],
        defaultAction: 'create',
        note: 'Previously provisioned, but no longer in your store — it will be recreated.',
      };
    }

    if (recordedProduct.sku === canonicalSku) {
      return {
        state: 'managed',
        wooProductId: recordedProduct.wooProductId,
        storeSku: recordedProduct.sku,
        allowedActions: ['update', 'skip'],
        defaultAction: 'update',
      };
    }

    // SKU changed on their side — the case that silently breaks order matching.
    // Restoring is only offered when the canonical SKU is actually free: Woo
    // enforces unique SKUs, so restoring into an occupied SKU would just error.
    const canonicalTaken =
      productWithCanonicalSku !== null && productWithCanonicalSku.wooProductId !== recordedProduct.wooProductId;
    return {
      state: 'drifted',
      wooProductId: recordedProduct.wooProductId,
      storeSku: recordedProduct.sku,
      allowedActions: canonicalTaken ? ['realias', 'skip'] : ['restore_sku', 'realias', 'skip'],
      // Default to no write: drift is resolved by an explicit choice, never
      // silently "corrected" underneath the brand.
      defaultAction: 'skip',
      ...(canonicalTaken
        ? { note: `Another product already uses ${canonicalSku}, so the SKU cannot be restored — re-alias instead.` }
        : {}),
    };
  }

  // No record of us provisioning it.
  if (!productWithCanonicalSku) {
    return { state: 'new', wooProductId: null, storeSku: null, allowedActions: ['create', 'skip'], defaultAction: 'create' };
  }

  // The SKU exists on a product we have no record of creating. NEVER overwrite:
  // skip by default, adopt only if the brand explicitly claims it.
  return {
    state: 'conflict',
    wooProductId: productWithCanonicalSku.wooProductId,
    storeSku: productWithCanonicalSku.sku,
    allowedActions: ['skip', 'adopt'],
    defaultAction: 'skip',
  };
}

/** Is `action` legal for `state`? Enforced server-side on commit, not just in the UI. */
export function isActionAllowed(state: ProvisioningState, action: ProvisioningAction): boolean {
  const allowed: Record<ProvisioningState, ProvisioningAction[]> = {
    new: ['create', 'skip'],
    managed: ['update', 'skip'],
    drifted: ['restore_sku', 'realias', 'skip'],
    conflict: ['skip', 'adopt'],
  };
  return allowed[state].includes(action);
}

export const PreflightRequestSchema = z.object({
  product_ids: z.array(z.string().uuid()).min(1).max(200),
});
export type PreflightRequest = z.infer<typeof PreflightRequestSchema>;

export const CommitRequestSchema = z.object({
  decisions: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        action: z.enum(PROVISIONING_ACTIONS),
      }),
    )
    .min(1)
    .max(200),
});
export type CommitRequest = z.infer<typeof CommitRequestSchema>;
