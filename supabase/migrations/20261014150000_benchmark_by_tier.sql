-- Benchmark chain with building tier.
--
-- Measured on the sample (BUILD_LOG, 14 Oct 2026): slicing by bedrooms alone made the comparable
-- groups tiny and the medians noisy, and the whole-area fallback mixed luxury and budget buildings.
-- Tier is what separated a correctly priced luxury studio from its mid-tier neighbours.
-- The chain is now the first of these with 3 or more comparables:
--   1. same building, same bedroom count
--   2. same area, same tier, same bedroom count
--   3. same area, same tier
--   4. the whole area
-- Same signature and return type as before, so the app call does not change.

create or replace view area_tier_bedroom_benchmark with (security_invoker = true) as
select
  l.area_id,
  b.tier,
  l.bedrooms,
  count(*) as n,
  (percentile_cont(0.5) within group (order by l.rent_per_sqm))::numeric as median_rent_per_sqm
from listing_rent_sqm l
join buildings b on b.building_id = l.building_id
where l.bedrooms is not null and b.tier is not null
group by l.area_id, b.tier, l.bedrooms;

create or replace view area_tier_benchmark with (security_invoker = true) as
select
  l.area_id,
  b.tier,
  count(*) as n,
  (percentile_cont(0.5) within group (order by l.rent_per_sqm))::numeric as median_rent_per_sqm
from listing_rent_sqm l
join buildings b on b.building_id = l.building_id
where b.tier is not null
group by l.area_id, b.tier;

create or replace function benchmark_listing(
  p_building_id text, p_area_id text, p_bedrooms integer, p_rent integer, p_size integer
)
returns table (
  basis text, n bigint, median_rent_per_sqm numeric, listing_rent_per_sqm numeric, pct_diff numeric
) language sql stable as $$
  with t as (
    select tier from buildings where building_id = p_building_id
  ), candidates as (
    select 'building_bedrooms'::text as basis, 1 as priority, n, median_rent_per_sqm
    from building_bedroom_benchmark
    where building_id = p_building_id and bedrooms = p_bedrooms and n >= 3
    union all
    select 'area_tier_bedrooms', 2, n, median_rent_per_sqm
    from area_tier_bedroom_benchmark, t
    where area_id = p_area_id and area_tier_bedroom_benchmark.tier = t.tier and bedrooms = p_bedrooms and n >= 3
    union all
    select 'area_tier', 3, n, median_rent_per_sqm
    from area_tier_benchmark, t
    where area_id = p_area_id and area_tier_benchmark.tier = t.tier and n >= 3
    union all
    select 'area', 4, n, median_rent_per_sqm
    from area_benchmark
    where area_id = p_area_id
  ), pick as (
    select basis, n, median_rent_per_sqm from candidates order by priority limit 1
  )
  select
    basis, n, median_rent_per_sqm,
    round(p_rent::numeric / nullif(p_size, 0), 0) as listing_rent_per_sqm,
    round(((p_rent::numeric / nullif(p_size, 0)) - median_rent_per_sqm) / median_rent_per_sqm * 100, 1) as pct_diff
  from pick;
$$;
