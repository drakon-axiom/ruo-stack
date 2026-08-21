-- subscription_state.stripe_price_id (added in migration 00000000000030) was
-- created without an index despite its own schema.prisma comment claiming one:
-- Task 6 resolves a plan tier from a stored price id, and Phase 2 computes the
-- blast radius of a price change (which brands are on it) by filtering on this
-- column — both would sequential-scan subscription_state without this index.
--
-- Plain (non-unique) index: many brands legitimately share one Stripe price,
-- unlike PlanPrice.stripe_price_id, which is unique because there a price id
-- maps to exactly one ledger row.

-- CreateIndex
CREATE INDEX "subscription_state_stripe_price_id_idx" ON "subscription_state"("stripe_price_id");
