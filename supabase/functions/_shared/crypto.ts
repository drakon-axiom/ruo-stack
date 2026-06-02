// AES-GCM encryption for store credentials (WooCommerce consumer key/secret,
// etc.) before they're written to store_connections.credentials_encrypted.
//
// Key comes from the CREDENTIALS_ENC_KEY edge-function secret: a base64-encoded
// 32-byte (256-bit) key. Generate one with:
//   openssl rand -base64 32
//
// Stored format: "<base64 iv>:<base64 ciphertext>". This is a pragmatic
// app-layer encryption; for higher assurance move to Supabase Vault / a KMS.

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('CREDENTIALS_ENC_KEY');
  if (!raw) throw new Error('CREDENTIALS_ENC_KEY not set');
  const keyBytes = b64decode(raw);
  if (keyBytes.length !== 32) throw new Error('CREDENTIALS_ENC_KEY must decode to 32 bytes');
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptJson(value: unknown): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return `${b64encode(iv)}:${b64encode(new Uint8Array(ct))}`;
}

export async function decryptJson<T = unknown>(blob: string): Promise<T> {
  const key = await getKey();
  const [ivB64, ctB64] = blob.split(':');
  if (!ivB64 || !ctB64) throw new Error('malformed ciphertext');
  const iv = b64decode(ivB64);
  const ct = b64decode(ctB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
