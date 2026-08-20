-- Records when a brand user finished the first-run welcome tour. NULL means
-- "not finished", which is what makes the tour fire on first login.
--
-- DELIBERATELY NOT BACKFILLED. Every existing profile stays NULL, so current
-- users see the explainer once on their next login. The tour is dismissable and
-- non-blocking, so a single interruption after deploy is an acceptable cost for
-- explaining the fulfillment model to brands who have been guessing at it.
--
-- A nullable timestamp rather than a boolean: it answers "did they finish" and
-- "when" in one column, making completion rate a query instead of an event table.

-- AlterTable
ALTER TABLE "user_profile" ADD COLUMN "onboarding_completed_at" TIMESTAMP(3);
