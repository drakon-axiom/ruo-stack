-- ============================================================================
-- ruo-stack — 0004_seed
-- Minimal platform settings + a small, lawful supplements catalog so the app
-- renders something out of the box. Replace with your real catalog.
-- ============================================================================

insert into platform_settings (key, value) values
  ('pro_price_monthly', '97'::jsonb),
  ('wallet_min_deposit', '1'::jsonb),
  ('referral_credit', '50'::jsonb),
  ('ship_from_country', '"US"'::jsonb),
  ('compliance_disclaimer',
    '"These statements have not been evaluated by the FDA. This product is not intended to diagnose, treat, cure, or prevent any disease."'::jsonb)
on conflict (key) do nothing;

-- Catalog: products -> variants -> lots (with COA + expiry for traceability).
with p as (
  insert into products (name, category, slug, description, serving_info, is_active) values
    ('Whey Protein Isolate', 'Protein', 'whey-protein-isolate',
     'Cold-filtered whey protein isolate, unflavored.', '24g protein per 30g scoop', true),
    ('Creatine Monohydrate', 'Performance', 'creatine-monohydrate',
     'Micronized creatine monohydrate powder.', '5g per serving', true),
    ('Vitamin D3 + K2', 'Vitamins', 'vitamin-d3-k2',
     'D3 (5000 IU) with K2 (MK-7) softgels.', '1 softgel daily', true),
    ('Magnesium Glycinate', 'Minerals', 'magnesium-glycinate',
     'Chelated magnesium glycinate capsules.', '2 capsules daily', true),
    ('Omega-3 Fish Oil', 'Essential Fatty Acids', 'omega-3-fish-oil',
     'Triglyceride-form fish oil, 1000mg EPA/DHA.', '2 softgels daily', true)
  returning id, slug
)
insert into product_variants (product_id, sku, size, wholesale_cost, suggested_retail, weight_oz, in_stock)
select p.id, v.sku, v.size, v.cost, v.retail, v.wt, v.in_stock
from p
join (values
  ('whey-protein-isolate', 'WPI-2LB',  '2 lb',   18.00, 39.99, 36.0, true),
  ('whey-protein-isolate', 'WPI-5LB',  '5 lb',   38.00, 79.99, 84.0, true),
  ('creatine-monohydrate', 'CRE-300',  '300g',    9.00, 24.99, 12.0, true),
  ('creatine-monohydrate', 'CRE-1KG',  '1 kg',   22.00, 49.99, 38.0, true),
  ('vitamin-d3-k2',        'D3K2-60',  '60ct',    6.00, 19.99,  3.0, true),
  ('magnesium-glycinate',  'MAG-120',  '120ct',   8.00, 22.99,  6.0, true),
  ('omega-3-fish-oil',     'OMG-90',   '90ct',   11.00, 29.99,  7.0, true)
) as v(slug, sku, size, cost, retail, wt, in_stock)
  on v.slug = p.slug;

-- One example lot per variant (COA + 2-year expiry) to exercise lot tracking.
insert into product_lots (variant_id, lot_number, coa_url, expiry_date, quantity_on_hand, received_at)
select pv.id,
       'LOT-' || upper(substr(md5(pv.sku), 1, 6)),
       'https://example.com/coa/' || pv.sku || '.pdf',
       (current_date + interval '2 years')::date,
       500,
       current_date
from product_variants pv;
