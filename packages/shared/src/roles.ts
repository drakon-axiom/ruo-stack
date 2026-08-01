import type { AdminRole } from './realm.js';

/**
 * Admin role-gate matrix (architecture §1.2). Enforced SERVER-SIDE on every
 * admin route — never merely hidden in the UI. `'write'` implies `'view'`.
 *
 * Phase 0 only exercises the surfaces that exist now (catalog, admins/roles,
 * audit); later-phase surfaces are declared so the matrix is complete and the
 * guard helpers are stable as routes land.
 */
export type Access = 'write' | 'view' | 'none';

export const ROLE_GATE: Record<string, Record<AdminRole, Access>> = {
  // surface          super_admin  operations  support  finance
  overview: { super_admin: 'view', operations: 'view', support: 'view', finance: 'view' },
  brands: { super_admin: 'write', operations: 'view', support: 'view', finance: 'view' },
  catalog: { super_admin: 'write', operations: 'write', support: 'view', finance: 'view' },
  shipping_rules: { super_admin: 'write', operations: 'write', support: 'view', finance: 'view' },
  fulfillment: { super_admin: 'write', operations: 'write', support: 'view', finance: 'none' },
  exceptions: { super_admin: 'write', operations: 'write', support: 'view', finance: 'view' },
  claims: { super_admin: 'write', operations: 'write', support: 'view', finance: 'view' },
  brand_suspend: { super_admin: 'write', operations: 'none', support: 'none', finance: 'none' },
  wallet_adjust: { super_admin: 'write', operations: 'none', support: 'none', finance: 'write' },
  role_grants: { super_admin: 'write', operations: 'none', support: 'none', finance: 'none' },
  // Authoring broadcasts is an ops function — same shape as `catalog`.
  announcements: { super_admin: 'write', operations: 'write', support: 'view', finance: 'view' },
  ledger: { super_admin: 'write', operations: 'view', support: 'none', finance: 'write' },
  admin_users: { super_admin: 'write', operations: 'none', support: 'none', finance: 'none' },
  audit_log: { super_admin: 'view', operations: 'view', support: 'view', finance: 'view' },
};

export type Surface = keyof typeof ROLE_GATE;

/** Does `role` have at least `view` on `surface`? */
export function canView(role: AdminRole, surface: Surface): boolean {
  const a = ROLE_GATE[surface]?.[role];
  return a === 'view' || a === 'write';
}

/** Does `role` have `write` on `surface`? */
export function canWrite(role: AdminRole, surface: Surface): boolean {
  return ROLE_GATE[surface]?.[role] === 'write';
}

export type ClaimResolutionOutcome = 'reshipped' | 'credited' | 'denied';

/**
 * Resolving a claim is a FINANCIAL action gated tighter than the `claims` surface:
 * `operations` (open + triage) and `support` cannot resolve. Only `super_admin`
 * may resolve any outcome; `finance` may only issue wallet credits. Enforced
 * server-side on the resolve route and mirrored in the admin UI.
 *
 * NOTE — this is an INTENTIONAL deviation from the architecture doc's role matrix
 * (§1.2, "Claims resolve"), which grants `operations` resolve rights and makes
 * `finance` view-only. We tightened financial resolution to super_admin (+finance
 * credits) on purpose; the matrix in that doc predates this decision.
 */
export function canResolveClaim(role: AdminRole, resolution: ClaimResolutionOutcome): boolean {
  return role === 'super_admin' || (role === 'finance' && resolution === 'credited');
}
