import type { LabelBuyInput, LabelResult, LabelsAdapter, ShipAddress } from '@ruostack/shared';

const CARRIER_NAMES: Record<string, string> = {
  usps: 'USPS',
  stamps_com: 'USPS',
  ups: 'UPS',
  fedex: 'FedEx',
  fedex_walleted: 'FedEx',
  dhl_express: 'DHL',
};

interface SsV2Label {
  tracking_number?: string;
  carrier_code?: string;
  service_code?: string;
  shipment_cost?: { amount: number; currency: string };
  label_download?: { href?: string; pdf?: string; png?: string; zpl?: string };
}

/** Buy a shipping label via ShipStation v2 (ShipEngine). Returns tracking + a
 * printable label URL. `test_label` produces a no-charge sample label. */
export class ShipStationV2LabelsAdapter implements LabelsAdapter {
  readonly source = 'shipstation';
  private readonly base = 'https://api.shipstation.com/v2';

  constructor(private readonly apiKey: string) {}

  async buyLabel(input: LabelBuyInput): Promise<LabelResult> {
    const res = await fetch(`${this.base}/labels`, {
      method: 'POST',
      headers: { 'API-Key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        shipment: {
          service_code: input.serviceCode,
          ship_from: addr(input.shipFrom),
          ship_to: addr(input.shipTo),
          packages: [
            {
              weight: { value: Math.max(1, Math.round(input.weightOz)), unit: 'ounce' },
              ...(input.lengthIn && input.widthIn && input.heightIn
                ? { dimensions: { unit: 'inch', length: input.lengthIn, width: input.widthIn, height: input.heightIn } }
                : {}),
            },
          ],
        },
        test_label: input.testLabel,
        label_format: 'pdf',
        label_download_type: 'url',
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ShipStation v2 /labels → ${res.status}: ${body.slice(0, 300)}`);
    }
    const d = (await res.json()) as SsV2Label;
    if (!d.tracking_number) throw new Error('ShipStation returned no tracking number');
    return {
      trackingNumber: d.tracking_number,
      carrier: CARRIER_NAMES[d.carrier_code ?? ''] ?? (d.carrier_code ?? 'Carrier').toUpperCase(),
      serviceCode: d.service_code ?? input.serviceCode,
      labelUrl: d.label_download?.pdf ?? d.label_download?.href ?? null,
      costCents: Math.round((d.shipment_cost?.amount ?? 0) * 100),
    };
  }
}

function addr(a: ShipAddress) {
  return {
    name: a.name,
    ...(a.phone ? { phone: a.phone } : {}),
    address_line1: a.addressLine1,
    ...(a.addressLine2 ? { address_line2: a.addressLine2 } : {}),
    city_locality: a.cityLocality,
    state_province: a.stateProvince,
    postal_code: a.postalCode,
    country_code: a.countryCode,
    ...(a.residential !== undefined ? { address_residential_indicator: a.residential ? 'yes' : 'no' } : {}),
  };
}
