-- Store-order idempotency: at most one order per (brand, source, external id).
-- Store imports previously deduped only via a check-then-insert in app code, so
-- concurrent order.created / order.updated webhook deliveries for the same store
-- order could both insert — double-reserving the wallet and double-shipping.
-- externalOrderId is NULL for manual orders; Postgres treats NULLs as distinct,
-- so manual orders never collide under this constraint.
--
-- NOTE: if a database already contains duplicate store orders, dedupe them
-- before applying (this index creation will otherwise fail — the correct,
-- fail-loud behavior).

-- CreateIndex
CREATE UNIQUE INDEX "order_brand_id_source_external_order_id_key" ON "order"("brand_id", "source", "external_order_id");
