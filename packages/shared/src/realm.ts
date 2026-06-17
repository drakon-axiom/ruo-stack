/** The two auth realms. The boundary is a security boundary, not a convenience. */
export const REALMS = ['brand', 'admin'] as const;
export type Realm = (typeof REALMS)[number];

/** Admin roles (option a: hand-rolled admin identity, out of the customer pool). */
export const ADMIN_ROLES = ['super_admin', 'operations', 'support', 'finance'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Brand membership roles. MVP creates exactly one `owner` per brand. */
export const BRAND_MEMBER_ROLES = ['owner', 'staff'] as const;
export type BrandMemberRole = (typeof BRAND_MEMBER_ROLES)[number];

/**
 * Claims injected into a brand JWT by `public.custom_access_token_hook`.
 * Source of truth is the server-owned `BrandUserRole` table, NEVER user_metadata.
 */
export interface BrandClaims {
  realm: 'brand';
  brand_id: string;
}

/** Decoded principal the API attaches to a request after a realm guard passes. */
export type Principal =
  | { realm: 'brand'; userId: string; brandId: string }
  | { realm: 'admin'; adminUserId: string; role: AdminRole; sessionId: string };
