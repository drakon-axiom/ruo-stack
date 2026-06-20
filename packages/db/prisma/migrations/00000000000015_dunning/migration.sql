-- Dunning: track when a membership payment first failed (grace window) and when we
-- notified the brand.
ALTER TABLE "subscription_state"
  ADD COLUMN "past_due_since" TIMESTAMP(3),
  ADD COLUMN "dunning_notified_at" TIMESTAMP(3);
