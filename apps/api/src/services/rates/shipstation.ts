import type { RateOption, RateQuoteInput, RatesAdapter } from '@ruostack/shared';

/** Friendly carrier name from a ShipStation carrier code. */
const CARRIER_NAMES: Record<string, string> = {
  stamps_com: 'USPS',
  usps: 'USPS',
  ups: 'UPS',
  ups_walleted: 'UPS',
  fedex: 'FedEx',
  dhl_express: 'DHL',
};

interface SsRate {
  serviceName: string;
  serviceCode: string;
  shipmentCost: number;
  otherCost: number;
}

/**
 * Real rates via the ShipStation classic API (HTTP Basic key:secret). Rates one
 * or more configured carriers and aggregates. Plain HTTP — no SDK. Returns []
 * (so the caller can fall back) if a carrier call fails; throws only if it can't
 * even list carriers.
 */
export class ShipStationRatesAdapter implements RatesAdapter {
  readonly source = 'shipstation';
  private readonly base = 'https://ssapi.shipstation.com';
  private readonly auth: string;

  constructor(
    private readonly cfg: { apiKey: string; apiSecret: string; carrierCodes?: string[] },
  ) {
    this.auth = 'Basic ' + Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64');
  }

  private async req(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { authorization: this.auth, 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`ShipStation ${path} → ${res.status}`);
    return res.json();
  }

  private async listCarrierCodes(): Promise<string[]> {
    const carriers = (await this.req('/carriers')) as { code: string }[];
    return carriers.map((c) => c.code);
  }

  private async rateCarrier(carrierCode: string, input: RateQuoteInput): Promise<RateOption[]> {
    try {
      const rates = (await this.req('/shipments/getrates', {
        method: 'POST',
        body: JSON.stringify({
          carrierCode,
          fromPostalCode: input.fromZip,
          toState: input.toState,
          toCountry: input.toCountry,
          toPostalCode: input.toZip,
          weight: { value: Math.max(1, Math.round(input.weightOz)), units: 'ounces' },
          ...(input.lengthIn && input.widthIn && input.heightIn
            ? { dimensions: { units: 'inches', length: input.lengthIn, width: input.widthIn, height: input.heightIn } }
            : {}),
          confirmation: 'none',
          residential: input.residential ?? true,
        }),
      })) as SsRate[];
      return rates.map((r) => ({
        carrier: CARRIER_NAMES[carrierCode] ?? carrierCode,
        service: r.serviceName,
        serviceCode: r.serviceCode,
        amountCents: Math.round((r.shipmentCost + r.otherCost) * 100),
      }));
    } catch {
      return []; // one carrier failing shouldn't kill the whole quote
    }
  }

  async getRates(input: RateQuoteInput): Promise<RateOption[]> {
    const codes = this.cfg.carrierCodes?.length ? this.cfg.carrierCodes : await this.listCarrierCodes();
    const lists = await Promise.all(codes.map((c) => this.rateCarrier(c, input)));
    return lists.flat().sort((a, b) => a.amountCents - b.amountCents);
  }
}
