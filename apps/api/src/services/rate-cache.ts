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
const WEIGHT_BUCKET_OZ = 8;

function cacheKey(input: RateQuoteInput): string {
  const bucket = Math.ceil(input.weightOz / WEIGHT_BUCKET_OZ);
  return `${input.fromZip}|${input.toZip}|${bucket}`;
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
