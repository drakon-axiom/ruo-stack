import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { FLAT_FALLBACK, priceOption, type ShippingPricing } from '@ruostack/shared';
import { persistRateQuotes, findRateQuote, type CartItem } from '../../src/services/rate-quote.ts';
import { randomToken } from '../../src/crypto.ts';

// The wallet reserves the quoted brand cost (amountCents). The flat fallback is
// all-in, so its reserve must equal $12.99 — not $12.99 + pick-&-pack. Self-skips
// unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

describe.skipIf(!RUN)('rate-quote reserve matches brand cost (DB integration)', () => {
  let brandId: string;
  const pricing: ShippingPricing = { pickpackCents: 250, markupCents: 100 };
  const items: CartItem[] = [{ sku: 'X', qty: 1 }];
  const dest = { zip: '10001', state: 'NY' };
  const parcel = { weightOz: 9, lengthIn: 6, widthIn: 4, heightIn: 2, boxId: null, boxName: null };

  beforeAll(async () => {
    const b = await prisma.brand.create({ data: { brandName: 'Rate WT', referralCode: `RW-${randomToken(5)}` } });
    brandId = b.id;
  });
  afterAll(async () => {
    await prisma.rateQuote.deleteMany({ where: { brandId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('reserves the flat fallback all-in (no double pick-&-pack), and a normal option at carrier + fee', async () => {
    const flat = priceOption(FLAT_FALLBACK, pricing, true); // isFlat → amountCents == carrierCents == 1299
    const normal = priceOption(
      { carrier: 'USPS', service: 'Priority', serviceCode: 'usps_priority', amountCents: 800 },
      pricing,
      false,
    ); // amountCents = 800 + 250 = 1050

    await persistRateQuotes(prisma, { brandId, items, dest, parcel, pricing, options: [flat, normal] });

    const flatQuote = await findRateQuote(prisma, brandId, items, dest, FLAT_FALLBACK.serviceCode);
    const normalQuote = await findRateQuote(prisma, brandId, items, dest, 'usps_priority');

    // Flat is all-in: reserve == 1299, NOT 1299 + 250.
    expect(flatQuote?.brandCostCents).toBe(flat.amountCents);
    expect(flatQuote?.brandCostCents).toBe(1299);
    // Normal: reserve == carrier + pick-&-pack == the option's amountCents.
    expect(normalQuote?.brandCostCents).toBe(normal.amountCents);
    expect(normalQuote?.brandCostCents).toBe(1050);
  });
});
