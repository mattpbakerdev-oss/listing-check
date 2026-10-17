// Benchmark chain variants (17 Oct 2026, station-proximity trial): computed client-side from the listings and buildings tables,
// self-excluded, minimum 8 comparables, same bands as the app. Mirrors how the tier chain was chosen.
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const [{ data: L }, { data: B }] = await Promise.all([sb.from("listings").select("listing_id, building_id, area_id, bedrooms, size_sqm, monthly_rent_thb, flaws"), sb.from("buildings").select("building_id, area_id, tier, walk_min, nearest_station")]);
const bld = Object.fromEntries(B.map((b) => [b.building_id, b]));
const pool = L.filter((l) => l.monthly_rent_thb && l.size_sqm).map((l) => ({ ...l, rps: l.monthly_rent_thb / l.size_sqm, tier: bld[l.building_id]?.tier, walk: bld[l.building_id]?.walk_min, station: bld[l.building_id]?.nearest_station }));
const walks = B.map((b) => b.walk_min).filter((w) => w != null).sort((a, b) => a - b);
console.log(`listings priced ${pool.length} of ${L.length}; buildings ${B.length}; walk_min min ${walks[0]} median ${walks[Math.floor(walks.length / 2)]} max ${walks[walks.length - 1]}`);
const w2 = (w) => (w == null ? "?" : w <= 7 ? "near" : "far");
const w3 = (w) => (w == null ? "?" : w <= 5 ? "near" : w <= 10 ? "mid" : "far");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// A chain is a list of predicates; the first with 8 or more comparables wins, else the whole area with whatever it has.
const CHAINS = {
  "current: bld+bed, area+tier+bed, area+tier, area": (t) => [(c) => c.building_id === t.building_id && c.bedrooms === t.bedrooms, (c) => c.area_id === t.area_id && c.tier === t.tier && c.bedrooms === t.bedrooms, (c) => c.area_id === t.area_id && c.tier === t.tier],
  "walk2 inside tier: +area+tier+walk2+bed, area+tier+walk2": (t) => [(c) => c.building_id === t.building_id && c.bedrooms === t.bedrooms, (c) => c.area_id === t.area_id && c.tier === t.tier && w2(c.walk) === w2(t.walk) && c.bedrooms === t.bedrooms, (c) => c.area_id === t.area_id && c.tier === t.tier && w2(c.walk) === w2(t.walk), (c) => c.area_id === t.area_id && c.tier === t.tier && c.bedrooms === t.bedrooms, (c) => c.area_id === t.area_id && c.tier === t.tier],
  "walk3 inside tier": (t) => [(c) => c.building_id === t.building_id && c.bedrooms === t.bedrooms, (c) => c.area_id === t.area_id && c.tier === t.tier && w3(c.walk) === w3(t.walk) && c.bedrooms === t.bedrooms, (c) => c.area_id === t.area_id && c.tier === t.tier && w3(c.walk) === w3(t.walk), (c) => c.area_id === t.area_id && c.tier === t.tier && c.bedrooms === t.bedrooms, (c) => c.area_id === t.area_id && c.tier === t.tier],
  "walk2 instead of tier: bld+bed, area+walk2+bed, area+walk2, area": (t) => [(c) => c.building_id === t.building_id && c.bedrooms === t.bedrooms, (c) => c.area_id === t.area_id && w2(c.walk) === w2(t.walk) && c.bedrooms === t.bedrooms, (c) => c.area_id === t.area_id && w2(c.walk) === w2(t.walk)],
  "station+tier: bld+bed, station+tier+bed, station+tier, area+tier, area": (t) => [(c) => c.building_id === t.building_id && c.bedrooms === t.bedrooms, (c) => c.station === t.station && c.tier === t.tier && c.bedrooms === t.bedrooms, (c) => c.station === t.station && c.tier === t.tier, (c) => c.area_id === t.area_id && c.tier === t.tier],
};
function pct(target, chain) {
  const others = pool.filter((c) => c.listing_id !== target.listing_id);
  for (const pred of chain(target)) { const g = others.filter(pred); if (g.length >= 8) return (target.rps - median(g.map((c) => c.rps))) / median(g.map((c) => c.rps)) * 100; }
  const g = others.filter((c) => c.area_id === target.area_id); if (!g.length) return null;
  return (target.rps - median(g.map((c) => c.rps))) / median(g.map((c) => c.rps)) * 100;
}
const clean = pool.filter((l) => !l.flaws), mis = pool.filter((l) => /overpriced|underpriced|typo_price/.test(l.flaws ?? "")), typo = pool.filter((l) => /typo_price/.test(l.flaws ?? ""));
console.log(`clean ${clean.length}, mispriced ${mis.length}, typo-priced ${typo.length}\n`);
console.log("chain".padEnd(70), "clean >10%", "clean >25%", "mispriced caught", "typo in red");
for (const [name, chain] of Object.entries(CHAINS)) {
  const d = (xs) => xs.map((l) => pct(l, chain)).filter((x) => x !== null);
  const c = d(clean), m = d(mis), t = d(typo);
  const p = (n, k) => `${n}/${k} (${Math.round(n / k * 100)}%)`;
  console.log(name.padEnd(70), p(c.filter((x) => Math.abs(x) > 10).length, c.length).padEnd(11), p(c.filter((x) => Math.abs(x) > 25).length, c.length).padEnd(11), p(m.filter((x) => Math.abs(x) > 10).length, m.length).padEnd(17), p(t.filter((x) => Math.abs(x) > 25).length, t.length));
}
// Does walking time relate to rent per sqm at all within area and tier, in this sample? Clean listings only,
// so typo prices do not swamp the means; medians of the ratio to the group median.
const groups = {}; for (const c of pool.filter((l) => !l.flaws)) { const k = `${c.area_id}|${c.tier}`; (groups[k] ??= []).push(c); }
let near = [], far = [];
for (const g of Object.values(groups)) { if (g.length < 8) continue; const med = median(g.map((c) => c.rps)); for (const c of g) (w2(c.walk) === "near" ? near : far).push(c.rps / med); }
console.log(`\nclean listings within area+tier groups of 8+, rent/sqm as a ratio to the group median: near (<=7 min) median ${median(near).toFixed(3)} n=${near.length}; far median ${median(far).toFixed(3)} n=${far.length}`);
