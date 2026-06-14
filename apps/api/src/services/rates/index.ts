import type { RateOption, RateQuoteInput } from '@ruostack/shared';
import { loadConfig } from '../../config.js';
import { ComputedRatesAdapter } from './computed.js';
import { ShipStationRatesAdapter } from './shipstation.js';

/** ShipStation when credentials are present, else the computed rater. */
function primaryAdapter() {
  const cfg = loadConfig();
  if (cfg.SHIPSTATION_API_KEY && cfg.SHIPSTATION_API_SECRET) {
    return new ShipStationRatesAdapter({
      apiKey: cfg.SHIPSTATION_API_KEY,
      apiSecret: cfg.SHIPSTATION_API_SECRET,
      carrierCodes: cfg.SHIPSTATION_CARRIER_CODES?.split(',').map((s) => s.trim()).filter(Boolean),
    });
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
