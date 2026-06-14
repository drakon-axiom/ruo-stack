/**
 * Shipping rate seam (mirrors PaymentsAdapter). Core/order code asks the
 * RatesAdapter for options; the concrete source (ShipStation, a computed table,
 * EasyPost later) is swappable. Origin is RUOStack's warehouse (platform config),
 * since fulfillment ships from RUOStack under the brand's label.
 */
export interface RateQuoteInput {
  fromZip: string;
  toZip: string;
  toState: string;
  toCountry: string; // 'US'
  weightOz: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  residential?: boolean;
}

export interface RateOption {
  carrier: string; // 'USPS' | 'UPS' | 'FedEx' | …
  service: string; // human label, e.g. 'Ground Advantage'
  serviceCode: string; // stable id used on the order
  amountCents: number;
  estDays?: number;
}

export interface RatesAdapter {
  /** The source identifier ('shipstation' | 'computed') — surfaced for transparency. */
  readonly source: string;
  getRates(input: RateQuoteInput): Promise<RateOption[]>;
}

// ── Label buying ──────────────────────────────────────────────────────────────
export interface ShipAddress {
  name: string;
  phone?: string;
  addressLine1: string;
  addressLine2?: string;
  cityLocality: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  residential?: boolean;
}

export interface LabelBuyInput {
  serviceCode: string;
  testLabel: boolean;
  shipFrom: ShipAddress;
  shipTo: ShipAddress;
  weightOz: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
}

export interface LabelResult {
  trackingNumber: string;
  carrier: string;
  serviceCode: string;
  labelUrl: string | null;
  costCents: number;
}

export interface LabelsAdapter {
  readonly source: string;
  buyLabel(input: LabelBuyInput): Promise<LabelResult>;
}
