import 'fastify';
import type { BrandPrincipal } from './auth/brand-token.js';
import type { AdminPrincipal } from './auth/admin-jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    brand?: BrandPrincipal;
    admin?: AdminPrincipal;
  }
}
