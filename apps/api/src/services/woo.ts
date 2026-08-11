import type { BrandStoreConnection } from '@ruostack/db';
import { loadConfig } from '../config.ts';
import { decryptSecret, encryptSecret } from '../crypto.ts';
import { assertPublicHttpUrl } from './ssrf-guard.ts';

/**
 * WooCommerce REST connector. RUOStack is the hub: it pulls orders via webhook
 * and writes tracking back here via the store's REST API (WC v3). Credentials
 * (ck_/cs_) are AES-256-GCM encrypted at rest and only decrypted in-process.
 */

export interface WooCreds {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export function encryptStoreCreds(consumerKey: string, consumerSecret: string): {
  consumerKeyEnc: string;
  consumerSecretEnc: string;
} {
  const key = loadConfig().STORE_CREDS_KEY;
  return {
    consumerKeyEnc: encryptSecret(consumerKey, key),
    consumerSecretEnc: encryptSecret(consumerSecret, key),
  };
}

export function decryptStoreCreds(
  c: Pick<BrandStoreConnection, 'storeUrl' | 'consumerKeyEnc' | 'consumerSecretEnc'>,
): WooCreds {
  const key = loadConfig().STORE_CREDS_KEY;
  return {
    storeUrl: c.storeUrl,
    consumerKey: decryptSecret(c.consumerKeyEnc, key),
    consumerSecret: decryptSecret(c.consumerSecretEnc, key),
  };
}

const trimSlashes = (u: string) => u.replace(/\/+$/, '');

// Abort a stalled store call instead of hanging the request (e.g. the admin
// stock toggle, which fans out sequential Woo calls per SKU per store).
const HTTP_TIMEOUT_MS = 15_000;

export async function wooRequest<T = unknown>(creds: WooCreds, method: string, path: string, body?: unknown): Promise<T> {
  // SSRF guard: the store URL is brand-supplied. Reject non-public hosts before
  // we issue an authenticated request from the API's network.
  await assertPublicHttpUrl(creds.storeUrl);
  const url = `${trimSlashes(creds.storeUrl)}/wp-json/wc/v3${path}`;
  const auth = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64');
  const res = await fetch(url, {
    method,
    headers: { authorization: `Basic ${auth}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Don't auto-follow redirects: a public host could 3xx to an internal one,
    // bypassing the guard above. Surface the redirect as a plain failure instead.
    redirect: 'manual',
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Do NOT reflect the upstream response body to the caller — it could carry
    // internal detail. The status is enough to diagnose a bad key / bad URL.
    throw new Error(`Woo ${method} ${path} → ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Verify credentials by hitting a cheap authenticated endpoint (read scope). */
export async function verifyWooCreds(creds: WooCreds): Promise<void> {
  await wooRequest(creds, 'GET', '/orders?per_page=1');
}

/** Register order.created/updated webhooks pointing at our receiver. Returns ids. */
export async function registerWooWebhooks(creds: WooCreds, deliveryUrl: string, secret: string): Promise<number[]> {
  const ids: number[] = [];
  for (const topic of ['order.created', 'order.updated']) {
    const wh = await wooRequest<{ id: number }>(creds, 'POST', '/webhooks', {
      name: `RUOStack ${topic}`,
      topic,
      delivery_url: deliveryUrl,
      secret,
      status: 'active',
    });
    ids.push(wh.id);
  }
  return ids;
}

/** Best-effort teardown of webhooks we registered (on disconnect). */
export async function deleteWooWebhooks(creds: WooCreds, ids: number[]): Promise<void> {
  for (const id of ids) {
    try {
      await wooRequest(creds, 'DELETE', `/webhooks/${id}?force=true`);
    } catch {
      /* best-effort — the brand may have already revoked keys */
    }
  }
}

// ── Products (provisioning + stock push) ──────────────────────────────────────

/** Find a Woo product id by exact SKU (provisioned products carry the canonical
 * SKU). Returns null if no product has that SKU. */
export async function getProductIdBySku(creds: WooCreds, sku: string): Promise<number | null> {
  const rows = await wooRequest<{ id: number }[]>(creds, 'GET', `/products?sku=${encodeURIComponent(sku)}`);
  return rows[0]?.id ?? null;
}

export interface WooProductInput {
  id?: number; // present → update
  sku: string;
  name: string;
  type: 'simple';
  status?: 'draft' | 'publish'; // omit on update to keep the store's publish state
  regular_price: string; // dollars
  description?: string;
  manage_stock: boolean;
  stock_status: 'instock' | 'outofstock';
  images?: { src: string }[];
  meta_data?: { key: string; value: string }[];
}

/**
 * Update payload — every field optional but `id`, because provisioning updates
 * are FIELD-SCOPED (fulfillment plan §3: "RUOStack only rewrites platform-owned
 * fields, never the brand's price/copy once set"). Sending a whole
 * `WooProductInput` on update would clobber brand-owned columns; this type makes
 * that impossible to do by accident.
 */
export interface WooProductUpdate {
  id: number;
  sku?: string;
  name?: string;
  regular_price?: string;
  description?: string;
  manage_stock?: boolean;
  stock_status?: 'instock' | 'outofstock';
  images?: { src: string }[];
  meta_data?: { key: string; value: string }[];
}

export interface WooBatchResult {
  create?: ({ id?: number; sku?: string; error?: { message?: string } } | null)[];
  update?: ({ id?: number; sku?: string; error?: { message?: string } } | null)[];
}

/** Batch create/update products (WooCommerce caps a batch at 100 per array). */
export async function batchProducts(
  creds: WooCreds,
  payload: { create?: WooProductInput[]; update?: WooProductUpdate[] },
): Promise<WooBatchResult> {
  return wooRequest<WooBatchResult>(creds, 'POST', '/products/batch', payload);
}

/** Stock push: flip a product in/out of stock (prevents selling the unfulfillable). */
export async function updateProductStock(creds: WooCreds, productId: number, inStock: boolean): Promise<void> {
  await wooRequest(creds, 'PUT', `/products/${productId}`, {
    manage_stock: false,
    stock_status: inStock ? 'instock' : 'outofstock',
  });
}

/** Writeback: mark the Woo order completed (fires the brand's shipped email) +
 * attach tracking (Shipment-Tracking meta + a customer-visible note). */
export async function pushTracking(
  creds: WooCreds,
  wooOrderId: string,
  tracking: { carrier: string; number: string },
): Promise<void> {
  await wooRequest(creds, 'PUT', `/orders/${wooOrderId}`, {
    status: 'completed',
    meta_data: [
      { key: '_tracking_number', value: tracking.number },
      { key: '_tracking_provider', value: tracking.carrier },
    ],
  });
  await wooRequest(creds, 'POST', `/orders/${wooOrderId}/notes`, {
    note: `Shipped via ${tracking.carrier}. Tracking: ${tracking.number}`,
    customer_note: true,
  });
}
