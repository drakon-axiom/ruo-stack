import { describe, expect, it } from 'vitest';
import { canView, canWrite, canResolveClaim } from '@ruostack/shared';

// Role-gate matrix is the server-side authority. These lock the matrix down so
// a later edit can't silently widen access.
describe('admin role-gate matrix', () => {
  it('super_admin can write role grants and manage admins', () => {
    expect(canWrite('super_admin', 'role_grants')).toBe(true);
    expect(canWrite('super_admin', 'admin_users')).toBe(true);
    expect(canWrite('super_admin', 'catalog')).toBe(true);
  });

  it('operations cannot grant roles or manage admins (super-only)', () => {
    expect(canWrite('operations', 'role_grants')).toBe(false);
    expect(canView('operations', 'admin_users')).toBe(false);
    expect(canWrite('operations', 'catalog')).toBe(true); // ops CAN edit catalog
  });

  it('support and finance are read-only on catalog', () => {
    expect(canView('support', 'catalog')).toBe(true);
    expect(canWrite('support', 'catalog')).toBe(false);
    expect(canView('finance', 'catalog')).toBe(true);
    expect(canWrite('finance', 'catalog')).toBe(false);
  });

  it('finance owns wallet adjustments; operations does not', () => {
    expect(canWrite('finance', 'wallet_adjust')).toBe(true);
    expect(canWrite('operations', 'wallet_adjust')).toBe(false);
  });

  it('every role may view the audit log', () => {
    for (const r of ['super_admin', 'operations', 'support', 'finance'] as const) {
      expect(canView(r, 'audit_log')).toBe(true);
    }
  });

  it('claim resolution is tighter than the claims surface', () => {
    // super_admin resolves any outcome.
    for (const res of ['reshipped', 'credited', 'denied'] as const) {
      expect(canResolveClaim('super_admin', res)).toBe(true);
    }
    // operations can write the surface (open/triage) but cannot resolve anything.
    expect(canWrite('operations', 'claims')).toBe(true);
    for (const res of ['reshipped', 'credited', 'denied'] as const) {
      expect(canResolveClaim('operations', res)).toBe(false);
    }
    // finance may only issue wallet credits.
    expect(canResolveClaim('finance', 'credited')).toBe(true);
    expect(canResolveClaim('finance', 'reshipped')).toBe(false);
    expect(canResolveClaim('finance', 'denied')).toBe(false);
    // support cannot resolve.
    expect(canResolveClaim('support', 'credited')).toBe(false);
  });
});
