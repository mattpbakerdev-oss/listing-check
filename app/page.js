import { createClient } from "@supabase/supabase-js";
import Checker from "./checker";

// Reference tables are small and change rarely. Re-fetched at most every five minutes.
export const revalidate = 300;

async function loadReference() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const [areas, buildings] = await Promise.all([
    supabase.from("areas").select("area_id, area_name, one_bed_typical, rent_sqm_typical").order("area_name"),
    supabase.from("buildings").select("building_id, building_name, area_id, nearest_station, tier, aliases").order("building_name"),
  ]);
  if (areas.error) throw new Error(`Could not load areas: ${areas.error.message}`);
  if (buildings.error) throw new Error(`Could not load buildings: ${buildings.error.message}`);
  return { areas: areas.data, buildings: buildings.data };
}

export default async function Page() {
  const reference = await loadReference();
  return <Checker reference={reference} />;
}
