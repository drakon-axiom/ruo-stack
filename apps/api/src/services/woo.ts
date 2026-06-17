import type { BrandStoreConnection } from '@ruostack/db';
import { loadConfig } from '../config.js';
import { decryptSecret, encryptSecret } from '../crypto.js';

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
  const key = loadConfig().MFA_ENCRYPTION_KEY;
  return {
    consumerKeyEnc: encryptSecret(consumerKey, key),
    consumerSecretEnc: encryptSecret(consumerSecret, key),
  };
}

export function decryptStoreCreds(
  c: Pick<BrandStoreConnection, 'storeUrl' | 'consumerKeyEnc' | 'consumerSecretEnc'>,
): WooCreds {
  const key = loadConfig().MFA_ENCRYPTION_KEY;
  return {
    storeUrl: c.storeUrl,
    consumerKey: decryptSecret(c.consumerKeyEnc, key),
    consumerSecret: decryptSecret(c.consumerSecretEnc, key),
  };
}

const trimSlashes = (u: string) => u.replace(/\/+$/, '');

export async function wooRequest<T = unknown>(creds: WooCreds, method: string, path: string, body?: unknown): Promise<T> {
  const url = `${trimSlashes(creds.storeUrl)}/wp-json/wc/v3${path}`;
  const auth = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64');
  const res = await fetch(url, {
    method,
    headers: { authorization: `Basic ${auth}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Woo ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
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
