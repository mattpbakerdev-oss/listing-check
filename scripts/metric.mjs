// The primary metric (SPEC section 3): points recovered on flagged listings.
//
// For every sample listing scoring under 85 on first pass, simulate an agent accepting every
// suggested fix, then re-score:
//   - structured gaps get a sensible value: floor 10, bathrooms 1, furnishing "fully furnished",
//     photos 8, size from the median of same-bedroom listings in the same building, else area
//   - title and description take the AI rewrite, generated from the draft AFTER the structured
//     fixes so the model can mention the floor it now has. Logged rewrites are reused only when
//     the listing needed no structured fix (then the logged draft is the fixed draft).
//   - calls are capped; the cost is reported
// Usage: npm run metric [-- --cap 71]

import { createClient } from "@supabase/supabase-js";
import { scoreListing } from "../lib/completeness/score.js";
import { num, present, FURNISHING_VALUES, norm } from "../lib/completeness/rules.js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) { console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(1); }
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const capArg = process.argv.indexOf("--cap");
const CAP = capArg > -1 ? Number(process.argv[capArg + 1]) : 71;
const THRESHOLD = 85;
const PRICE = { "claude-sonnet-5-5": { in: 2, out: 10 }, "claude-sonnet-5": { in: 2, out: 10 }, "claude-opus-5": { in: 5, out: 25 } };
const FIXES = { floor: "10", bathrooms: "1", furnishing: "fully furnished", photo_count: "8" };

const { data: areas } = await admin.from("areas").select("area_id, area_name");
const { data: buildings } = await admin.from("buildings").select("building_id, building_name, area_id, nearest_station, aliases");
const { data: listings } = await admin.from("listings").select("*").order("listing_id");
const { data: logs } = await admin.from("rewrite_log").select("listing_id, model, prompt, response, created_at").not("listing_id", "is", null).order("created_at");
const reference = { buildings, areas };
const areaName = Object.fromEntries(areas.map((a) => [a.area_id, a.area_name]));
const buildingName = Object.fromEntries(buildings.map((b) => [b.building_id, b.building_name]));

const asDraft = (l) => ({
  title: l.title, description: l.description_en, description_th: l.description_th,
  building: buildingName[l.building_id], area: areaName[l.area_id],
  size_sqm: l.size_sqm, floor: l.floor, bedrooms: l.bedrooms, bathrooms: l.bathrooms,
  monthly_rent_thb: l.monthly_rent_thb, furnishing: l.furnishing, photo_count: l.photo_count, nearest_station: l.nearest_station,
});

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };
function typicalSize(l) {
  const same = (xs) => xs.filter((x) => x.bedrooms === l.bedrooms && x.size_sqm).map((x) => x.size_sqm);
  return median(same(listings.filter((x) => x.building_id === l.building_id))) ?? median(same(listings.filter((x) => x.area_id === l.area_id))) ?? 35;
}

function applyStructuredFixes(l, draft) {
  const fixed = { ...draft };
  const applied = [];
  const r = scoreListing(draft, reference);
  for (const f of r.fields) {
    if (f.status === "ok") continue;
    if (f.field in FIXES) { fixed[f.field] = FIXES[f.field]; applied.push(f.field); }
    else if (f.field === "size_sqm") { fixed.size_sqm = String(typicalSize(l)); applied.push("size_sqm"); }
  }
  // Furnishing present but not one of the three values counts as a fix too.
  if (present(fixed.furnishing) && !FURNISHING_VALUES.includes(norm(fixed.furnishing))) { fixed.furnishing = FIXES.furnishing; if (!applied.includes("furnishing")) applied.push("furnishing"); }
  return { fixed, applied };
}

// Latest logged rewrite per listing, with the draft it was generated from. Reused only when
// that draft is the same as the fixed draft (the rent is not in logged drafts, so it is not compared).
const logged = new Map();
for (const row of logs) if (row.response?.output) logged.set(row.listing_id, row);
const COMPARE = ["title", "description", "description_th", "building", "area", "size_sqm", "floor", "bedrooms", "bathrooms", "furnishing", "photo_count", "nearest_station"];
const sameDraft = (logDraft, fixed) => COMPARE.every((k) => String(logDraft?.[k] ?? "") === String(fixed[k] ?? ""));

async function rewriteFor(l, draft) {
  const { data, error } = await admin.functions.invoke("rewrite", { body: { listing: draft, listing_id: l.listing_id } });
  if (error) {
    let detail = error.message;
    try { detail = (await error.context?.json())?.error ?? detail; } catch {}
    throw new Error(detail);
  }
  return data;
}

const before = listings.map((l) => ({ l, draft: asDraft(l), score: scoreListing(asDraft(l), reference).score }));
const flagged = before.filter((b) => b.score < THRESHOLD);
console.log(`listings ${listings.length}, flagged under ${THRESHOLD}: ${flagged.length}, mean before ${(flagged.reduce((s, b) => s + b.score, 0) / flagged.length).toFixed(1)}\n`);

let calls = 0, reused = 0, failures = 0, cost = 0, factsAdded = 0;
const after = [];
for (const b of flagged) {
  const { fixed, applied } = applyStructuredFixes(b.l, b.draft);
  let rewrite = null, source = "none";
  const log = logged.get(b.l.listing_id);
  if (log && sameDraft(log.prompt?.input?.draft, fixed)) { rewrite = log.response.output; source = `logged ${log.model}`; reused++; }
  else if (calls < CAP) {
    try {
      const data = await rewriteFor(b.l, fixed);
      calls++;
      rewrite = data.rewrite; source = data.model;
      if (data.facts_added?.length) factsAdded++;
      const p = PRICE[data.model]; if (p && data.usage) cost += (data.usage.input_tokens * p.in + data.usage.output_tokens * p.out) / 1e6;
    } catch (e) { failures++; source = `error: ${e.message}`; }
  } else source = "cap reached";
  const finalDraft = rewrite ? { ...fixed, title: rewrite.title_en, description: rewrite.description_en, title_th: rewrite.title_th, description_th: rewrite.description_th } : fixed;
  const r = scoreListing(finalDraft, reference);
  after.push({ ...b, applied, source, after: r.score, result: r });
  console.log(`${b.l.listing_id}  ${String(b.score).padStart(3)} -> ${String(r.score).padStart(3)}  fixes: ${applied.join(",") || "-"}  rewrite: ${source}`);
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const reached = after.filter((a) => a.after >= THRESHOLD).length;
console.log(`\nflagged listings: ${after.length}`);
console.log(`mean before: ${mean(after.map((a) => a.score)).toFixed(1)}`);
console.log(`mean after:  ${mean(after.map((a) => a.after)).toFixed(1)}`);
console.log(`reach ${THRESHOLD} or more after fixes: ${reached} of ${after.length} (${(reached / after.length * 100).toFixed(0)}%)`);
console.log(`rewrites: ${calls} model calls ($${cost.toFixed(3)}), ${reused} reused from the log, ${failures} failed; ${factsAdded} of ${calls} fresh rewrites added a fact not in the input`);

const shortfall = {};
for (const a of after) if (a.after < THRESHOLD) for (const f of a.result.fields) if (f.status !== "ok") shortfall[f.field] = (shortfall[f.field] ?? 0) + 1;
if (Object.keys(shortfall).length) console.log(`still losing points among those under ${THRESHOLD}:`, Object.entries(shortfall).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} (${v})`).join(", "));
const still = after.filter((a) => a.after < THRESHOLD).slice(0, 5);
for (const a of still) console.log(`  ${a.l.listing_id} ${a.after}: ${a.result.fields.filter((f) => f.status !== "ok").map((f) => `${f.field} ${f.earned}/${f.points} ${f.message}`).join(" | ")}`);
