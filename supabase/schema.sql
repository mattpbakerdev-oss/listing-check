-- Listing Check: Supabase schema v1
-- Run in the Supabase SQL editor, then import the CSVs from /data in this order:
-- areas.csv -> buildings.csv -> listings.csv (Table editor > Import data from CSV).

create table if not exists areas (
  area_id           text primary key,
  area_name         text not null,
  rent_sqm_typical  numeric not null,
  rent_sqm_low      numeric not null,
  rent_sqm_high     numeric not null,
  one_bed_typical   integer not null,
  confidence        text not null check (confidence in ('direct','interpolated'))
);

create table if not exists buildings (
  building_id     text primary key,
  building_name   text not null,
  area_id         text not null references areas(area_id),
  nearest_station text not null,
  walk_min        integer,
  completed_year  integer,
  tier            text check (tier in ('luxury','mid','budget'))
);

create table if not exists listings (
  listing_id       text primary key,
  building_id      text references buildings(building_id),
  area_id          text references areas(area_id),
  title            text,
  description_en   text,
  description_th   text,
  bedrooms         integer,
  bathrooms        integer,
  size_sqm         integer,
  floor            integer,
  monthly_rent_thb integer,
  furnishing       text,
  photo_count      integer,
  nearest_station  text,
  listed_date      date,
  status           text default 'active',
  flaws            text,                     -- ground truth for sample data only; empty in production
  created_at       timestamptz default now()
);

-- Every AI rewrite request and response, so we can count how often the model adds facts.
create table if not exists rewrite_log (
  id              bigint generated always as identity primary key,
  listing_id      text,
  model           text,
  prompt          jsonb not null,
  response        jsonb,
  facts_added     text[],                    -- words/numbers in the output not present in the input
  accepted        boolean,                   -- did the agent accept the rewrite
  created_at      timestamptz default now()
);

create index if not exists listings_building_idx on listings(building_id);
create index if not exists listings_area_idx on listings(area_id);

-- Rent per sqm for every priced listing.
create or replace view listing_rent_sqm as
select
  l.listing_id, l.building_id, l.area_id,
  l.monthly_rent_thb, l.size_sqm,
  round(l.monthly_rent_thb::numeric / nullif(l.size_sqm, 0), 0) as rent_per_sqm
from listings l
where l.monthly_rent_thb is not null and l.size_sqm is not null and l.size_sqm > 0;

-- Median rent per sqm by building, with sample size.
create or replace view building_benchmark as
select
  building_id,
  count(*) as n,
  percentile_cont(0.5) within group (order by rent_per_sqm) as median_rent_per_sqm
from listing_rent_sqm
group by building_id;

-- Median rent per sqm by area, with sample size.
create or replace view area_benchmark as
select
  area_id,
  count(*) as n,
  percentile_cont(0.5) within group (order by rent_per_sqm) as median_rent_per_sqm
from listing_rent_sqm
group by area_id;

-- The benchmark function the app calls: same building if 3+ comparables, else the area.
create or replace function benchmark_listing(p_building_id text, p_area_id text, p_rent integer, p_size integer)
returns table (
  basis text, n bigint, median_rent_per_sqm numeric, listing_rent_per_sqm numeric, pct_diff numeric
) language sql stable as $$
  with b as (
    select 'building'::text as basis, n, median_rent_per_sqm
    from building_benchmark where building_id = p_building_id and n >= 3
  ), a as (
    select 'area'::text as basis, n, median_rent_per_sqm
    from area_benchmark where area_id = p_area_id
  ), pick as (
    select * from b union all select * from a where not exists (select 1 from b)
  )
  select
    basis, n, median_rent_per_sqm,
    round(p_rent::numeric / nullif(p_size, 0), 0) as listing_rent_per_sqm,
    round(((p_rent::numeric / nullif(p_size, 0)) - median_rent_per_sqm) / median_rent_per_sqm * 100, 1) as pct_diff
  from pick;
$$;
