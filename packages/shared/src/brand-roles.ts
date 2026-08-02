import type { BrandMemberRole } from './realm.js';

/**
 * Brand-side permission model (architecture §3.1).
 *
 * Until now `requireBrand` checked MEMBERSHIP only — every active member of a
 * brand could do everything. That was harmless while every brand had exactly one
 * member (the owner), but the moment staff can be invited it becomes the whole
 * question: a staff member must not be able to move money, change the billing
 * relationship, or tear down the store connection.
 *
 * The split is by CONSEQUENCE, not by seniority. Staff run the day-to-day
 * business — orders, tracking, claims, customers, addresses, notifications.
 * Owner-only is anything that:
 *   • moves money or changes the billing relationship (wallet, subscription),
 *   • changes the brand's identity or contact of record (profile, email, branding),
 *   • can break the order pipeline for everyone (store connect/disconnect),
 *   • grants or revokes access (member management).
 *
 * Enforced SERVER-SIDE by `requireBrandSurface`, never merely hidden in the UI.
 */
export const BRAND_SURFACES = [
  'orders',
  'claims',
  'customers',
  'addresses',
  'catalog',
  'notifications',
  'store_config',
  'store_connection',
  'branding',
  'wallet',
  'billing',
  'profile',
  'members',
] as const;
export type BrandSurface = (typeof BRAND_SURFACES)[number];

/** Which roles may act on each surface. `owner` is a superset of `staff`. */
const OWNER_ONLY: BrandSurface[] = [
  'store_connection', // connect/disconnect breaks order intake for the whole brand
  'branding', // the brand's public identity
  'wallet', // moves money
  'billing', // the subscription relationship
  'profile', // brand name + contact of record
  'members', // granting access is itself the privilege
];

export function canBrandAccess(role: BrandMemberRole, surface: BrandSurface): boolean {
  if (role === 'owner') return true;
  return !OWNER_ONLY.includes(surface);
}

/** For the UI: surfaces a staff member cannot reach, so the nav can dim them. */
export const BRAND_OWNER_ONLY_SURFACES: readonly BrandSurface[] = OWNER_ONLY;

const ROLE_LABEL: Record<BrandMemberRole, string> = { owner: 'Owner', staff: 'Staff' };
export const brandRoleLabel = (r: BrandMemberRole): string => ROLE_LABEL[r];

/**
 * A brand must always retain at least one owner. `brand-billing.ts` and
 * `dunning.ts` both resolve the brand's contact with
 * `findFirst({ role: 'owner' })` — with no owner the billing portal breaks and
 * dunning notices silently stop, so this is enforced, not advisory.
 */
export function wouldOrphanBrand(input: {
  ownerCount: number;
  targetIsOwner: boolean;
  /** true when the target is being removed/suspended or demoted out of `owner`. */
  losingOwner: boolean;
}): boolean {
  return input.targetIsOwner && input.losingOwner && input.ownerCount <= 1;
}
