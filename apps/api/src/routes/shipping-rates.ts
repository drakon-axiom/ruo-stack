import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { FLAT_FALLBACK, priceOption, type PricedRateOption } from '@ruostack/shared';
import { getClients } from '../clients.js';
import { loadConfig } from '../config.js';
import { effectivePlan } from '../services/subscription.js';
import { deriveParcel, loadShippingRules, priceShipping, resolveShippingPricing, type ParcelProduct } from '../services/shipping.js';
import { persistRateQuotes } from '../services/rate-quote.js';

/**
 * Checkout rate proxy (fulfillment plan §4). The RUOStack Shipping Method (a
 * WooCommerce plugin on the brand's store) POSTs here during checkout with the
 * cart's SKUs + destination; we return live carrier rates as NAMED services at
 * the customer price (carrier + pick-&-pack + brand markup). Resilient: any
 * error, unmapped SKU, or empty result → the single $12.99 flat fallback, so
 * checkout never blocks. Authenticated by the connection's store key (the
 * per-connection webhook secret) — no brand JWT.
 */
const RateReqSchema = z.object({
  connection_id: z.string().uuid(),
  items: z.array(z.object({ sku: z.string().min(1).max(60), qty: z.number().int().min(1).max(999) })).min(1).max(100),
  destination: z.object({ zip: z.string().min(1).max(20), state: z.string().min(1).max(60), country: z.string().max(2).optional() }),
});

export async function shippingRatesRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  app.post('/api/shipping/rates', async (req, reply) => {
    const body = RateReqSchema.parse(req.body);
    const conn = await prisma.brandStoreConnection.findUnique({ where: { id: body.connection_id } });
    const storeKey = (req.headers['x-ruostack-store-key'] as string | undefined) ?? '';
    if (!conn || !safeEqual(storeKey, conn.webhookSecret)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (conn.status === 'disabled') return reply.code(403).send({ error: 'disabled' });

    const sub = await prisma.subscriptionState.findUnique({ where: { brandId: conn.brandId }, select: { plan: true, status: true, currentPeriodEnd: true } });
    const plan = effectivePlan(sub);
    const pricing = await resolveShippingPricing(prisma, conn.brandId);
    const fallback = { rates: [toRate(priceOption(FLAT_FALLBACK, pricing, true))], source: 'fallback' };

    try {
      // Map SKUs → catalog by exact canonical SKU. Any miss → fallback (§4 resilience).
      const skus = body.items.map((i) => i.sku.trim());
      const products = await prisma.catalogProduct.findMany({
        where: { canonicalSku: { in: skus }, isPublished: true },
        select: { canonicalSku: true, weight: true, length: true, width: true, height: true },
      });
      const bySku = new Map(products.map((p) => [p.canonicalSku, p]));
      const parcelItems: ParcelProduct[] = [];
      for (const it of body.items) {
        const p = bySku.get(it.sku.trim());
        if (!p) return reply.send(fallback);
        parcelItems.push({ qty: it.qty, weight: p.weight, length: p.length, width: p.width, height: p.height });
      }

      const rules = await loadShippingRules(prisma);
      const parcel = deriveParcel(parcelItems, rules.boxes, loadConfig().SHIPPING_DIM_DIVISOR);
      const q = await priceShipping(plan, parcel, { toZip: body.destination.zip, toState: body.destination.state }, undefined, pricing, rules.mappings);
      // Persist the offered options so order import reserves the exact quote (§9).
      await persistRateQuotes(prisma, { brandId: conn.brandId, items: body.items, dest: { zip: body.destination.zip, state: body.destination.state }, parcel, pricing, options: q.options });
      return reply.send({ rates: q.options.map(toRate), source: q.source });
    } catch (err) {
      req.log.error({ err }, 'rate quote failed → flat fallback');
      return reply.send(fallback);
    }
  });
}

/** Customer-facing rate row — amount is the CUSTOMER price (pick-&-pack hidden inside). */
function toRate(o: PricedRateOption) {
  return { carrier: o.carrier, service: o.service, service_code: o.serviceCode, amount_cents: o.customerCents, est_days: o.estDays ?? null };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
