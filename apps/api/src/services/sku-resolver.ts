import type { PrismaClient } from '@ruostack/db';

/**
 * Resolve store SKUs to our canonical products: exact canonical SKU first, then a
 * per-brand ProductAlias (the fallback join, §3). Returns a Map keyed by the input
 * SKU; a null value is a No-Match (→ needs_mapping / Store-Match exception).
 */
export interface ResolvedProduct {
  id: string;
  canonicalSku: string;
  wholesaleStarter: number;
  wholesalePro: number;
  wholesaleVolume: number;
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
}

const SELECT = {
  id: true,
  canonicalSku: true,
  wholesaleStarter: true,
  wholesalePro: true,
  wholesaleVolume: true,
  weight: true,
  length: true,
  width: true,
  height: true,
} as const;

export async function resolveSkus(db: PrismaClient, brandId: string, skus: string[]): Promise<Map<string, ResolvedProduct | null>> {
  const unique = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  const out = new Map<string, ResolvedProduct | null>();
  if (unique.length === 0) return out;

  // 1. Exact canonical SKU (the by-construction path).
  const canonical = await db.catalogProduct.findMany({ where: { canonicalSku: { in: unique }, isPublished: true }, select: SELECT });
  const byCanon = new Map(canonical.map((p) => [p.canonicalSku, p]));
  const missing: string[] = [];
  for (const sku of unique) {
    const p = byCanon.get(sku);
    if (p) out.set(sku, p);
    else missing.push(sku);
  }

  // 2. Per-brand alias fallback.
  if (missing.length > 0) {
    const aliases = await db.productAlias.findMany({ where: { brandId, wooSku: { in: missing } }, select: { wooSku: true, product: { select: SELECT } } });
    const byAlias = new Map(aliases.map((a) => [a.wooSku, a.product]));
    for (const sku of missing) out.set(sku, byAlias.get(sku) ?? null);
  }
  return out;
}
