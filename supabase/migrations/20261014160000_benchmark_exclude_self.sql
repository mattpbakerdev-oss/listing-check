-- Optional self-exclusion for measurement.
--
-- When the check script benchmarks a listing that is already in the table, that listing is one
-- of its own comparables. In a group of 3 it is a third of the median, so it looks correctly
-- priced whatever its rent. That hid both false flags and misses (BUILD_LOG, 14 Oct 2026).
-- A new draft typed into the app is not in the table, so the honest measurement excludes self.
--
-- p_exclude_listing_id is optional and defaults to null. The app passes nothing, so v1
-- behaviour for the UI is unchanged. The medians are computed inline from listing_rent_sqm
-- rather than from the benchmark views, because the views cannot exclude a row.

drop function if exists benchmark_listing(text, text, integer, integer, integer);

create or replace function benchmark_listing(
  p_building_id text, p_area_id text, p_bedrooms integer, p_rent integer, p_size integer,
  p_exclude_listing_id text default null
)
returns table (
  basis text, n bigint, median_rent_per_sqm numeric, listing_rent_per_sqm numeric, pct_diff numeric
) language sql stable as $$
  with pool as (
    select l.listing_id, l.building_id, l.area_id, l.bedrooms, l.rent_per_sqm, b.tier
    from listing_rent_sqm l
    left join buildings b on b.building_id = l.building_id
    where (l.area_id = p_area_id or l.building_id = p_building_id)
      and (p_exclude_listing_id is null or l.listing_id <> p_exclude_listing_id)
  ), t as (
    select tier from buildings where building_id = p_building_id
  ), candidates as (
    select 'building_bedrooms'::text as basis, 1 as priority, count(*) as n,
           (percentile_cont(0.5) within group (order by rent_per_sqm))::numeric as median_rent_per_sqm
    from pool where building_id = p_building_id and bedrooms = p_bedrooms
    union all
    select 'area_tier_bedrooms', 2, count(*),
           (percentile_cont(0.5) within group (order by rent_per_sqm))::numeric
    from pool, t where pool.area_id = p_area_id and pool.tier = t.tier and pool.bedrooms = p_bedrooms
    union all
    select 'area_tier', 3, count(*),
           (percentile_cont(0.5) within group (order by rent_per_sqm))::numeric
    from pool, t where pool.area_id = p_area_id and pool.tier = t.tier
    union all
    select 'area', 4, count(*),
           (percentile_cont(0.5) within group (order by rent_per_sqm))::numeric
    from pool where pool.area_id = p_area_id
  ), pick as (
    select basis, n, median_rent_per_sqm
    from candidates
    where n >= 3 or (basis = 'area' and n > 0)
    order by priority
    limit 1
  )
  select
    basis, n, median_rent_per_sqm,
    round(p_rent::numeric / nullif(p_size, 0), 0) as listing_rent_per_sqm,
    round(((p_rent::numeric / nullif(p_size, 0)) - median_rent_per_sqm) / median_rent_per_sqm * 100, 1) as pct_diff
  from pick;
$$;
