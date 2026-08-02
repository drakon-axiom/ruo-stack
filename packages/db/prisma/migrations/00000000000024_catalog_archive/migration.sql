-- Catalog lifecycle: retire a product without deleting it.
--
-- A published product can never be hard-deleted — OrderItem references it with
-- ON DELETE RESTRICT, and aliases / brand prices / provisioning records would
-- cascade away while the product itself keeps sitting in brands' storefronts
-- carrying our SKU. So retiring one archives it instead.
--
-- Archiving is gated (in the API) on status = out_of_stock, so the existing
-- stock push has already pulled it from brand stores before it leaves the
-- catalog. Archived products are excluded from every brand-facing query and are
-- never sellable.
ALTER TABLE "catalog_product" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "catalog_product_archived_idx" ON "catalog_product"("archived");
