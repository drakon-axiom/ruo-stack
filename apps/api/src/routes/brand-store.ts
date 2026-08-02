import type { FastifyInstance } from 'fastify';
import type { BrandStoreConnection } from '@ruostack/db';
import { z } from 'zod';
import { AUDIT_ACTIONS, CommitRequestSchema, PLANS, PreflightRequestSchema } from '@ruostack/shared';
import { getClients } from '../clients.js';
import { loadConfig } from '../config.js';
import { writeAudit } from '../audit.js';
import { requireBrand, requireBrandSurface } from '../middleware/guards.js';
import { effectivePlan } from '../services/subscription.js';
import { randomToken } from '../crypto.js';
import { decryptStoreCreds, deleteWooWebhooks, encryptStoreCreds, registerWooWebhooks, verifyWooCreds } from '../services/woo.js';
import { buildProductCsv, type ProvisionProduct } from '../services/store-provision.js';
import { wooStoreClient } from '../services/store-client.js';
import { commit, preflight } from '../services/store-preflight.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../errors.js';

/**
 * Brand store connection (WooCommerce). Gated on the plan's storeConnections
 * capability (Pro/Volume). The brand pastes its WC REST keys; we verify them,
 * store them encrypted, and register order webhooks (when a public URL exists).
 * Credentials are never returned to the client.
 */
const ConnectSchema = z.object({
  store_url: z.string().url(),
  consumer_key: z.string().min(10).max(120),
  consumer_secret: z.string().min(10).max(120),
});

export async function brandStoreRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  async function planAllowsStore(brandId: string): Promise<boolean> {
    const sub = await prisma.subscriptionState.findUnique({ where: { brandId }, select: { plan: true, status: true } });
    return PLANS[effectivePlan(sub)].capabilities.storeConnections;
  }

  async function requireConnection(brandId: string): Promise<BrandStoreConnection> {
    if (!(await planAllowsStore(brandId))) throw Forbidden('Store connections require the Pro or Volume plan');
    const conn = await prisma.brandStoreConnection.findFirst({ where: { brandId, platform: 'woocommerce' } });
    if (!conn) throw BadRequest('not_connected', 'Connect your store before pushing products');
    return conn;
  }

  function webhookUrl(id: string): string | null {
    const base = loadConfig().PUBLIC_API_BASE_URL;
    return base ? `${base.replace(/\/+$/, '')}/api/woo/webhook/${id}` : null;
  }

  function serialize(c: BrandStoreConnection) {
    return {
      id: c.id,
      platform: c.platform,
      store_url: c.storeUrl,
      status: c.status,
      last_error: c.lastError,
      last_order_at: c.lastOrderAt,
      auto_webhooks: c.webhookIds.length > 0,
      webhook_url: webhookUrl(c.id),
      connected_at: c.createdAt,
    };
  }

  // Current connection + whether the plan permits one.
  app.get('/api/brand/store', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const [allowed, conn] = await Promise.all([
      planAllowsStore(brandId),
      prisma.brandStoreConnection.findFirst({ where: { brandId, platform: 'woocommerce' } }),
    ]);
    return { plan_allows: allowed, connection: conn ? serialize(conn) : null };
  });

  // Connect a store.
  app.post('/api/brand/store/connect', { preHandler: requireBrandSurface('store_connection') }, async (req) => {
    const { brandId, userId } = req.brand!;
    const body = ConnectSchema.parse(req.body);
    if (!(await planAllowsStore(brandId))) throw Forbidden('Store connections require the Pro or Volume plan');
    const existing = await prisma.brandStoreConnection.findFirst({ where: { brandId, platform: 'woocommerce' } });
    if (existing) throw Conflict('already_connected', 'A WooCommerce store is already connected — disconnect it first');

    const creds = { storeUrl: body.store_url, consumerKey: body.consumer_key, consumerSecret: body.consumer_secret };
    try {
      await verifyWooCreds(creds);
    } catch (e) {
      throw BadRequest('verify_failed', `Couldn't reach the store with those keys: ${e instanceof Error ? e.message.slice(0, 160) : ''}`);
    }

    const webhookSecret = randomToken(24);
    const enc = encryptStoreCreds(body.consumer_key, body.consumer_secret);
    const conn = await prisma.brandStoreConnection.create({
      data: { brandId, platform: 'woocommerce', storeUrl: body.store_url, ...enc, webhookSecret, status: 'active' },
    });

    // Register webhooks if we have a public URL; otherwise surface the URL +
    // secret so the brand can add the webhook in WooCommerce manually.
    const url = webhookUrl(conn.id);
    let autoRegistered = false;
    if (url) {
      try {
        const webhookIds = await registerWooWebhooks(creds, url, webhookSecret);
        await prisma.brandStoreConnection.update({ where: { id: conn.id }, data: { webhookIds } });
        autoRegistered = webhookIds.length > 0;
      } catch (e) {
        await prisma.brandStoreConnection.update({
          where: { id: conn.id },
          data: { lastError: `webhook registration failed: ${e instanceof Error ? e.message.slice(0, 160) : ''}` },
        });
      }
    }

    await writeAudit(prisma, {
      actorType: 'brand',
      actorId: userId,
      action: AUDIT_ACTIONS.storeConnected,
      targetType: 'brand',
      targetId: brandId,
      after: { store_url: body.store_url, auto_registered: autoRegistered },
      ip: req.ip,
    });

    const fresh = (await prisma.brandStoreConnection.findUnique({ where: { id: conn.id } }))!;
    // Hand back the secret + URL ONLY when manual setup is needed (no public URL).
    return {
      connection: serialize(fresh),
      manual_setup: !autoRegistered
        ? { webhook_url: url, webhook_secret: webhookSecret, topics: ['order.created', 'order.updated'] }
        : null,
    };
  });

  // Re-verify the stored keys.
  app.post('/api/brand/store/test', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const conn = await prisma.brandStoreConnection.findFirst({ where: { brandId, platform: 'woocommerce' } });
    if (!conn) throw NotFound('No store connected');
    try {
      await verifyWooCreds(decryptStoreCreds(conn));
      await prisma.brandStoreConnection.update({ where: { id: conn.id }, data: { status: 'active', lastError: null } });
      return { ok: true };
    } catch (e) {
      await prisma.brandStoreConnection.update({
        where: { id: conn.id },
        data: { status: 'error', lastError: e instanceof Error ? e.message.slice(0, 200) : 'verify failed' },
      });
      throw BadRequest('verify_failed', 'Store keys no longer work — re-connect with fresh keys');
    }
  });

  // ── Shipping config (per-brand markup; pick-&-pack fee is platform-owned) ──
  app.get('/api/brand/store/shipping', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    if (!(await planAllowsStore(brandId))) throw Forbidden('Store connections require the Pro or Volume plan');
    const cfg = await prisma.brandShippingConfig.findUnique({ where: { brandId } });
    return {
      markup_cents: cfg?.markupCents ?? 0,
      pickpack_fee_cents: cfg?.pickpackFeeOverrideCents ?? loadConfig().SHIPPING_PICKPACK_FEE_CENTS,
      enabled_services: cfg?.enabledServices ?? [],
    };
  });

  app.patch('/api/brand/store/shipping', { preHandler: requireBrand }, async (req) => {
    const { brandId, userId } = req.brand!;
    const { markup_cents } = z.object({ markup_cents: z.number().int().min(0).max(100_000) }).parse(req.body);
    if (!(await planAllowsStore(brandId))) throw Forbidden('Store connections require the Pro or Volume plan');
    const cfg = await prisma.brandShippingConfig.upsert({
      where: { brandId },
      create: { brandId, markupCents: markup_cents },
      update: { markupCents: markup_cents },
    });
    await writeAudit(prisma, {
      actorType: 'brand',
      actorId: userId,
      action: AUDIT_ACTIONS.brandProfileUpdated,
      targetType: 'brand',
      targetId: brandId,
      after: { shipping_markup_cents: markup_cents },
      ip: req.ip,
    });
    return { markup_cents: cfg.markupCents };
  });

  // Load published catalog products (optionally a subset) with the brand's retail.
  async function loadProvisionProducts(brandId: string, ids?: string[]): Promise<ProvisionProduct[]> {
    const [products, prices] = await Promise.all([
      prisma.catalogProduct.findMany({
        where: { isPublished: true, archived: false, ...(ids && ids.length ? { id: { in: ids } } : {}) },
        orderBy: { name: 'asc' },
        select: { id: true, canonicalSku: true, name: true, descriptionTemplate: true, status: true, images: true, suggestedRetail: true },
      }),
      prisma.brandProductPrice.findMany({ where: { brandId }, select: { productId: true, retailCents: true } }),
    ]);
    const retail = new Map(prices.map((p) => [p.productId, p.retailCents]));
    return products.map((p) => ({
      id: p.id,
      canonicalSku: p.canonicalSku,
      name: p.name,
      descriptionTemplate: p.descriptionTemplate,
      status: p.status,
      images: p.images,
      retailCents: retail.get(p.id) ?? p.suggestedRetail,
    }));
  }

  // ── Provisioning wizard (fulfillment plan §3, architecture §3.3) ───────────
  // Step 2 · Pre-flight: READ-ONLY classification. Nothing is written here.
  app.post('/api/brand/store/provisioning/preflight', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const { product_ids } = PreflightRequestSchema.parse(req.body);
    const conn = await requireConnection(brandId);

    const products = await loadProvisionProducts(brandId, product_ids);
    if (products.length === 0) throw BadRequest('no_products', 'None of those products are available');

    try {
      const rows = await preflight(prisma, wooStoreClient(decryptStoreCreds(conn)), conn.id, products);
      return { rows };
    } catch (e) {
      throw BadRequest('preflight_failed', `Could not read your store: ${e instanceof Error ? e.message.slice(0, 160) : ''}`);
    }
  });

  // Step 3 · Commit: applies the brand's per-product decisions. Re-classifies
  // first, so a store that changed since pre-flight can't be blindly written to.
  app.post('/api/brand/store/provisioning/commit', { preHandler: requireBrand }, async (req) => {
    const { brandId, userId } = req.brand!;
    const { decisions } = CommitRequestSchema.parse(req.body);
    const conn = await requireConnection(brandId);

    const products = await loadProvisionProducts(brandId, decisions.map((d) => d.product_id));
    if (products.length === 0) throw BadRequest('no_products', 'None of those products are available');

    let outcomes;
    try {
      outcomes = await commit(
        prisma,
        wooStoreClient(decryptStoreCreds(conn)),
        { brandId, connectionId: conn.id, decisions: new Map(decisions.map((d) => [d.product_id, d.action])) },
        products,
      );
    } catch (e) {
      throw BadRequest('provision_failed', `Push to the store failed: ${e instanceof Error ? e.message.slice(0, 160) : ''}`);
    }

    const tally = (r: string) => outcomes.filter((o) => o.result === r).length;
    await writeAudit(prisma, {
      actorType: 'brand',
      actorId: userId,
      action: AUDIT_ACTIONS.storeProductsProvisioned,
      targetType: 'brand',
      targetId: brandId,
      after: {
        requested: decisions.length,
        created: tally('created'),
        updated: tally('updated'),
        adopted: tally('adopted'),
        sku_restored: tally('sku_restored'),
        realiased: tally('realiased'),
        skipped: tally('skipped'),
        errors: tally('error'),
      },
      ip: req.ip,
    });
    return { outcomes };
  });

  // The persistent "managed products" view — what we look after in this store,
  // and anything that has drifted since.
  app.get('/api/brand/store/provisioning/status', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const conn = await prisma.brandStoreConnection.findFirst({ where: { brandId, platform: 'woocommerce' } });
    if (!conn) return { managed: [] };

    const rows = await prisma.productProvisioning.findMany({
      where: { connectionId: conn.id },
      include: { product: { select: { name: true, canonicalSku: true } } },
      orderBy: { lastPushedAt: 'desc' },
    });
    return {
      managed: rows.map((r) => ({
        product_id: r.catalogProductId,
        name: r.product.name,
        canonical_sku: r.product.canonicalSku,
        provisioned_sku: r.provisionedSku,
        woo_product_id: r.wooProductId,
        adopted: r.adopted,
        // NOT drift: this is a deliberate re-alias (or adoption) where the store
        // keeps the brand's own SKU and a ProductAlias carries order matching
        // back to canonical. Real drift is only detectable by reading the store,
        // which pre-flight does.
        aliased: r.provisionedSku !== r.product.canonicalSku,
        last_pushed_at: r.lastPushedAt,
      })),
    };
  });

  // CSV export (WooCommerce importer format) — brand-controlled, no store write.
  app.get('/api/brand/store/provision.csv', { preHandler: requireBrand }, async (req, reply) => {
    const { brandId } = req.brand!;
    const { ids } = z.object({ ids: z.string().optional() }).parse(req.query);
    if (!(await planAllowsStore(brandId))) throw Forbidden('Store connections require the Pro or Volume plan');
    const idList = ids ? ids.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const products = await loadProvisionProducts(brandId, idList);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="ruostack-products.csv"')
      .send(buildProductCsv(products));
  });

  // Disconnect (tears down our webhooks best-effort).
  app.post('/api/brand/store/disconnect', { preHandler: requireBrandSurface('store_connection') }, async (req) => {
    const { brandId, userId } = req.brand!;
    const conn = await prisma.brandStoreConnection.findFirst({ where: { brandId, platform: 'woocommerce' } });
    if (!conn) throw NotFound('No store connected');
    if (conn.webhookIds.length) {
      try {
        await deleteWooWebhooks(decryptStoreCreds(conn), conn.webhookIds);
      } catch {
        /* best-effort */
      }
    }
    await prisma.brandStoreConnection.delete({ where: { id: conn.id } });
    await writeAudit(prisma, {
      actorType: 'brand',
      actorId: userId,
      action: AUDIT_ACTIONS.storeDisconnected,
      targetType: 'brand',
      targetId: brandId,
      ip: req.ip,
    });
    return { ok: true };
  });
}
