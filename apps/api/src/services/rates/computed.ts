import type { RateOption, RateQuoteInput, RatesAdapter } from '@ruostack/shared';

/**
 * Deterministic weight/zone rater (USPS Ground Advantage-style). The default and
 * the fallback when ShipStation isn't configured/available. Rates genuinely vary
 * by package weight and destination zone — not flat — but are an approximation,
 * not negotiated carrier pricing. Swap in ShipStation/EasyPost for real rates.
 */
export class ComputedRatesAdapter implements RatesAdapter {
  readonly source = 'computed';

  async getRates(input: RateQuoteInput): Promise<RateOption[]> {
    const zone = estimateZone(input.fromZip, input.toZip);
    const lbs = Math.max(1, Math.ceil(input.weightOz / 16));

    const ground = 450 + (zone - 1) * 55 + (lbs - 1) * 120; // cents
    const priority = ground + 350 + (zone - 1) * 45;

    return [
      {
        carrier: 'USPS',
        service: 'Ground Advantage',
        serviceCode: 'usps_ground_advantage',
        amountCents: ground,
        estDays: Math.min(5, 2 + Math.floor(zone / 2)),
      },
      {
        carrier: 'USPS',
        service: 'Priority Mail',
        serviceCode: 'usps_priority',
        amountCents: priority,
        estDays: Math.min(3, 1 + Math.floor(zone / 3)),
      },
    ];
  }
}

/** Rough domestic zone (1–8) from the 3-digit ZIP prefixes. Approximation. */
function estimateZone(fromZip: string, toZip: string): number {
  const a = parseInt(fromZip.slice(0, 3), 10);
  const b = parseInt(toZip.slice(0, 3), 10);
  if (Number.isNaN(a) || Number.isNaN(b)) return 4;
  const diff = Math.abs(a - b);
  return Math.min(8, Math.max(1, 1 + Math.round(diff / 120)));
}
