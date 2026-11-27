import { adminLotRoutes } from './routes/admin-lots.ts';
import { STATUS_CODES } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { loadConfig } from './config.ts';
import { HttpError } from './errors.ts';
import { closePublicHttp } from './services/public-http.ts';
import { brandRoutes } from './routes/brand.ts';
import { brandBillingRoutes } from './routes/brand-billing.ts';
import { brandOrderRoutes } from './routes/brand-orders.ts';
import { brandOverviewRoutes } from './routes/brand-overview.ts';
import { brandBrandingRoutes } from './routes/brand-branding.ts';
import { brandCustomerRoutes } from './routes/brand-customers.ts';
import { brandAddressRoutes } from './routes/brand-addresses.ts';
import { brandStoreRoutes } from './routes/brand-store.ts';
import { brandMemberRoutes } from './routes/brand-members.ts';
import { shippingRatesRoutes } from './routes/shipping-rates.ts';
import { adminAuthRoutes } from './routes/admin-auth.ts';
import { adminFulfillmentRoutes } from './routes/admin-fulfillment.ts';
import { adminOverviewRoutes } from './routes/admin-overview.ts';
import { adminBrandRoutes } from './routes/admin-brands.ts';
import { adminCoaRoutes } from './routes/admin-coas.ts';
import { adminCatalogRoutes } from './routes/admin-catalog.ts';
import { adminCatalogImportRoutes } from './routes/admin-catalog-import.ts';
import { adminUsersRoutes } from './routes/admin-users.ts';
import { adminShippingRoutes } from './routes/admin-shipping.ts';
import { adminPlanRoutes } from './routes/admin-plans.ts';
import { adminAliasRoutes } from './routes/admin-aliases.ts';
import { adminReconciliationRoutes } from './routes/admin-reconciliation.ts';
import { brandClaimRoutes } from './routes/brand-claims.ts';
import { adminClaimRoutes } from './routes/admin-claims.ts';
import { adminAnnouncementRoutes } from './routes/admin-announcements.ts';
import { adminLedgerRoutes } from './routes/admin-ledger.ts';
import { brandNotificationRoutes } from './routes/brand-notifications.ts';
import { shipstationCustomStoreRoutes } from './routes/shipstation-custom-store.ts';
import { wooWebhookRoutes } from './routes/woo-webhook.ts';
import { webhookRoutes } from './routes/webhook.ts';

export async function buildApp(): Promise<FastifyInstance> {
  const cfg = loadConfig();
  const app = Fastify({
    logger: cfg.NODE_ENV !== 'test',
    // Derive req.ip from X-Forwarded-For, but only trust our own proxy hop(s)
    // (TRUST_PROXY, default 1) — NOT trust-all, which lets a client spoof req.ip
    // and bypass the per-IP rate limit / poison the audit log.
    trustProxy: cfg.trustProxy,
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin: cfg.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Per-IP rate limiting. A generous global default (keyed on req.ip, correct via
  // trustProxy) protects against blanket abuse; sensitive routes (auth, wallet,
  // order/claim writes) tighten this with a per-route `config.rateLimit` override.
  // Disabled under tests so route tests aren't throttled.
  await app.register(rateLimit, {
    global: cfg.NODE_ENV !== 'test',
    max: 300,
    timeWindow: '1 minute',
  });

  // Uniform error shape; never leak internals.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', issues: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500) {
      const codes: Record<number, string> = { 400: 'bad_request', 413: 'payload_too_large', 415: 'unsupported_media_type', 429: 'too_many_requests' };
      return reply.code(status).send({ error: codes[status] ?? 'request_error', message: STATUS_CODES[status] ?? 'Request rejected' });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.addHook('onClose', async () => { await closePublicHttp(); });

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
  await app.register(brandMemberRoutes);
  await app.register(shippingRatesRoutes);
  await app.register(adminAuthRoutes);
  await app.register(adminCatalogRoutes);
  await app.register(adminCoaRoutes);
  await app.register(adminLotRoutes);
  await app.register(adminCatalogImportRoutes);
  await app.register(adminUsersRoutes);
  await app.register(adminFulfillmentRoutes);
  await app.register(adminOverviewRoutes);
  await app.register(adminBrandRoutes);
  await app.register(adminShippingRoutes);
  await app.register(adminPlanRoutes);
  await app.register(adminAliasRoutes);
  await app.register(adminReconciliationRoutes);
  await app.register(brandClaimRoutes);
  await app.register(adminClaimRoutes);
  await app.register(adminAnnouncementRoutes);
  await app.register(adminLedgerRoutes);
  await app.register(brandNotificationRoutes);
  // ShipStation Custom Store: own scope (raw-body parser for shipnotify XML).
  await app.register(shipstationCustomStoreRoutes);
  // WooCommerce webhook: own scope (raw-body parser for HMAC verification).
  await app.register(wooWebhookRoutes);
  // Webhook: own encapsulated scope (raw-body parser) — register last.
  await app.register(webhookRoutes);

  return app;
}
