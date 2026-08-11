import 'fastify';
import type { BrandMemberRole } from '@ruostack/shared';
import type { BrandPrincipal } from './auth/brand-token.ts';
import type { AdminPrincipal } from './auth/admin-jwt.ts';

declare module 'fastify' {
  interface FastifyRequest {
    brand?: BrandPrincipal;
    /** The requesting member's role within `brand` — set by requireBrand. */
    brandRole?: BrandMemberRole;
    admin?: AdminPrincipal;
  }
}
