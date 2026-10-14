// Run the AI rewrite on 20 sample listings and count how many added something not in the input.
// This number goes in the build log whatever it is (SPEC section 7).
// Usage: npm run rewrite-sample   (needs the edge function deployed and ANTHROPIC_API_KEY set in Supabase secrets)

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const N_CLEAN = 10;
const N_FLAWED = 10;

const { data: areas } = await admin.from("areas").select("area_id, area_name");
const { data: buildings } = await admin.from("buildings").select("building_id, building_name");
const areaName = Object.fromEntries(areas.map((a) => [a.area_id, a.area_name]));
const buildingName = Object.fromEntries(buildings.map((b) => [b.building_id, b.building_name]));

const { data: cleanRows } = await admin.from("listings").select("*").is("flaws", null).order("listing_id").limit(N_CLEAN);
const { data: flawedRows } = await admin.from("listings").select("*").not("flaws", "is", null).order("listing_id").limit(N_FLAWED);
const sample = [...cleanRows, ...flawedRows];

// Shape the row the way the form would send it: names, not ids, and nothing the agent did not fill in.
const asDraft = (l) => ({
  title: l.title,
  description: l.description_en,
  description_th: l.description_th,
  building: buildingName[l.building_id],
  area: areaName[l.area_id],
  size_sqm: l.size_sqm,
  floor: l.floor,
  bedrooms: l.bedrooms,
  bathrooms: l.bathrooms,
  monthly_rent_thb: l.monthly_rent_thb,
  furnishing: l.furnishing,
  photo_count: l.photo_count,
  nearest_station: l.nearest_station,
});

const results = [];
for (const l of sample) {
  const started = Date.now();
  const { data, error } = await anon.functions.invoke("rewrite", { body: { listing: asDraft(l), listing_id: l.listing_id } });
  const ms = Date.now() - started;
  if (error) {
    let detail = error.message;
    try { detail = (await error.context?.json())?.error ?? detail; } catch {}
    console.log(`${l.listing_id}  ERROR  ${detail}`);
    results.push({ id: l.listing_id, error: detail });
    continue;
  }
  const added = data.facts_added ?? [];
  console.log(`${l.listing_id}  ${String(ms).padStart(5)} ms  ${(l.flaws ?? "clean").padEnd(34)} added: ${added.length ? added.join(", ") : "-"}`);
  results.push({ id: l.listing_id, added, flagged: data.flagged, rewrite: data.rewrite, flaws: l.flaws });
}

const ok = results.filter((r) => !r.error);
const withAdditions = ok.filter((r) => r.added.length > 0);
const freq = {};
for (const r of withAdditions) for (const t of r.added) freq[t] = (freq[t] ?? 0) + 1;

console.log(`\n${withAdditions.length} of ${ok.length} rewrites added something that was not in the input` + (results.length - ok.length ? ` (${results.length - ok.length} errors)` : ""));
if (Object.keys(freq).length) {
  console.log("most common additions:", Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join(", "));
}
for (const r of withAdditions) {
  console.log(`\n--- ${r.id} ---`);
  for (const [field, tokens] of Object.entries(r.flagged)) if (tokens.length) console.log(`${field}: ${tokens.join(", ")}\n  ${r.rewrite[field]}`);
}
