# High-severity remediation rollout

Implementation branch: `fix/high-severity-remediation`.

The change closes owner-mediated recovery-link exposure, replayable admin MFA enrollment, store URL SSRF bypasses, non-atomic claim credits, and unlocked charged-reship reservations.

## Deployment order

1. Validate in staging: pending invitations still work; confirmed members use `/forgot`; new admins can enroll once; existing admins still log in; legitimate HTTP/HTTPS Woo stores work; claim credits and reships complete.
2. Apply migration `00000000000032_admin_mfa_enrollment`. It adds three nullable columns to `admin_user`; existing enrolled secrets are unchanged. Use the normal reviewed deployment pipeline and target environment, never a test command against production.
3. Deploy the API and brand web changes and drain all older API processes. Mixed versions leave the old enrollment/recovery endpoints vulnerable. Existing unfinished enrollment attempts must restart login; completed factors and existing sessions remain valid.
4. Monitor sanitized invitation/enrollment failures, store-sync errors, and claim success/conflict rates. Do not log tokens, invite URLs, MFA secrets, or store credentials.
5. Run the read-only queries below and investigate any historical inconsistency. Correct money only through separately reviewed ledger entries; never rewrite historical ledger/audit rows.

No production deployment or production reconciliation was performed during implementation. The integration tests use disposable PostgreSQL with minimal Supabase Auth role/function stubs; live Auth behavior and real Woo TLS endpoints require the staging smoke checks above.

## Historical claim consistency

This flags missing credits, credits associated with non-credit outcomes, and amount/brand/type mismatches. An unresolved claim with an old credit needs investigation before an operator retries it. The new code rejects a conflicting amount, denial, or reship rather than silently converting that outcome.

```sql
BEGIN TRANSACTION READ ONLY;
SELECT c.id AS claim_id, c.brand_id, c.status, c.resolution,
       c.amount_cents AS resolved_amount, w.id AS ledger_id,
       w.brand_id AS credited_brand, w.type, w.amount AS credited_amount
FROM claim c
LEFT JOIN wallet_ledger w ON w.external_id = 'claim:' || c.id::text || ':credit'
WHERE (c.resolution = 'credited' AND w.id IS NULL)
   OR (w.id IS NOT NULL AND (
       c.status <> 'resolved' OR c.resolution IS DISTINCT FROM 'credited'
       OR w.brand_id <> c.brand_id OR w.type <> 'refund_credit'
       OR w.amount IS DISTINCT FROM c.amount_cents));
COMMIT;
```

## Wallet over-reservation

```sql
BEGIN TRANSACTION READ ONLY;
WITH balances AS (
  SELECT DISTINCT ON (brand_id) brand_id, balance_after
  FROM wallet_ledger ORDER BY brand_id, seq DESC
), holds AS (
  SELECT brand_id, SUM(wallet_charge_cents) AS held
  FROM "order"
  WHERE status IN ('ready_for_fulfillment', 'processing') AND blocker = 'none'
  GROUP BY brand_id
)
SELECT h.brand_id, COALESCE(b.balance_after, 0) AS balance, h.held,
       COALESCE(b.balance_after, 0) - h.held AS available
FROM holds h LEFT JOIN balances b USING (brand_id)
WHERE h.held > COALESCE(b.balance_after, 0);
COMMIT;
```

These queries flag anomalies for review; they do not establish why an anomaly occurred or authorize a financial correction.

## Historically reopened resolutions

These rows may have been reopened by a delayed triage update in older versions.
The new resolver refuses another outcome when resolution metadata is present.

```sql
BEGIN TRANSACTION READ ONLY;
SELECT id, brand_id, status, resolution, resolved_at, reship_order_id
FROM claim
WHERE status <> 'resolved'
  AND (resolution IS NOT NULL OR resolved_at IS NOT NULL OR reship_order_id IS NOT NULL);
COMMIT;
```
