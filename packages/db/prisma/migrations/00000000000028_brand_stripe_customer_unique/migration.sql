-- brand.stripe_customer_id is the tenant-lookup key on every Stripe billing
-- webhook (resolveBrandId → findFirst on this column). It was unindexed and
-- non-unique: a seq scan per webhook, and nothing stopped two brands sharing a
-- customer id (which would misattribute a subscription/wallet event to whichever
-- row scans first). This unique index fixes both.
--
-- NOTE: NULLs are distinct in Postgres, so brands without a Stripe customer id
-- don't collide. If a database already has duplicate non-null customer ids,
-- dedupe them before applying (this will otherwise fail — correct fail-loud).

-- CreateIndex
CREATE UNIQUE INDEX "brand_stripe_customer_id_key" ON "brand"("stripe_customer_id");
