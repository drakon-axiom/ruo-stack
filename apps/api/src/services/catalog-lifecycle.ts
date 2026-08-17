import type { CatalogProduct, CatalogStatus, PrismaClient } from '@ruostack/db';
import { AUDIT_ACTIONS, type CatalogBulkAction } from '@ruostack/shared';
import { writeAudit } from '../audit.ts';
import { BadRequest, NotFound } from '../errors.ts';
import { onCatalogStockChanged } from '../hooks/catalog-stock.ts';

/**
 * The catalog lifecycle transitions — publish, unpublish, stock, archive,
 * unarchive — as one function per product, shared by the single-item routes and
 * the bulk endpoint.
 *
 * Extracted rather than reimplemented: each transition owns an audit row and,
 * for three of the five, the store-push seam. A second copy of that pairing is
 * how a bulk action ends up silently skipping the push for half the catalog.
 *
 * Throws exactly what the single-item routes threw (NotFound / BadRequest), so
 * their behaviour is unchanged. The bulk caller catches per item instead, which
 * is what makes partial success possible.
 *
 * Deliberately preserved quirk: `publish` and `set_stock` do NOT stamp
 * `updatedBy`, while the other three do. That asymmetry predates this refactor;
 * changing it here would quietly rewrite who the catalog says last touched a
 * product.
 */

export interface LifecycleCtx {
  adminUserId: string;
  ip: string;
}

export interface LifecycleResult {
  product: CatalogProduct;
  /** False when the product was already in the target state — nothing written. */
  changed: boolean;
}

export async function applyCatalogLifecycle(
  prisma: PrismaClient,
  id: string,
  action: CatalogBulkAction,
  ctx: LifecycleCtx,
  status?: CatalogStatus,
): Promise<LifecycleResult> {
  const existing = await prisma.catalogProduct.findUnique({ where: { id } });
  if (!existing) throw NotFound('Product not found');

  switch (action) {
    case 'publish': {
      if (existing.isPublished) return { product: existing, changed: false };
      const product = await prisma.$transaction(async (tx) => {
        const p = await tx.catalogProduct.update({ where: { id }, data: { isPublished: true } });
        await writeAudit(tx, {
          actorType: 'admin',
          actorId: ctx.adminUserId,
          action: AUDIT_ACTIONS.catalogPublished,
          targetType: 'catalog_product',
          targetId: id,
          before: { is_published: false, canonical_sku: existing.canonicalSku },
          after: { is_published: true, canonical_sku: p.canonicalSku },
          ip: ctx.ip,
        });
        return p;
      });
      // No push: brand stores do not carry the product until provisioning.
      return { product, changed: true };
    }

    case 'set_stock': {
      if (!status) throw BadRequest('status_required', 'A stock status is required');
      // No idempotent short-circuit: the single-item route always writes and
      // always pushes, which re-asserts storefront state for a store that
      // missed an earlier push.
      const product = await prisma.$transaction(async (tx) => {
        const p = await tx.catalogProduct.update({ where: { id }, data: { status } });
        await writeAudit(tx, {
          actorType: 'admin',
          actorId: ctx.adminUserId,
          action: AUDIT_ACTIONS.skuStockChanged,
          targetType: 'catalog_product',
          targetId: id,
          before: { status: existing.status },
          after: { status: p.status },
          ip: ctx.ip,
        });
        return p;
      });
      await onCatalogStockChanged(product);
      return { product, changed: true };
    }

    case 'unpublish': {
      if (!existing.isPublished) return { product: existing, changed: false };
      const product = await prisma.$transaction(async (tx) => {
        const p = await tx.catalogProduct.update({
          where: { id },
          data: { isPublished: false, updatedBy: ctx.adminUserId },
        });
        await writeAudit(tx, {
          actorType: 'admin',
          actorId: ctx.adminUserId,
          action: AUDIT_ACTIONS.catalogUnpublished,
          targetType: 'catalog_product',
          targetId: id,
          before: { is_published: true },
          after: { is_published: false },
          ip: ctx.ip,
        });
        return p;
      });
      // Storefronts already carrying it must go out-of-stock: a brand must not
      // keep selling something we no longer offer.
      await onCatalogStockChanged(product);
      return { product, changed: true };
    }

    case 'archive': {
      if (existing.archived) return { product: existing, changed: false };
      if (existing.status !== 'out_of_stock') {
        throw BadRequest(
          'not_out_of_stock',
          'Set the product to out-of-stock before archiving it, so brand stores stop selling it first',
        );
      }
      const product = await prisma.$transaction(async (tx) => {
        const p = await tx.catalogProduct.update({
          where: { id },
          data: { archived: true, updatedBy: ctx.adminUserId },
        });
        await writeAudit(tx, {
          actorType: 'admin',
          actorId: ctx.adminUserId,
          action: AUDIT_ACTIONS.catalogArchived,
          targetType: 'catalog_product',
          targetId: id,
          before: { archived: false, status: existing.status, is_published: existing.isPublished },
          after: { archived: true },
          ip: ctx.ip,
        });
        return p;
      });
      // Belt and braces: already out_of_stock, but this re-asserts the
      // storefront state for any store that missed the earlier push.
      await onCatalogStockChanged(product);
      return { product, changed: true };
    }

    case 'unarchive': {
      if (!existing.archived) return { product: existing, changed: false };
      const product = await prisma.$transaction(async (tx) => {
        const p = await tx.catalogProduct.update({
          where: { id },
          data: { archived: false, updatedBy: ctx.adminUserId },
        });
        await writeAudit(tx, {
          actorType: 'admin',
          actorId: ctx.adminUserId,
          action: AUDIT_ACTIONS.catalogUnarchived,
          targetType: 'catalog_product',
          targetId: id,
          before: { archived: true },
          after: { archived: false, status: p.status, is_published: p.isPublished },
          ip: ctx.ip,
        });
        return p;
      });
      // No push: it comes back out-of-stock and unpublished-as-was, so nothing
      // becomes sellable here.
      return { product, changed: true };
    }
  }
}
