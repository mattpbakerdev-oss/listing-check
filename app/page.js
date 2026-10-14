import { createClient } from "@supabase/supabase-js";
import Checker from "./checker";

// Reference tables are small and change rarely. Re-fetched at most every five minutes.
export const revalidate = 300;

async function loadReference() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const [areas, buildings, listingRows] = await Promise.all([
    supabase.from("areas").select("area_id, area_name, one_bed_typical, rent_sqm_typical, rent_sqm_low, rent_sqm_high").order("area_name"),
    supabase.from("buildings").select("building_id, building_name, area_id, nearest_station, walk_min, completed_year, tier, aliases").order("building_name"),
    supabase.from("listings").select("building_id"),
  ]);
  if (areas.error) throw new Error(`Could not load areas: ${areas.error.message}`);
  if (buildings.error) throw new Error(`Could not load buildings: ${buildings.error.message}`);
  // "N listings in our data" on the building card. A few hundred ids, counted here, cached with the page.
  const counts = {};
  for (const r of listingRows.data ?? []) counts[r.building_id] = (counts[r.building_id] ?? 0) + 1;
  return { areas: areas.data, buildings: buildings.data.map((b) => ({ ...b, listing_count: counts[b.building_id] ?? 0 })) };
}

export default async function Page() {
  const reference = await loadReference();
  return <Checker reference={reference} />;
}
