-- ============================================================================
-- ruo-stack — 0003_wallet_ledger
-- Server-authoritative money. Every balance change is atomic and writes a
-- matching wallet_transactions row, so balance == sum(transactions) always.
--
-- These functions are SECURITY DEFINER and are REVOKED from clients. Only the
-- service role (edge functions / webhooks) may call them. The client never
-- passes an amount that moves money — amounts are recomputed here from the
-- catalog and order_items. This is the defense against the `missing_deduction`
-- and client-trusted-amount classes of bug.
-- ============================================================================

-- credit_wallet: add funds (deposit / refund / referral / manual credit).
create or replace function credit_wallet(
  p_user uuid,
  p_amount numeric,
  p_type wallet_txn_type,
  p_description text default null,
  p_order_id uuid default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_new_balance numeric;
begin
  if p_amount <= 0 then
    raise exception 'credit amount must be positive (got %)', p_amount;
  end if;

  update wallets
    set balance = balance + p_amount
    where user_id = p_user
    returning balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'no wallet for user %', p_user;
  end if;

  insert into wallet_transactions (user_id, type, amount, balance_after, description, order_id)
    values (p_user, p_type, p_amount, v_new_balance, p_description, p_order_id);

  return v_new_balance;
end;
$$;

-- debit_wallet: remove funds. Locks the wallet row, refuses to go negative.
-- Returns TRUE on success, FALSE if insufficient balance (no exception, so the
-- caller can park the order at awaiting_funds).
create or replace function debit_wallet(
  p_user uuid,
  p_amount numeric,
  p_description text default null,
  p_order_id uuid default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_balance numeric;
  v_new_balance numeric;
begin
  if p_amount <= 0 then
    raise exception 'debit amount must be positive (got %)', p_amount;
  end if;

  -- lock the row to serialize concurrent debits for this user
  select balance into v_balance from wallets where user_id = p_user for update;
  if v_balance is null then
    raise exception 'no wallet for user %', p_user;
  end if;

  if v_balance < p_amount then
    return false;
  end if;

  v_new_balance := v_balance - p_amount;
  update wallets set balance = v_new_balance where user_id = p_user;

  insert into wallet_transactions (user_id, type, amount, balance_after, description, order_id)
    values (p_user, 'debit', -p_amount, v_new_balance, p_description, p_order_id);

  return true;
end;
$$;

-- order_cost: server-side recompute of an order's fulfillment cost from its
-- line items (never trust a client-supplied total).
create or replace function order_cost(p_order_id uuid)
returns numeric language sql security definer set search_path = public stable as $$
  select coalesce(sum(unit_cost * quantity), 0)
  from order_items where order_id = p_order_id;
$$;

-- fulfill_order: attempt to charge the wallet and move the order forward.
-- Idempotent: only acts on orders in pending/awaiting_funds.
create or replace function fulfill_order(p_order_id uuid)
returns order_status
language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_cost numeric;
  v_ok boolean;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.status not in ('pending', 'awaiting_funds') then
    return v_order.status;  -- already actioned; no-op
  end if;

  v_cost := order_cost(p_order_id) + coalesce(v_order.shipping_cost, 0);

  v_ok := debit_wallet(
    v_order.user_id,
    v_cost,
    'Fulfillment: order ' || left(p_order_id::text, 8),
    p_order_id
  );

  if v_ok then
    update orders
      set status = 'processing', fulfillment_cost = v_cost
      where id = p_order_id;
    return 'processing';
  else
    update orders set status = 'awaiting_funds', fulfillment_cost = v_cost
      where id = p_order_id;
    insert into monitor_alerts (category, order_id, user_id, details)
      values ('stuck_awaiting', p_order_id, v_order.user_id,
              jsonb_build_object('cost', v_cost));
    return 'awaiting_funds';
  end if;
end;
$$;

-- process_awaiting_funds: after a top-up, retry every parked order for a user
-- (oldest first) until the wallet runs dry.
create or replace function process_awaiting_funds(p_user uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_resumed integer := 0;
  v_status order_status;
begin
  for r in
    select id from orders
    where user_id = p_user and status = 'awaiting_funds'
    order by created_at asc
  loop
    v_status := fulfill_order(r.id);
    exit when v_status = 'awaiting_funds';  -- wallet empty again; stop
    v_resumed := v_resumed + 1;
  end loop;
  return v_resumed;
end;
$$;

-- refund_order: credit the wallet back and mark refunded. Guards against
-- double-refund by checking current status.
create or replace function refund_order(
  p_order_id uuid,
  p_amount numeric default null,
  p_reason text default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_amount numeric;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'order % not found', p_order_id;
  end if;
  if v_order.status = 'refunded' then
    raise exception 'order % already refunded', p_order_id;
  end if;

  v_amount := coalesce(p_amount, v_order.fulfillment_cost);
  if v_amount > 0 then
    perform credit_wallet(v_order.user_id, v_amount, 'refund',
      coalesce(p_reason, 'Refund: order ' || left(p_order_id::text, 8)), p_order_id);
  end if;

  update orders set status = 'refunded' where id = p_order_id;
  return v_amount;
end;
$$;

-- credit_deposit: mark a Stripe deposit paid and credit the wallet exactly
-- once (idempotent on pending_deposits.status).
create or replace function credit_deposit(p_deposit_id uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_dep pending_deposits%rowtype;
  v_balance numeric;
begin
  select * into v_dep from pending_deposits where id = p_deposit_id for update;
  if v_dep.id is null then
    raise exception 'deposit % not found', p_deposit_id;
  end if;
  if v_dep.status = 'paid' then
    return null;  -- already credited; idempotent no-op
  end if;

  v_balance := credit_wallet(v_dep.user_id, v_dep.amount, 'deposit',
    'Wallet top-up', null);

  update pending_deposits
    set status = 'paid', credited_at = now()
    where id = p_deposit_id;

  -- a top-up may unblock parked orders
  perform process_awaiting_funds(v_dep.user_id);
  return v_balance;
end;
$$;

-- Lock all of these down: clients (anon/authenticated) cannot call them.
revoke all on function credit_wallet(uuid, numeric, wallet_txn_type, text, uuid) from public;
revoke all on function debit_wallet(uuid, numeric, text, uuid) from public;
revoke all on function order_cost(uuid) from public;
revoke all on function fulfill_order(uuid) from public;
revoke all on function process_awaiting_funds(uuid) from public;
revoke all on function refund_order(uuid, numeric, text) from public;
revoke all on function credit_deposit(uuid) from public;
