import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  AUDIT_ACTIONS,
  CatalogBulkSchema,
  CatalogCreateSchema,
  CatalogStockSchema,
  CatalogUpdateSchema,
  catalogDeleteBlocker,
} from '@ruostack/shared';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { BadRequest, Conflict, HttpError, NotFound } from '../errors.ts';
import { applyCatalogLifecycle, type LifecycleCtx } from '../services/catalog-lifecycle.ts';
import { catalogListWhere, CatalogListQuery } from '../services/catalog-query.ts';
import { buildCatalogExportCsv, exportFilename } from '../services/catalog-export.ts';

/** One item's result in a bulk lifecycle run. */
interface CatalogBulkOutcome {
  id: string;
  ok: boolean;
  /** False when the product was already in the target state. */
  changed: boolean;
  /** Stable error code (e.g. `not_out_of_stock`), present only when `ok` is false. */
  reason?: string;
  message?: string;
}

const lifecycleCtx = (req: FastifyRequest): LifecycleCtx => ({
  adminUserId: req.admin!.adminUserId,
  ip: req.ip,
});

/**
 * Catalog Manager (architecture §1.2). CatalogProduct is the single source of
 * truth; the brand catalog is a read projection. Every mutation writes an
 * AuditLog. `canonical_sku` is REJECTED on edit once `is_published` is true
 * (critical invariant #5). Never auto-suffix a SKU.
 */
export async function adminCatalogRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  // List / search / filter — view for support+finance, write for ops+super.
  app.get('/api/admin/catalog', { preHandler: requireAdmin('catalog', 'view') }, async (req) => {
    const q = CatalogListQuery.parse(req.query);
    const products = await prisma.catalogProduct.findMany({
      where: catalogListWhere(q),
      orderBy: { createdAt: 'desc' },
    });
    return { products };
  });

  /**
   * Catalog as CSV. Shaped after GET /api/admin/ledger/export.csv, including the
   * `.csv` suffix -- which also keeps this path away from `/:id` below, whose
   * param is a UUID.
   *
   * `shape=import` emits exactly IMPORT_COLUMNS and feeds straight back into the
   * importer. `shape=full` adds lifecycle and identity columns and is therefore
   * NOT re-importable: FORBIDDEN_COLUMNS rejects it on the way back in, by design.
   *
   * Rows match the visible table -- same filters as the list route, via the same
   * helper -- because the workflow this exists for is: filter, export, edit the
   * prices, re-import.
   */
  app.get('/api/admin/catalog/export.csv', { preHandler: requireAdmin('catalog', 'view') }, async (req, reply) => {
    const q = CatalogListQuery.extend({ shape: z.enum(['import', 'full']).default('import') }).parse(req.query);
    const products = await prisma.catalogProduct.findMany({
      where: catalogListWhere(q),
      orderBy: { createdAt: 'desc' },
    });

    const csv = buildCatalogExportCsv(products, q.shape);
    const name = exportFilename(q.shape, new Date());

    // One aggregate row per run, mirroring catalog.imported: who exported what,
    // in which shape, and under which filters.
    await writeAudit(prisma, {
      actorType: 'admin',
      actorId: req.admin!.adminUserId,
      action: AUDIT_ACTIONS.catalogExported,
      targetType: 'catalog_export',
      after: {
        shape: q.shape,
        rows: products.length,
        filters: { status: q.status ?? null, search: q.search ?? null, archived: q.archived === 'true' },
      },
      ip: req.ip,
    });

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}"`)
      .send(csv);
  });

  app.get('/api/admin/catalog/:id', { preHandler: requireAdmin('catalog', 'view') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const product = await prisma.catalogProduct.findUnique({ where: { id } });
    if (!product) throw NotFound('Product not found');
    return product;
  });

  // Create (SKU settable while unpublished).
  app.post('/api/admin/catalog', { preHandler: requireAdmin('catalog', 'write') }, async (req, reply) => {
    const body = CatalogCreateSchema.parse(req.body);
    const dup = await prisma.catalogProduct.findUnique({ where: { canonicalSku: body.canonical_sku } });
    if (dup) throw Conflict('sku_taken', `SKU '${body.canonical_sku}' already exists`);

    const product = await prisma.$transaction(async (tx) => {
      const p = await tx.catalogProduct.create({
        data: {
          canonicalSku: body.canonical_sku,
          compound: body.compound,
          dose: body.dose,
          unit: body.unit,
          name: body.name,
          descriptionTemplate: body.description_template,
          wholesaleStarter: body.wholesale_starter,
          wholesalePro: body.wholesale_pro,
          wholesaleVolume: body.wholesale_volume,
          suggestedRetail: body.suggested_retail,
          status: body.status,
          weight: body.weight,
          length: body.length,
          width: body.width,
          height: body.height,
          packagingRule: body.packaging_rule,
          coaId: body.coa_id,
          images: body.images,
          updatedBy: req.admin!.adminUserId,
        },
      });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.catalogCreated,
        targetType: 'catalog_product',
        targetId: p.id,
        after: { canonical_sku: p.canonicalSku, name: p.name, status: p.status },
        ip: req.ip,
      });
      return p;
    });
    return reply.code(201).send(product);
  });

  // Edit — REJECT canonical_sku change if published. Audited with before/after.
  app.patch('/api/admin/catalog/:id', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = CatalogUpdateSchema.parse(req.body);
    const existing = await prisma.catalogProduct.findUnique({ where: { id } });
    if (!existing) throw NotFound('Product not found');

    // SKU immutability (critical invariant #5). Locked while published — and
    // ALSO once anything actually references it, because unpublishing does not
    // remove the product from brand storefronts or from past orders. Renaming a
    // SKU that a store still carries would silently break order matching, which
    // is the exact failure the canonical-SKU design exists to prevent.
    if (body.canonical_sku !== undefined && body.canonical_sku !== existing.canonicalSku) {
      const [provisioningCount, orderItemCount] = await Promise.all([
        prisma.productProvisioning.count({ where: { catalogProductId: id } }),
        prisma.orderItem.count({ where: { productId: id } }),
      ]);
      if (existing.isPublished) {
        throw BadRequest('sku_immutable', 'canonical_sku cannot be changed after publish — the SKU is locked');
      }
      if (provisioningCount > 0) {
        throw BadRequest('sku_immutable', 'This SKU is live in at least one brand store — renaming it would break order matching');
      }
      if (orderItemCount > 0) {
        throw BadRequest('sku_immutable', 'This SKU appears on existing orders and cannot be renamed');
      }
    }

    const data: Record<string, unknown> = { updatedBy: req.admin!.adminUserId };
    const map: Record<string, string> = {
      canonical_sku: 'canonicalSku',
      compound: 'compound',
      dose: 'dose',
      unit: 'unit',
      name: 'name',
      description_template: 'descriptionTemplate',
      wholesale_starter: 'wholesaleStarter',
      wholesale_pro: 'wholesalePro',
      wholesale_volume: 'wholesaleVolume',
      suggested_retail: 'suggestedRetail',
      status: 'status',
      weight: 'weight',
      length: 'length',
      width: 'width',
      height: 'height',
      packaging_rule: 'packagingRule',
      coa_id: 'coaId',
      images: 'images',
    };
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && map[k]) data[map[k]] = v;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.catalogProduct.update({ where: { id }, data });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.catalogUpdated,
        targetType: 'catalog_product',
        targetId: id,
        before: snapshot(existing),
        after: snapshot(p),
        ip: req.ip,
      });
      return p;
    });
    return updated;
  });

  // Publish — locks the SKU, makes the product brand-visible. Audited.
  app.post('/api/admin/catalog/:id/publish', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { product } = await applyCatalogLifecycle(prisma, id, 'publish', lifecycleCtx(req));
    return product;
  });

  // Stock toggle — audits + fires the Woo stock-push seam.
  app.post('/api/admin/catalog/:id/stock', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = CatalogStockSchema.parse(req.body);
    const { product } = await applyCatalogLifecycle(prisma, id, 'set_stock', lifecycleCtx(req), status);
    return product;
  });

  // Unpublish — pulls it from the brand catalog, order forms and provisioning.
  // Fires the stock push so storefronts that already carry it go out-of-stock:
  // a brand must not keep selling something we no longer offer.
  //
  // The SKU stays locked. It was locked by publishing because brand stores now
  // carry it, and unpublishing doesn't remove it from them.
  app.post('/api/admin/catalog/:id/unpublish', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { product } = await applyCatalogLifecycle(prisma, id, 'unpublish', lifecycleCtx(req));
    return product;
  });

  // Archive — retire a product that can't be deleted because it has history.
  // Gated on out_of_stock so the stock push has already pulled it from brand
  // stores before it leaves the catalog; enforced here, not just in the UI.
  app.post('/api/admin/catalog/:id/archive', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { product } = await applyCatalogLifecycle(prisma, id, 'archive', lifecycleCtx(req));
    return product;
  });

  // Restore from archive. Comes back OUT OF STOCK and unchanged otherwise — the
  // operator re-stocks and re-publishes deliberately rather than a restore
  // silently putting a product back on sale.
  app.post('/api/admin/catalog/:id/unarchive', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { product } = await applyCatalogLifecycle(prisma, id, 'unarchive', lifecycleCtx(req));
    return product;
  });

  /**
   * Bulk lifecycle — the same five transitions over a selection from the catalog
   * screen. Each item runs independently and reports its own outcome: `archive`
   * is gated on out_of_stock, so a mixed selection legitimately half-succeeds and
   * one refusal must not roll back the rest.
   *
   * Skips are returned, never swallowed. An operator reading "12 published" when
   * 2 silently did nothing is the exact confusion FORBIDDEN_COLUMNS exists to
   * prevent on the import side.
   */
  app.post('/api/admin/catalog/bulk', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { ids, action, status } = CatalogBulkSchema.parse(req.body);
    const ctx = lifecycleCtx(req);
    const results: CatalogBulkOutcome[] = [];

    // Sequential on purpose: every item may fire a store push that fans out over
    // each connected store, and the batch cap bounds the total. Parallelising
    // here would hammer the Woo API from one request.
    for (const id of ids) {
      try {
        const { changed } = await applyCatalogLifecycle(prisma, id, action, ctx, status);
        results.push({ id, ok: true, changed });
      } catch (err) {
        if (err instanceof HttpError) {
          results.push({ id, ok: false, changed: false, reason: err.code, message: err.message });
        } else {
          throw err;
        }
      }
    }

    return {
      action,
      applied: results.filter((r) => r.ok && r.changed).length,
      unchanged: results.filter((r) => r.ok && !r.changed).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  });

  // Hard delete — never-published drafts only. Anything with history is archived
  // instead: deleting it would cascade away our aliases and provisioning records
  // while leaving the product in the brand's storefront carrying our SKU.
  app.delete('/api/admin/catalog/:id', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await prisma.catalogProduct.findUnique({ where: { id } });
    if (!existing) throw NotFound('Product not found');

    const [orderItemCount, provisioningCount] = await Promise.all([
      prisma.orderItem.count({ where: { productId: id } }),
      prisma.productProvisioning.count({ where: { catalogProductId: id } }),
    ]);
    const blocker = catalogDeleteBlocker({ isPublished: existing.isPublished, orderItemCount, provisioningCount });
    if (blocker) throw Conflict('delete_blocked', blocker);

    await prisma.$transaction(async (tx) => {
      await tx.catalogProduct.delete({ where: { id } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.catalogDeleted,
        targetType: 'catalog_product',
        targetId: id,
        before: snapshot(existing),
        ip: req.ip,
      });
    });
    return { deleted: true };
  });
}

function snapshot(p: {
  canonicalSku: string;
  name: string;
  wholesaleStarter: number;
  wholesalePro: number;
  wholesaleVolume: number;
  suggestedRetail: number;
  status: string;
  isPublished: boolean;
}) {
  return {
    canonical_sku: p.canonicalSku,
    name: p.name,
    wholesale_starter: p.wholesaleStarter,
    wholesale_pro: p.wholesalePro,
    wholesale_volume: p.wholesaleVolume,
    suggested_retail: p.suggestedRetail,
    status: p.status,
    is_published: p.isPublished,
  };
}
