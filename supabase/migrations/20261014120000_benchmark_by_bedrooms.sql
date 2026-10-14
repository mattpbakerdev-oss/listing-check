-- Benchmark like with like.
--
-- The first benchmark compared a listing against every unit in its building. Small units
-- rent dearer per sqm, so correctly priced studios came out "above market" against a median
-- dominated by 1- and 2-beds (see BUILD_LOG, 14 Oct 2026). This version picks the first
-- basis with enough comparables:
--   1. same building, same bedroom count, 3 or more listings
--   2. same area, same bedroom count, 3 or more listings
--   3. the whole area
-- and reports which one it used.

-- Expose bedrooms on the per-listing view. CREATE OR REPLACE may only append columns, so it goes last.
create or replace view listing_rent_sqm with (security_invoker = true) as
select
  l.listing_id, l.building_id, l.area_id,
  l.monthly_rent_thb, l.size_sqm,
  round(l.monthly_rent_thb::numeric / nullif(l.size_sqm, 0), 0) as rent_per_sqm,
  l.bedrooms
from listings l
where l.monthly_rent_thb is not null and l.size_sqm is not null and l.size_sqm > 0;

create or replace view building_bedroom_benchmark with (security_invoker = true) as
select
  building_id,
  bedrooms,
  count(*) as n,
  (percentile_cont(0.5) within group (order by rent_per_sqm))::numeric as median_rent_per_sqm
from listing_rent_sqm
where bedrooms is not null
group by building_id, bedrooms;

create or replace view area_bedroom_benchmark with (security_invoker = true) as
select
  area_id,
  bedrooms,
  count(*) as n,
  (percentile_cont(0.5) within group (order by rent_per_sqm))::numeric as median_rent_per_sqm
from listing_rent_sqm
where bedrooms is not null
group by area_id, bedrooms;

-- New signature (adds p_bedrooms), so drop the old overload rather than leave two behind.
drop function if exists benchmark_listing(text, text, integer, integer);

create or replace function benchmark_listing(
  p_building_id text, p_area_id text, p_bedrooms integer, p_rent integer, p_size integer
)
returns table (
  basis text, n bigint, median_rent_per_sqm numeric, listing_rent_per_sqm numeric, pct_diff numeric
) language sql stable as $$
  with candidates as (
    select 'building_bedrooms'::text as basis, 1 as priority, n, median_rent_per_sqm
    from building_bedroom_benchmark
    where building_id = p_building_id and bedrooms = p_bedrooms and n >= 3
    union all
    select 'area_bedrooms', 2, n, median_rent_per_sqm
    from area_bedroom_benchmark
    where area_id = p_area_id and bedrooms = p_bedrooms and n >= 3
    union all
    select 'area', 3, n, median_rent_per_sqm
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
