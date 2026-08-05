-- Retire the subscription-level `suspended` rows written before 025.
--
-- Every one of them got there by non-payment: the dunning sweep on grace
-- exhaustion, or the lapse sweep on a passed paid-through date. Neither is an
-- admin action against the account, so none of them should keep a name that
-- now means only that. `brand.status` is deliberately untouched — a genuinely
-- suspended ACCOUNT stays suspended.
UPDATE "subscription_state" SET "status" = 'expired' WHERE "status" = 'suspended';
