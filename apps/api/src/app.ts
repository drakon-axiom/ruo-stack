import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import { HttpError } from './errors.js';
import { brandRoutes } from './routes/brand.js';
import { brandBillingRoutes } from './routes/brand-billing.js';
import { brandOrderRoutes } from './routes/brand-orders.js';
import { brandOverviewRoutes } from './routes/brand-overview.js';
import { brandBrandingRoutes } from './routes/brand-branding.js';
import { brandCustomerRoutes } from './routes/brand-customers.js';
import { brandAddressRoutes } from './routes/brand-addresses.js';
import { brandStoreRoutes } from './routes/brand-store.js';
import { shippingRatesRoutes } from './routes/shipping-rates.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { adminFulfillmentRoutes } from './routes/admin-fulfillment.js';
import { adminOverviewRoutes } from './routes/admin-overview.js';
import { adminBrandRoutes } from './routes/admin-brands.js';
import { adminCatalogRoutes } from './routes/admin-catalog.js';
import { adminUsersRoutes } from './routes/admin-users.js';
import { adminShippingRoutes } from './routes/admin-shipping.js';
import { adminAliasRoutes } from './routes/admin-aliases.js';
import { adminReconciliationRoutes } from './routes/admin-reconciliation.js';
import { brandClaimRoutes } from './routes/brand-claims.js';
import { adminClaimRoutes } from './routes/admin-claims.js';
import { shipstationCustomStoreRoutes } from './routes/shipstation-custom-store.js';
import { wooWebhookRoutes } from './routes/woo-webhook.js';
import { webhookRoutes } from './routes/webhook.js';

export async function buildApp(): Promise<FastifyInstance> {
  const cfg = loadConfig();
  const app = Fastify({
    logger: cfg.NODE_ENV !== 'test',
    // Trust X-Forwarded-* so req.ip is correct behind a proxy (audit log).
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin: cfg.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Uniform error shape; never leak internals.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', issues: err.issues });
    }
    if ((err as { statusCode?: number }).statusCode === 400) {
      return reply.code(400).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/healthz', async () => ({ ok: true }));

  // Brand realm (Supabase Auth JWTs) and admin realm (option a) routes.
  await app.register(brandRoutes);
  await app.register(brandBillingRoutes);
  await app.register(brandOrderRoutes);
  await app.register(brandOverviewRoutes);
  await app.register(brandBrandingRoutes);
  await app.register(brandCustomerRoutes);
  await app.register(brandAddressRoutes);
  await app.register(brandStoreRoutes);
  await app.register(shippingRatesRoutes);
  await app.register(adminAuthRoutes);
  await app.register(adminCatalogRoutes);
  await app.register(adminUsersRoutes);
  await app.register(adminFulfillmentRoutes);
  await app.register(adminOverviewRoutes);
  await app.register(adminBrandRoutes);
  await app.register(adminShippingRoutes);
  await app.register(adminAliasRoutes);
  await app.register(adminReconciliationRoutes);
  await app.register(brandClaimRoutes);
  await app.register(adminClaimRoutes);
  // ShipStation Custom Store: own scope (raw-body parser for shipnotify XML).
  await app.register(shipstationCustomStoreRoutes);
  // WooCommerce webhook: own scope (raw-body parser for HMAC verification).
  await app.register(wooWebhookRoutes);
  // Webhook: own encapsulated scope (raw-body parser) — register last.
  await app.register(webhookRoutes);

  return app;
}
