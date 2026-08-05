import type { RateOption, RateQuoteInput, RatesAdapter } from '@ruostack/shared';

interface SsV2Rate {
  carrier_id: string;
  carrier_code?: string;
  carrier_friendly_name?: string;
  service_code?: string;
  shipping_amount?: { amount: number; currency: string };
  other_amount?: { amount: number };
  delivery_days?: number | null;
}

// Services that aren't appropriate for general parcels (refined later by the
// Phase 2 service-mapping rules engine).
const DENY = new Set(['usps_media_mail']);
const MAX_OPTIONS = 6;
// Abort a stalled call instead of hanging the checkout rate proxy on it.
const HTTP_TIMEOUT_MS = 15_000;

/**
 * Real rates via the ShipStation v2 API (ShipEngine engine). Single API-Key
 * header; rates all connected carriers in one call via /rates/estimate (postal
 * codes + weight, no full address needed). Returns [] on failure so the caller
 * can fall back. Carrier ids are cached for the adapter's lifetime.
 */
export class ShipStationV2RatesAdapter implements RatesAdapter {
  readonly source = 'shipstation';
  private readonly base = 'https://api.shipstation.com/v2';
  private carrierIds?: string[];

  constructor(private readonly apiKey: string) {}

  private headers() {
    return { 'API-Key': this.apiKey, 'content-type': 'application/json' };
  }

  private async getCarrierIds(): Promise<string[]> {
    if (this.carrierIds) return this.carrierIds;
    const res = await fetch(`${this.base}/carriers`, { headers: this.headers(), signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ShipStation v2 /carriers → ${res.status}`);
    const d = (await res.json()) as { carriers?: { carrier_id: string }[] };
    this.carrierIds = (d.carriers ?? []).map((c) => c.carrier_id);
    return this.carrierIds;
  }

  async getRates(input: RateQuoteInput): Promise<RateOption[]> {
    const carrierIds = await this.getCarrierIds();
    if (carrierIds.length === 0) return [];

    const res = await fetch(`${this.base}/rates/estimate`, {
      method: 'POST',
      headers: this.headers(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      body: JSON.stringify({
        carrier_ids: carrierIds,
        from_country_code: 'US',
        from_postal_code: input.fromZip,
        to_country_code: input.toCountry,
        to_postal_code: input.toZip,
        to_state_province: input.toState,
        weight: { value: Math.max(1, Math.round(input.weightOz)), unit: 'ounce' },
        ...(input.lengthIn && input.widthIn && input.heightIn
          ? { dimensions: { unit: 'inch', length: input.lengthIn, width: input.widthIn, height: input.heightIn } }
          : {}),
        confirmation: 'none',
        address_residential_indicator: input.residential === false ? 'no' : 'yes',
      }),
    });
    if (!res.ok) throw new Error(`ShipStation v2 /rates/estimate → ${res.status}`);
    const rates = (await res.json()) as SsV2Rate[];

    // Dedupe by service (cheapest wins), drop denied services + zero-cost rows.
    const best = new Map<string, RateOption>();
    for (const r of rates) {
      if (!r.service_code || DENY.has(r.service_code)) continue;
      const cents = Math.round(((r.shipping_amount?.amount ?? 0) + (r.other_amount?.amount ?? 0)) * 100);
      if (cents <= 0) continue;
      const existing = best.get(r.service_code);
      if (!existing || cents < existing.amountCents) {
        best.set(r.service_code, {
          carrier: r.carrier_friendly_name ?? r.carrier_code ?? 'Carrier',
          service: humanizeService(r.service_code, r.carrier_code),
          serviceCode: r.service_code,
          amountCents: cents,
          estDays: r.delivery_days ?? undefined,
        });
      }
    }
    return [...best.values()].sort((a, b) => a.amountCents - b.amountCents).slice(0, MAX_OPTIONS);
  }
}

function humanizeService(serviceCode: string, carrierCode?: string): string {
  let s = serviceCode;
  if (carrierCode && s.startsWith(`${carrierCode}_`)) s = s.slice(carrierCode.length + 1);
  return s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
