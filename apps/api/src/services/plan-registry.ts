import type { PrismaClient } from '@ruostack/db';
import { PLAN_KEYS, type PlanKey } from '@ruostack/shared';
import { loadConfig } from '../config.ts';

/**
 * The plan registry — the single database-backed source of truth for tier
 * pricing and capabilities, replacing the retired `PLANS` constant from
 * `@ruostack/shared/plans.ts`. Every backend consumer that used to read
 * `PLANS[key]` now awaits `getPlanRegistry(db)` and reads `registry[key]`.
 *
 * `price_cents` and `stripe_price_id` come from the SAME `plan_price` row
 * (the one currently `active` for that tier) — the fix this whole plan
 * exists to deliver: what a plan card advertises and what Checkout charges
 * can no longer diverge, because they are read together, in one query, from
 * one row.
 *
 * Memoized with a single in-flight promise (concurrent callers share one DB
 * query — no stampede) and a `PLAN_CACHE_TTL_SECONDS` TTL (default 60s). The
 * API runs as a single PM2 fork (`ecosystem.config.cjs:41-46`,
 * `instances: 1, exec_mode: 'fork'`), so `invalidatePlanRegistry()` — called
 * by the admin plan-write routes — is exact today: there is only ever one
 * process holding this cache. The TTL exists as a safety net in case that
 * topology ever changes (multiple forks/instances), not as the primary
 * invalidation path.
 *
 * NEVER pass a transaction client (the `tx` handed into `db.$transaction(async
 * (tx) => ...)`) on a path that expects caching — `getPlanRegistry()` detects
 * one and always resolves fresh, without joining the shared in-flight fetch
 * or writing to the process-wide cache, specifically so an uncommitted (and
 * possibly soon-to-be-rolled-back) read from inside a transaction can never
 * get cached for every other request for the rest of the TTL.
 */

export interface ResolvedPlanCapabilities {
  storeConnections: boolean;
  maxOrdersPerMonth: number | null;
  shipping: 'flat' | 'live';
  shippingCutoff: string;
}

export interface ResolvedPlan {
  key: PlanKey;
  name: string;
  features: string[];
  /** Derived, not stored: every tier except starter is paid. */
  paid: boolean;
  priceCents: number;
  /** null for starter (always) and for a paid tier with no active plan_price row. */
  stripePriceId: string | null;
  /**
   * The `plan_price.id` that `priceCents`/`stripePriceId` came from — the
   * checkout quote token (Task 7). Wired onto the wire as
   * `price_version_id` by `GET /api/brand/subscription` and
   * `GET /api/admin/plans`; `POST /api/brand/billing/subscribe` accepts it
   * back and refuses a stale one. null only when a paid tier has no active
   * plan_price row at all (same condition as a null stripePriceId).
   */
  priceVersionId: string | null;
  capabilities: ResolvedPlanCapabilities;
}

type PlanRegistry = Record<PlanKey, ResolvedPlan>;

let cache: { data: PlanRegistry; expiresAt: number } | undefined;
let inFlight: Promise<PlanRegistry> | undefined;
// Bumped on every invalidation so a fetch that was already in flight when an
// admin write invalidated the cache can't overwrite fresh state with the
// stale read it started with.
let epoch = 0;

async function loadRegistry(db: PrismaClient): Promise<PlanRegistry> {
  // One query for all three tiers plus each tier's active price (at most one,
  // enforced by the plan_price_one_active_per_plan partial unique index) —
  // this is the "one database query" the stampede guard protects.
  const rows = await db.plan.findMany({
    include: { prices: { where: { active: true }, take: 1 } },
  });

  const byKey = new Map(rows.map((r) => [r.key as PlanKey, r]));
  const out = {} as PlanRegistry;

  for (const key of PLAN_KEYS) {
    const row = byKey.get(key);
    if (!row) {
      // THROW — never fall back to the plans.ts constant. A silent fallback
      // here would reintroduce the two-authorities problem (display price
      // vs. charged price drifting apart) that this whole plan exists to
      // eliminate. Fail closed and loudly.
      throw new Error(
        `[plan-registry] Missing "plan" row for tier "${key}". The plan table must have exactly one row per ` +
          `PlanKey (${PLAN_KEYS.join(', ')}) — run the plan seed, or check that migration 00000000000030 applied. ` +
          `Refusing to fall back to any hardcoded default.`,
      );
    }
    const activePrice = row.prices[0];
    out[key] = {
      key,
      name: row.name,
      features: row.features,
      paid: key !== 'starter',
      // No active plan_price row → priceCents 0, stripePriceId null. For a
      // paid tier this is indistinguishable, on the wire, from "not yet
      // configured" — brand-billing.ts's existing plan_price_unconfigured
      // check (keyed off a null stripePriceId) is what refuses checkout in
      // that case, same as today when the env var is unset.
      priceCents: activePrice?.priceCents ?? 0,
      stripePriceId: activePrice?.stripePriceId ?? null,
      priceVersionId: activePrice?.id ?? null,
      capabilities: {
        storeConnections: row.storeConnections,
        maxOrdersPerMonth: row.maxOrdersPerMonth,
        shipping: row.shipping,
        shippingCutoff: row.shippingCutoff,
      },
    };
  }

  // Freeze deeply: `cache.data` is handed to every caller BY REFERENCE for up
  // to PLAN_CACHE_TTL_SECONDS, and its arrays (features, ...) would otherwise
  // reach the wire (brand-billing.ts) unprotected. One `registry.pro.features
  // .push(...)` anywhere downstream would poison every request for the rest
  // of the TTL. Freezing turns that class of bug into an immediate TypeError
  // (or a silent no-op in non-strict code) instead of shared, invisible drift.
  return deepFreeze(out);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/**
 * Best-effort detection of a Prisma interactive-transaction client. A real
 * `PrismaClient` exposes `$connect`/`$disconnect`/`$on`/`$transaction`/
 * `$extends`; Prisma's own `ITXClientDenyList` strips exactly those five off
 * the client it hands into `db.$transaction(async (tx) => ...)`. Checking for
 * `$transaction` is enough to tell the two apart — not airtight against a
 * deliberately-shaped mock, but cheap, and it catches the dangerous case this
 * guards against (see module doc comment).
 */
function isTransactionClient(db: PrismaClient): boolean {
  return typeof (db as unknown as { $transaction?: unknown }).$transaction !== 'function';
}

/**
 * Resolve the full plan registry (all three tiers), from cache when fresh,
 * otherwise from the database. Concurrent callers during a cache miss share
 * the same in-flight promise/query — no thundering herd.
 */
export async function getPlanRegistry(db: PrismaClient): Promise<PlanRegistry> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;

  if (isTransactionClient(db)) {
    // Resolve fresh every time, outside the cache/in-flight machinery
    // entirely: joining another caller's in-flight promise would return
    // THEIR client's committed view instead of this transaction's own
    // in-progress state, and caching this read would publish
    // possibly-uncommitted rows to every other request for the rest of the
    // TTL — including past a rollback.
    return loadRegistry(db);
  }

  if (inFlight) return inFlight;

  const myEpoch = epoch;
  inFlight = loadRegistry(db)
    .then((data) => {
      // Only cache this result if nothing invalidated the registry while
      // this fetch was in flight — otherwise a slow, now-stale read could
      // clobber the fresh state an admin write is expecting to see.
      if (myEpoch === epoch) {
        cache = { data, expiresAt: Date.now() + loadConfig().PLAN_CACHE_TTL_SECONDS * 1000 };
      }
      return data;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

/**
 * "Which tiers unlock store connections", as a ready-to-render sentence —
 * derived from the registry's `capabilities.storeConnections` flag rather
 * than a literal list of tier names. Tier *names* are admin-editable now
 * (Task 1+), so a hardcoded "Pro or Volume" would silently drift the day
 * someone renames a tier; this reads the same names the plan cards do.
 *
 * Single source for both `brand-store.ts`'s 403 messages and
 * `GET /api/brand/subscription`'s `upsell.store_connections` — the copy a
 * brand sees in the error and the copy it sees in the UI can't disagree,
 * because both come from this one function reading the one registry.
 */
export function storeConnectionsUpsellMessage(registry: PlanRegistry): string {
  const names = PLAN_KEYS.filter((key) => registry[key].capabilities.storeConnections).map((key) => registry[key].name);
  if (names.length === 0) return 'Store connections are not available on your plan';
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `Store connections require the ${list} plan`;
}

/**
 * Explicit invalidation, called by the admin plan-write routes (Task 7)
 * after any change to `plan` or `plan_price`. Clears both the cache and any
 * in-flight fetch, so the very next call is guaranteed to issue a fresh
 * query rather than reuse a read that may predate the write.
 */
export function invalidatePlanRegistry(): void {
  epoch++;
  cache = undefined;
  inFlight = undefined;
}
