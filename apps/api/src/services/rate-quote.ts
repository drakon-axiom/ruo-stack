import { createHash } from 'node:crypto';
import type { PrismaClient } from '@ruostack/db';
import type { PricedRateOption, ShippingPricing } from '@ruostack/shared';
import { loadConfig } from '../config.ts';
import type { DerivedParcel } from './fulfillment-rules.ts';

/**
 * RateQuote persistence (§9 quote-driven reserve). The rate proxy persists every
 * offered option for a cart at checkout; when the order imports we reserve the
 * EXACT quoted shipping (brand cost = carrier + pick-&-pack) and lock the box +
 * billable weight from the matching quote, rather than re-rating. Matched by a
 * stable cart_hash (sorted SKU:qty + destination) + the chosen service.
 */
export interface CartItem {
  sku: string;
  qty: number;
}

/** Deterministic, order-independent hash of the cart + destination. */
export function cartHash(items: CartItem[], dest: { zip: string; state: string }): string {
  const norm = items.map((i) => `${i.sku.trim().toLowerCase()}:${i.qty}`).sort().join(',');
  return createHash('sha256').update(`${norm}|${dest.zip.trim()}|${dest.state.trim().toLowerCase()}`).digest('hex').slice(0, 32);
}

export async function persistRateQuotes(
  db: PrismaClient,
  args: {
    brandId: string;
    items: CartItem[];
    dest: { zip: string; state: string };
    parcel: DerivedParcel;
    pricing: ShippingPricing;
    options: PricedRateOption[];
  },
): Promise<void> {
  const hash = cartHash(args.items, args.dest);
  const expiresAt = new Date(Date.now() + loadConfig().RATE_QUOTE_TTL_SECONDS * 1000);
  // A fresh quote for the same cart supersedes the prior one.
  await db.rateQuote.deleteMany({ where: { brandId: args.brandId, cartHash: hash } });
  if (args.options.length === 0) return;
  await db.rateQuote.createMany({
    data: args.options.map((o) => ({
      brandId: args.brandId,
      cartHash: hash,
      destZip: args.dest.zip,
      destState: args.dest.state,
      serviceCode: o.serviceCode,
      carrierCostCents: o.carrierCents,
      // Derive the pick-&-pack from THIS option's brand cost, not the global fee.
      // For a normal option amountCents = carrier + pick-&-pack (so this is the
      // fee); for the $12.99 flat fallback amountCents is all-in (carrierCents),
      // so this is 0 — otherwise reserve = carrier + pick-&-pack double-charges it.
      pickpackCents: o.amountCents - o.carrierCents,
      brandMarkupCents: args.pricing.markupCents,
      customerPriceCents: o.customerCents,
      boxId: args.parcel.boxId,
      billableWeightOz: args.parcel.weightOz,
      expiresAt,
    })),
  });
}

export interface QuotedShipping {
  brandCostCents: number; // carrier + pick-&-pack — what the wallet reserves
  serviceCode: string;
  boxId: string | null;
  billableWeightOz: number;
}

/** Delete RateQuotes past their expiry. Returns how many were removed. */
export async function deleteExpiredRateQuotes(db: PrismaClient): Promise<number> {
  const { count } = await db.rateQuote.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

/**
 * Start a periodic expired-RateQuote sweeper (runs once now, then every interval).
 * Returns a stop function. Unref'd so it never keeps the process alive on its own.
 */
export function startRateQuoteSweeper(
  db: PrismaClient,
  intervalMs: number,
  log?: (msg: string) => void,
): () => void {
  const sweep = () => {
    deleteExpiredRateQuotes(db)
      .then((n) => { if (n > 0) log?.(`swept ${n} expired rate quotes`); })
      .catch((err) => log?.(`rate-quote sweep failed: ${err instanceof Error ? err.message : err}`));
  };
  sweep();
  const timer = setInterval(sweep, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

/** Look up a still-valid quote for this cart + chosen service. Null if none/expired. */
export async function findRateQuote(
  db: PrismaClient,
  brandId: string,
  items: CartItem[],
  dest: { zip: string; state: string },
  serviceCode: string,
): Promise<QuotedShipping | null> {
  const hash = cartHash(items, dest);
  const q = await db.rateQuote.findFirst({
    where: { brandId, cartHash: hash, serviceCode, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!q) return null;
  return { brandCostCents: q.carrierCostCents + q.pickpackCents, serviceCode: q.serviceCode, boxId: q.boxId, billableWeightOz: q.billableWeightOz };
}
