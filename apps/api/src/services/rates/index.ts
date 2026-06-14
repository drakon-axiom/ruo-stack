import type { LabelsAdapter, RateOption, RateQuoteInput } from '@ruostack/shared';
import { loadConfig } from '../../config.js';
import { ComputedRatesAdapter } from './computed.js';
import { ShipStationRatesAdapter } from './shipstation.js';
import { ShipStationV2RatesAdapter } from './shipstation-v2.js';
import { ShipStationV2LabelsAdapter } from './shipstation-v2-labels.js';

/**
 * Pick the rate source: ShipStation v1 (key + secret), ShipStation v2 (single
 * API key, no secret), else the computed rater. The presence of a secret
 * distinguishes v1 from v2.
 */
function primaryAdapter() {
  const cfg = loadConfig();
  if (cfg.SHIPSTATION_API_KEY && cfg.SHIPSTATION_API_SECRET) {
    return new ShipStationRatesAdapter({
      apiKey: cfg.SHIPSTATION_API_KEY,
      apiSecret: cfg.SHIPSTATION_API_SECRET,
      carrierCodes: cfg.SHIPSTATION_CARRIER_CODES?.split(',').map((s) => s.trim()).filter(Boolean),
    });
  }
  if (cfg.SHIPSTATION_API_KEY) {
    return new ShipStationV2RatesAdapter(cfg.SHIPSTATION_API_KEY);
  }
  return new ComputedRatesAdapter();
}

const computed = new ComputedRatesAdapter();

/**
 * Quote shipping. Uses the primary adapter (ShipStation if configured); on error
 * or an empty result, falls back to the computed rater so an order is never
 * blocked from being priced. Returns the source for transparency.
 */
export async function quoteRates(
  input: RateQuoteInput,
): Promise<{ source: string; options: RateOption[] }> {
  const adapter = primaryAdapter();
  try {
    const options = await adapter.getRates(input);
    if (options.length > 0) return { source: adapter.source, options };
  } catch {
    /* fall through to computed */
  }
  return { source: 'computed', options: await computed.getRates(input) };
}

/** Label buying is ShipStation-v2 only (single key, no secret). Null otherwise →
 * the ship flow falls back to manual tracking entry. */
export function getLabelsAdapter(): LabelsAdapter | null {
  const cfg = loadConfig();
  if (cfg.SHIPSTATION_API_KEY && !cfg.SHIPSTATION_API_SECRET) {
    return new ShipStationV2LabelsAdapter(cfg.SHIPSTATION_API_KEY);
  }
  return null;
}
