-- ============================================================================
-- ruo-stack — 0007_fix_profile_guard
-- Fix guard_profile_writes() so it only blocks an authenticated SELLER from
-- editing protected fields — not trusted server contexts.
--
-- The original guard allowed the write only when is_admin() was true. But
-- is_admin() reads auth.uid(), which is NULL for every service-role and direct
-- SQL caller. That unintentionally blocked:
--   • admin-api `bypass_user` (service role writing subscription_bypass)
--   • stripe-webhook activating subscription_status (service role)
--   • bootstrapping the very first admin (SQL editor — auth.uid() is NULL)
-- i.e. ALL trusted writes to protected fields failed.
--
-- Intent: only an authenticated, non-admin user (a seller) should be gated.
-- Trusted callers have no end-user JWT, so auth.uid() is NULL — let them pass.
-- ============================================================================

create or replace function guard_profile_writes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Admins and trusted server contexts (service role / direct SQL have no
  -- auth.uid()) may change protected fields. Only an authenticated seller is gated.
  if auth.uid() is null or is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.subscription_status is distinct from old.subscription_status
     or new.subscription_bypass is distinct from old.subscription_bypass
     or new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'protected profile field cannot be modified by seller';
  end if;
  return new;
end;
$$;
