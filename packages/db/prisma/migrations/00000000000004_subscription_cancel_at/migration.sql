-- Track Stripe's cancel_at_period_end so the UI can show "Ends" (not "Renews")
-- once a paid plan is set to cancel at the end of the current period.
ALTER TABLE "subscription_state"
  ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;
