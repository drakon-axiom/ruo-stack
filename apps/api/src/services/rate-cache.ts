import type { RateOption, RateQuoteInput } from '@ruostack/shared';
import { loadConfig } from '../config.js';
import { quoteRates } from './rates/index.js';

/**
 * Short-TTL carrier-rate cache (§4): checkout must never hammer the rater. Caches
 * the RAW carrier response keyed by {fromZip, toZip, weight bucket} — curation,
 * fee, and per-brand markup are still applied fresh downstream, so the cache is
 * brand-agnostic and safe to share. In-memory (per process); the TTL is short
 * enough that staleness is a non-issue.
 */
interface Entry {
  expires: number;
  value: { source: string; options: RateOption[] };
}

const cache = new Map<string, Entry>();
const MAX_ENTRIES = 500;

// Key on everything that changes the carrier rate: origin/destination, the exact
// weight actually sent to the carrier (rounded oz), the parcel dimensions
// (dimensional weight / surcharges), and residential vs commercial. The previous
// key used only zips + an 8oz weight bucket, so two different parcels to the same
// ZIP (e.g. a 9oz small box and a 16oz large box) collided and the second was
// served the first's rates.
export function cacheKey(input: RateQuoteInput): string {
  const wt = Math.max(1, Math.round(input.weightOz)); // the oz value sent to the carrier
  const dims =
    input.lengthIn && input.widthIn && input.heightIn
      ? `${input.lengthIn}x${input.widthIn}x${input.heightIn}`
      : 'nodim';
  const res = input.residential === false ? 'comm' : 'res';
  return `${input.fromZip}|${input.toZip}|${input.toState}|${input.toCountry}|${wt}|${dims}|${res}`;
}

export async function cachedQuoteRates(input: RateQuoteInput): Promise<{ source: string; options: RateOption[]; cached: boolean }> {
  const ttlMs = loadConfig().RATE_CACHE_TTL_SECONDS * 1000;
  const key = cacheKey(input);
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && hit.expires > now) return { ...hit.value, cached: true };

  const value = await quoteRates(input);
  if (cache.size >= MAX_ENTRIES) cache.clear(); // simple bound; entries are short-lived
  cache.set(key, { expires: now + ttlMs, value });
  return { ...value, cached: false };
}

/** Test helper — drop all cached rates. */
export function clearRateCache(): void {
  cache.clear();
}
