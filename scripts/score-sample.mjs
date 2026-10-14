// Score every sample listing with the completeness function and print the distribution.
// This is the "before" half of the primary metric in SPEC.md section 3. No database needed.
// Usage: node scripts/score-sample.mjs

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, normaliseRow } from "./seed.mjs";
import { scoreListing } from "../lib/completeness/score.js";

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");
const read = (name) => parseCsv(readFileSync(resolve(DATA, name), "utf8")).map(normaliseRow);

const areas = read("areas.csv");
const buildings = read("buildings.csv").map((b) => ({ ...b, aliases: [] }));
const listings = read("listings.csv");
const buildingName = Object.fromEntries(buildings.map((b) => [b.building_id, b.building_name]));
const areaName = Object.fromEntries(areas.map((a) => [a.area_id, a.area_name]));
const reference = { buildings, areas };

// The CSV stores ids; an agent types names. Map back so the draft looks like form input.
const asDraft = (l) => ({
  title: l.title,
  description: l.description_en,
  description_th: l.description_th,
  building: buildingName[l.building_id] ?? l.building_id,
  area: areaName[l.area_id] ?? l.area_id,
  size_sqm: l.size_sqm,
  floor: l.floor,
  bedrooms: l.bedrooms,
  bathrooms: l.bathrooms,
  monthly_rent_thb: l.monthly_rent_thb,
  furnishing: l.furnishing,
  photo_count: l.photo_count,
  nearest_station: l.nearest_station,
});

const scored = listings.map((l) => ({ l, r: scoreListing(asDraft(l), reference) }));
const avg = (xs) => (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(1);
const clean = scored.filter((s) => !s.l.flaws);
const flawed = scored.filter((s) => s.l.flaws);

const FLAG_BELOW = 85; // SPEC section 3: the primary metric is measured on listings scoring under this on first pass
const flagged = scored.filter((s) => s.r.score < FLAG_BELOW);

console.log(`all listings      n=${scored.length}  mean ${avg(scored.map((s) => s.r.score))}`);
console.log(`no flaws          n=${clean.length}  mean ${avg(clean.map((s) => s.r.score))}`);
console.log(`with flaws        n=${flawed.length}  mean ${avg(flawed.map((s) => s.r.score))}`);
console.log(`flagged (<${FLAG_BELOW})     n=${flagged.length}  mean ${flagged.length ? avg(flagged.map((s) => s.r.score)) : "-"}   <- the "before" number for the primary metric`);

const buckets = {};
for (const { r } of scored) {
  const b = `${Math.floor(r.score / 10) * 10}s`;
  buckets[b] = (buckets[b] ?? 0) + 1;
}
console.log("\nscore distribution:", Object.entries(buckets).sort().map(([k, v]) => `${k}:${v}`).join("  "));

// Which fields lose the most points across the sample, and does each flaw type get caught?
const lost = {};
for (const { r } of scored) for (const f of r.fields) lost[f.field] = (lost[f.field] ?? 0) + (f.points - f.earned);
console.log("\npoints lost by field:", Object.entries(lost).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v.toFixed(0)}`).join("  "));

const byFlaw = {};
for (const { l, r } of flawed) for (const flaw of l.flaws.split(";")) (byFlaw[flaw] ??= []).push(r.score);
console.log("\nmean score by flaw type:");
for (const [flaw, xs] of Object.entries(byFlaw).sort()) console.log(`  ${flaw.padEnd(20)} n=${String(xs.length).padStart(3)}  mean ${avg(xs)}`);

const nonCleanPerfect = clean.filter((s) => s.r.score < 100);
if (nonCleanPerfect.length) {
  console.log(`\n${nonCleanPerfect.length} listings with no flaws score below 100. First few:`);
  for (const { l, r } of nonCleanPerfect.slice(0, 5)) console.log(`  ${l.listing_id} ${r.score}  ${r.fields.filter((f) => f.status !== "ok").map((f) => `${f.field}: ${f.message}`).join(" | ")}`);
}
