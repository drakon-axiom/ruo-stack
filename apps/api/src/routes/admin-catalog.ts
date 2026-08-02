import type { FastifyInstance } from 'fastify';
import {
  AUDIT_ACTIONS,
  CatalogCreateSchema,
  CatalogStatusEnum,
  CatalogStockSchema,
  CatalogUpdateSchema,
  catalogDeleteBlocker,
} from '@ruostack/shared';
import { z } from 'zod';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { requireAdmin } from '../middleware/guards.js';
import { BadRequest, Conflict, NotFound } from '../errors.js';
import { onCatalogStockChanged } from '../hooks/catalog-stock.js';

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
    const q = z
      .object({
        status: CatalogStatusEnum.optional(),
        search: z.string().max(120).optional(),
        // Archived products are retired: hidden unless explicitly asked for.
        archived: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);
    const products = await prisma.catalogProduct.findMany({
      where: {
        archived: q.archived === 'true',
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { canonicalSku: { contains: q.search, mode: 'insensitive' } },
                { compound: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return { products };
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
    const existing = await prisma.catalogProduct.findUnique({ where: { id } });
    if (!existing) throw NotFound('Product not found');
    if (existing.isPublished) return { ...existing }; // idempotent

    const published = await prisma.$transaction(async (tx) => {
      const p = await tx.catalogProduct.update({ where: { id }, data: { isPublished: true } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.catalogPublished,
        targetType: 'catalog_product',
        targetId: id,
        before: { is_published: false, canonical_sku: existing.canonicalSku },
        after: { is_published: true, canonical_sku: p.canonicalSku },
        ip: req.ip,
      });
      return p;
    });
    return published;
  });

  // Stock toggle — audits + fires the (stubbed) Woo stock-push seam.
  app.post('/api/admin/catalog/:id/stock', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = CatalogStockSchema.parse(req.body);
    const existing = await prisma.catalogProduct.findUnique({ where: { id } });
    if (!existing) throw NotFound('Product not found');

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.catalogProduct.update({ where: { id }, data: { status } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.skuStockChanged,
        targetType: 'catalog_product',
        targetId: id,
        before: { status: existing.status },
        after: { status: p.status },
        ip: req.ip,
      });
      return p;
    });

    // Seam: TODO(Phase 1) Woo stock push. No-op in Phase 0.
    await onCatalogStockChanged(updated);
    return updated;
  });

  // Unpublish — pulls it from the brand catalog, order forms and provisioning.
  // Fires the stock push so storefronts that already carry it go out-of-stock:
  // a brand must not keep selling something we no longer offer.
  //
  // The SKU stays locked. It was locked by publishing because brand stores now
  // carry it, and unpublishing doesn't remove it from them.
  app.post('/api/admin/catalog/:id/unpublish', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await prisma.catalogProduct.findUnique({ where: { id } });
    if (!existing) throw NotFound('Product not found');
    if (!existing.isPublished) return { ...existing }; // idempotent

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.catalogProduct.update({ where: { id }, data: { isPublished: false, updatedBy: req.admin!.adminUserId } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.catalogUnpublished,
        targetType: 'catalog_product',
        targetId: id,
        before: { is_published: true },
        after: { is_published: false },
        ip: req.ip,
      });
      return p;
    });

    await onCatalogStockChanged(updated);
    return updated;
  });

  // Archive — retire a product that can't be deleted because it has history.
  // Gated on out_of_stock so the stock push has already pulled it from brand
  // stores before it leaves the catalog; enforced here, not just in the UI.
  app.post('/api/admin/catalog/:id/archive', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await prisma.catalogProduct.findUnique({ where: { id } });
    if (!existing) throw NotFound('Product not found');
    if (existing.archived) return { ...existing }; // idempotent
    if (existing.status !== 'out_of_stock') {
      throw BadRequest(
        'not_out_of_stock',
        'Set the product to out-of-stock before archiving it, so brand stores stop selling it first',
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.catalogProduct.update({ where: { id }, data: { archived: true, updatedBy: req.admin!.adminUserId } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.catalogArchived,
        targetType: 'catalog_product',
        targetId: id,
        before: { archived: false, status: existing.status, is_published: existing.isPublished },
        after: { archived: true },
        ip: req.ip,
      });
      return p;
    });

    // Belt and braces: it is already out_of_stock, but this makes the storefront
    // state unambiguous and re-asserts it for any store that missed the earlier push.
    await onCatalogStockChanged(updated);
    return updated;
  });

  // Restore from archive. Comes back OUT OF STOCK and unchanged otherwise — the
  // operator re-stocks and re-publishes deliberately rather than a restore
  // silently putting a product back on sale.
  app.post('/api/admin/catalog/:id/unarchive', { preHandler: requireAdmin('catalog', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await prisma.catalogProduct.findUnique({ where: { id } });
    if (!existing) throw NotFound('Product not found');
    if (!existing.archived) return { ...existing }; // idempotent

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.catalogProduct.update({ where: { id }, data: { archived: false, updatedBy: req.admin!.adminUserId } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.catalogUnarchived,
        targetType: 'catalog_product',
        targetId: id,
        before: { archived: true },
        after: { archived: false, status: p.status, is_published: p.isPublished },
        ip: req.ip,
      });
      return p;
    });
    return updated;
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
