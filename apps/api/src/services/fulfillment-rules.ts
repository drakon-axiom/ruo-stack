import type { Box, PrismaClient, ServiceMapping } from '@ruostack/db';
import type { RateOption } from '@ruostack/shared';

/**
 * Fulfillment rules engine (§6): box selection, billable weight, and service
 * curation. Admin-configurable via the Box catalog + ServiceMapping tables. Runs
 * at rate-time (quote each enabled service) and at order-create (lock package +
 * service). Pure functions over loaded rules so it's deterministic + testable.
 */

// Fallbacks when a product has no weight/dims set (set real values in Catalog Manager).
export const DEFAULT_ITEM_WEIGHT_OZ = 4;
const DEFAULT_ITEM_VOLUME_IN3 = 6;
const DEFAULT_BOX = { length: 6, width: 4, height: 2 };

export interface ParcelProduct {
  qty: number;
  weight: number | null; // ounces
  length: number | null;
  width: number | null;
  height: number | null;
}

export interface DerivedParcel {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  boxId: string | null;
  boxName: string | null;
}

/** Rough parcel (no box catalog): sum weights, largest single-item dims. */
export function computeParcel(items: ParcelProduct[]): { weightOz: number; lengthIn: number; widthIn: number; heightIn: number } {
  let weightOz = 0;
  let lengthIn = DEFAULT_BOX.length;
  let widthIn = DEFAULT_BOX.width;
  let heightIn = DEFAULT_BOX.height;
  for (const it of items) {
    weightOz += it.qty * (it.weight ?? DEFAULT_ITEM_WEIGHT_OZ);
    lengthIn = Math.max(lengthIn, it.length ?? 0);
    widthIn = Math.max(widthIn, it.width ?? 0);
    heightIn = Math.max(heightIn, it.height ?? 0);
  }
  return { weightOz: Math.max(1, weightOz), lengthIn, widthIn, heightIn };
}

export async function loadShippingRules(db: PrismaClient): Promise<{ boxes: Box[]; mappings: ServiceMapping[] }> {
  const [boxes, mappings] = await Promise.all([
    db.box.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } }),
    db.serviceMapping.findMany({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } }),
  ]);
  return { boxes, mappings };
}

const boxVolume = (b: Box) => b.innerLengthIn * b.innerWidthIn * b.innerHeightIn;
const itemVolume = (it: ParcelProduct) =>
  it.length != null && it.width != null && it.height != null ? it.length * it.width * it.height : DEFAULT_ITEM_VOLUME_IN3;

/**
 * Pick the smallest enabled box that fits by content volume + weight, then derive
 * billable weight = max(actual + tare, dimensional), dimensional = (L×W×H)/divisor.
 * If nothing fits, use the largest box (best-effort, over capacity).
 */
export function selectBox(items: ParcelProduct[], boxes: Box[], divisor: number): { box: Box | null; billableWeightOz: number } {
  const contentOz = items.reduce((s, it) => s + it.qty * (it.weight ?? DEFAULT_ITEM_WEIGHT_OZ), 0);
  const itemsVol = items.reduce((s, it) => s + it.qty * itemVolume(it), 0);
  if (boxes.length === 0) return { box: null, billableWeightOz: Math.max(1, Math.ceil(contentOz)) };

  const fits = boxes.filter((b) => contentOz <= b.maxWeightOz && itemsVol <= boxVolume(b)).sort((a, b) => boxVolume(a) - boxVolume(b));
  const box = fits[0] ?? [...boxes].sort((a, b) => boxVolume(b) - boxVolume(a))[0]!; // largest as best-effort
  const actualOz = contentOz + box.tareOz;
  const dimOz = (boxVolume(box) / divisor) * 16; // (L×W×H)/divisor = lb → ×16 = oz
  return { box, billableWeightOz: Math.max(1, Math.ceil(Math.max(actualOz, dimOz))) };
}

/** Map a derived parcel to the Order's locked-package columns (box + billable weight). */
export function orderBoxFields(p: DerivedParcel): {
  boxId: string | null;
  boxName: string | null;
  boxLengthIn: number;
  boxWidthIn: number;
  boxHeightIn: number;
  billableWeightOz: number;
} {
  return { boxId: p.boxId, boxName: p.boxName, boxLengthIn: p.lengthIn, boxWidthIn: p.widthIn, boxHeightIn: p.heightIn, billableWeightOz: p.weightOz };
}

/** Box-derived parcel; falls back to the rough parcel when no box is configured/fits. */
export function deriveParcel(items: ParcelProduct[], boxes: Box[], divisor: number): DerivedParcel {
  const sel = selectBox(items, boxes, divisor);
  if (!sel.box) {
    const p = computeParcel(items);
    return { ...p, boxId: null, boxName: null };
  }
  return {
    weightOz: sel.billableWeightOz,
    lengthIn: sel.box.innerLengthIn,
    widthIn: sel.box.innerWidthIn,
    heightIn: sel.box.innerHeightIn,
    boxId: sel.box.id,
    boxName: sel.box.name,
  };
}

/**
 * Curate raw carrier rates through the ServiceMapping table: keep only enabled,
 * eligible (billable ≤ max_weight) services; relabel to the display name +
 * transit estimate; least-cost-select within a tier when its policy is cheapest.
 * No enabled mappings configured → passthrough (back-compat). Mappings configured
 * but nothing matches/eligible → empty (caller falls back to the flat option).
 */
export function curateRates(raw: RateOption[], mappings: ServiceMapping[], billableOz: number): RateOption[] {
  const enabled = mappings.filter((m) => m.enabled);
  if (enabled.length === 0) return raw;

  const byCode = new Map(enabled.map((m) => [m.carrierServiceCode, m]));
  const matched = raw
    .map((o) => ({ o, m: byCode.get(o.serviceCode) }))
    .filter((x): x is { o: RateOption; m: ServiceMapping } => !!x.m && billableOz <= x.m.maxWeightOz)
    .map(({ o, m }) => ({
      tier: m.tier as string,
      policy: m.selectionPolicy as string,
      sort: m.sortOrder,
      opt: { carrier: o.carrier, service: `${m.displayLabel} (${m.transitEstimate})`, serviceCode: o.serviceCode, amountCents: o.amountCents, estDays: o.estDays } as RateOption,
    }));

  // Group by tier; cheapest-policy tiers collapse to their lowest-cost option.
  const byTier = new Map<string, typeof matched>();
  for (const x of matched) {
    const arr = byTier.get(x.tier) ?? [];
    arr.push(x);
    byTier.set(x.tier, arr);
  }
  const out: { sort: number; opt: RateOption }[] = [];
  for (const arr of byTier.values()) {
    if (arr.some((x) => x.policy === 'cheapest')) {
      const min = arr.reduce((a, b) => (b.opt.amountCents < a.opt.amountCents ? b : a));
      out.push({ sort: min.sort, opt: min.opt });
    } else {
      for (const x of arr) out.push({ sort: x.sort, opt: x.opt });
    }
  }
  return out.sort((a, b) => a.sort - b.sort).map((x) => x.opt);
}
