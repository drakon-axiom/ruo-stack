BEGIN;
SET LOCAL lock_timeout = '5s';

-- ECMAScript String.trim whitespace (deliberately excludes U+0085).
CREATE FUNCTION public.ruostack_js_trim(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;

-- ICU root lowercasing preserves JS casing such as dotted I and final sigma.
-- Invoker-only pure helper: no table reads or privileged execution.
CREATE FUNCTION public.ruostack_customer_key(recipient_name text, recipient_email text, postal_code text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT coalesce(nullif(lower(public.ruostack_js_trim(recipient_email) COLLATE "und-x-icu"), ''),
    'name:' || lower(public.ruostack_js_trim(recipient_name) COLLATE "und-x-icu") || '|' || postal_code);
$$;

-- Fixed-length hash avoids B-tree entry limits on imported recipient strings.
-- Queries ALSO compare the full key, so hash collisions never merge customers.
-- Prisma cannot model expression/partial indexes; this migration owns it.
CREATE INDEX order_customer_history_idx ON public."order"
  (brand_id, (md5(public.ruostack_customer_key(recipient_name, recipient_email, zip)) COLLATE "C"), created_at DESC, id DESC)
  WHERE status <> 'cancelled';
COMMIT;
