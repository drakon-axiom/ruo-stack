import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_OWNER_ONLY_SURFACES, ROLE_GATE } from '@ruostack/shared';

/**
 * Every gated surface must actually be attached to a route.
 *
 * This exists because of a real bug: `store_config` was declared owner-only in
 * the brand role gate and wired to NOTHING, so `PATCH /store/shipping` ran on the
 * plain membership guard and any staff member could change the brand's shipping
 * markup. The surface list looked complete while the enforcement had a hole, and
 * the matrix tests couldn't see it — they assert what `canBrandAccess` returns,
 * not whether any route ever asks.
 *
 * A declared-but-unapplied surface is worse than no surface: it reads like
 * protection that isn't there. This test is the thing that notices.
 */
const routesDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/routes');

const routeSource = readdirSync(routesDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join(routesDir, f), 'utf8'))
  .join('\n');

/** Surfaces named in a `requireBrandSurface('x')` call anywhere in the routes. */
const attachedBrandSurfaces = new Set(
  [...routeSource.matchAll(/requireBrandSurface\(\s*'([a-z_]+)'/g)].map((m) => m[1]!),
);

/** Surfaces named in a `requireAdmin('x', …)` call anywhere in the routes. */
const attachedAdminSurfaces = new Set(
  [...routeSource.matchAll(/requireAdmin\(\s*'([a-z_]+)'/g)].map((m) => m[1]!),
);

describe('brand surface coverage', () => {
  it.each(BRAND_OWNER_ONLY_SURFACES.map((s) => [s]))(
    "owner-only surface '%s' is enforced on at least one route",
    (surface) => {
      expect(
        attachedBrandSurfaces.has(surface),
        `Brand surface '${surface}' is declared owner-only but no route calls requireBrandSurface('${surface}'). ` +
          `Either attach it to the routes it should protect, or drop it from OWNER_ONLY — as written it looks ` +
          `protected and isn't.`,
      ).toBe(true);
    },
  );

});

describe('admin surface coverage', () => {
  it.each(Object.keys(ROLE_GATE).map((s) => [s]))(
    "admin surface '%s' is enforced on at least one route",
    (surface) => {
      expect(
        attachedAdminSurfaces.has(surface),
        `Admin surface '${surface}' is declared in ROLE_GATE but no route calls requireAdmin('${surface}', …). ` +
          `Every surface in the matrix should gate something — an unattached one is a role distinction that ` +
          `does not exist in practice.`,
      ).toBe(true);
    },
  );
});

describe('the scan itself', () => {
  it('actually found routes to scan', () => {
    // Guards against the whole file silently passing because the glob broke.
    expect(routeSource.length).toBeGreaterThan(10_000);
    expect(attachedBrandSurfaces.size).toBeGreaterThan(0);
    expect(attachedAdminSurfaces.size).toBeGreaterThan(0);
  });
});
