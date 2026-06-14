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

// Note: shipping LABELS are bought inside ShipStation during fulfillment (Custom
// Store model), so there is no LabelsAdapter — this seam quotes rates only.
