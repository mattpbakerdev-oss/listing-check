// Step 1 acceptance check: the data is loaded, the benchmark function answers sensibly,
// and the RLS policies do what the spec says. Exits non-zero on any failure.
// Usage: npm run check

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

let failures = 0;
function check(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures += 1;
}

async function count(client, table) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count;
}

// excludeSelf: leave the listing out of its own comparables. That is what a new draft experiences,
// since it is not in the table yet, so it is the honest way to measure on sample listings.
async function benchmark(client, l, { excludeSelf = false } = {}) {
  const { data, error } = await client.rpc("benchmark_listing", {
    p_building_id: l.building_id, p_area_id: l.area_id, p_bedrooms: l.bedrooms,
    p_rent: l.monthly_rent_thb, p_size: l.size_sqm,
    p_exclude_listing_id: excludeSelf ? l.listing_id : null,
  });
  if (error) throw new Error(`benchmark_listing(${l.listing_id}): ${error.message}`);
  return data[0];
}

async function firstWithFlaw(flaw) {
  // A listing carrying exactly this one flaw (or none), so the result is attributable to it.
  let q = admin.from("listings").select("*").not("size_sqm", "is", null).order("listing_id").limit(1);
  q = flaw === "" ? q.is("flaws", null) : q.eq("flaws", flaw);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  if (!data[0]) throw new Error(`no listing with flaws = '${flaw}'`);
  return data[0];
}

async function main() {
  // 1. Row counts match the CSVs.
  const counts = {};
  for (const t of ["areas", "buildings", "listings"]) counts[t] = await count(admin, t);
  check(counts.areas === 12, "areas loaded", `${counts.areas} rows`);
  check(counts.buildings === 67, "buildings loaded", `${counts.buildings} rows`);
  check(counts.listings === 400, "listings loaded", `${counts.listings} rows`);

  // 2. Empty CSV cells landed as NULL.
  const { count: nullFloors } = await admin.from("listings").select("*", { count: "exact", head: true }).is("floor", null);
  check(nullFloors > 0, "missing floors stored as NULL", `${nullFloors} listings`);

  // 3. Area medians sit inside each area's published band.
  const { data: areas } = await admin.from("areas").select("*").order("area_id");
  const { data: areaBench } = await admin.from("area_benchmark").select("*");
  const byArea = Object.fromEntries(areaBench.map((r) => [r.area_id, r]));
  console.log("\narea                 n   median  typical  band");
  for (const a of areas) {
    const b = byArea[a.area_id];
    const median = Number(b.median_rent_per_sqm);
    const inBand = median >= Number(a.rent_sqm_low) && median <= Number(a.rent_sqm_high);
    console.log(`${a.area_id.padEnd(20)} ${String(b.n).padStart(3)}  ${String(median).padStart(6)}  ${String(a.rent_sqm_typical).padStart(7)}  ${a.rent_sqm_low}-${a.rent_sqm_high}${inBand ? "" : "  <-- outside band"}`);
    if (!inBand) failures += 1;
  }
  console.log();

  // 4. The benchmark function: clean, overpriced, underpriced and typo-priced listings land in the right bands.
  const clean = await firstWithFlaw("");
  const over = await firstWithFlaw("overpriced");
  const under = await firstWithFlaw("underpriced");
  const typo = await firstWithFlaw("typo_price");
  const [bc, bo, bu, bt] = await Promise.all([clean, over, under, typo].map((l) => benchmark(admin, l, { excludeSelf: true })));
  const fmt = (l, b) => `${l.listing_id} ${l.building_id} ${l.bedrooms}-bed rent ${l.monthly_rent_thb} / ${l.size_sqm} sqm -> ${b.basis} n=${b.n} median ${b.median_rent_per_sqm} listing ${b.listing_rent_per_sqm} diff ${b.pct_diff}%`;
  // Informational: single listings are anecdotes. The population rates in 5b are the gate.
  console.log(`info  first clean listing:       ${fmt(clean, bc)}`);
  console.log(`info  first overpriced listing:  ${fmt(over, bo)}`);
  console.log(`info  first underpriced listing: ${fmt(under, bu)}`);
  console.log(`info  first typo-priced listing: ${fmt(typo, bt)}`);
  check(bt.basis && Number.isFinite(Number(bt.pct_diff)), "benchmark_listing returns a basis and a percentage");

  // 5. Every basis is reachable, and the fallback order holds.
  const { data: bldgs } = await admin.from("buildings").select("building_id, tier");
  const tierOf = Object.fromEntries(bldgs.map((b) => [b.building_id, b.tier]));
  const { data: bbb } = await admin.from("building_bedroom_benchmark").select("*");
  const { data: atb } = await admin.from("area_tier_bedroom_benchmark").select("*");
  const { data: at } = await admin.from("area_tier_benchmark").select("*");
  const MIN = 8; // must match the chain minimum in the latest benchmark_listing migration
  const bbbKey = new Set(bbb.filter((r) => r.n >= MIN).map((r) => `${r.building_id}|${r.bedrooms}`));
  const atbKey = new Set(atb.filter((r) => r.n >= MIN).map((r) => `${r.area_id}|${r.tier}|${r.bedrooms}`));
  const atKey = new Set(at.filter((r) => r.n >= MIN).map((r) => `${r.area_id}|${r.tier}`));
  const { data: all } = await admin.from("listings").select("*").not("size_sqm", "is", null).not("bedrooms", "is", null).order("listing_id");
  const expectBasis = (l) =>
    bbbKey.has(`${l.building_id}|${l.bedrooms}`) ? "building_bedrooms"
    : atbKey.has(`${l.area_id}|${tierOf[l.building_id]}|${l.bedrooms}`) ? "area_tier_bedrooms"
    : atKey.has(`${l.area_id}|${tierOf[l.building_id]}`) ? "area_tier"
    : "area";
  for (const want of ["building_bedrooms", "area_tier_bedrooms", "area_tier", "area"]) {
    const l = all.find((x) => expectBasis(x) === want);
    if (!l) { console.log(`note  no sample listing resolves to basis '${want}'`); continue; }
    const b = await benchmark(admin, l);
    check(b.basis === want, `basis '${want}' is used when it is the first with ${MIN}+ comparables`, fmt(l, b));
  }
  const tally = {};
  for (const l of all) tally[expectBasis(l)] = (tally[expectBasis(l)] ?? 0) + 1;
  console.log(`      basis mix across sample: ${JSON.stringify(tally)}`);

  // 5b. Population rates from the ground-truth flaws column, measured with the listing excluded from
  // its own comparables. These are the numbers that go in the build log. The catch rates are gated;
  // the false-flag rate on clean listings is reported, because it is a property of the sample size
  // as much as of the rule (SPEC section 6).
  const cleanAll = all.filter((l) => !l.flaws);
  const mispricedAll = all.filter((l) => /overpriced|underpriced|typo_price/.test(l.flaws ?? ""));
  const typoAll = all.filter((l) => /typo_price/.test(l.flaws ?? ""));
  const rates = async (excludeSelf) => {
    const diffOf = async (l) => Number((await benchmark(admin, l, { excludeSelf })).pct_diff);
    const [cleanDiffs, mispricedDiffs, typoDiffs] = await Promise.all([cleanAll, mispricedAll, typoAll].map((xs) => Promise.all(xs.map(diffOf))));
    return {
      falseFlags: cleanDiffs.filter((d) => Math.abs(d) > 10).length,
      falseTypo: cleanDiffs.filter((d) => Math.abs(d) > 25).length,
      caught: mispricedDiffs.filter((d) => Math.abs(d) > 10).length,
      typoCaught: typoDiffs.filter((d) => Math.abs(d) > 25).length,
    };
  };
  const pctOf = (a, b) => `${a}/${b} (${(a / b * 100).toFixed(0)}%)`;
  const incl = await rates(false);
  const excl = await rates(true);
  console.log(`info  self included (flatters): clean wrongly flagged >10% ${pctOf(incl.falseFlags, cleanAll.length)}, >25% ${incl.falseTypo}; mispriced caught ${pctOf(incl.caught, mispricedAll.length)}`);
  console.log(`info  self excluded (honest):   clean wrongly flagged >10% ${pctOf(excl.falseFlags, cleanAll.length)}, >25% ${excl.falseTypo}; mispriced caught ${pctOf(excl.caught, mispricedAll.length)}`);
  check(excl.caught / mispricedAll.length >= 0.85, "at least 85% of mispriced listings are flagged (self excluded)", pctOf(excl.caught, mispricedAll.length));
  check(excl.typoCaught / typoAll.length >= 0.9, "at least 90% of typo-priced listings land in the 'check for a typo' band", pctOf(excl.typoCaught, typoAll.length));

  // 6. RLS: anon reads listings, cannot write anything, cannot see rewrite_log.
  const { data: anonRows, error: anonReadErr } = await anon.from("listings").select("listing_id").limit(1);
  check(!anonReadErr && anonRows.length === 1, "anon can read listings");
  const { error: anonInsertErr } = await anon.from("listings").insert({ listing_id: "RLS-TEST" });
  check(!!anonInsertErr, "anon cannot insert listings", anonInsertErr?.message ?? "insert succeeded");
  const { error: anonLogErr } = await anon.from("rewrite_log").insert({ prompt: {} });
  check(!!anonLogErr, "anon cannot insert rewrite_log", anonLogErr?.message ?? "insert succeeded");
  // Put a real row in rewrite_log with the service key so the anon read check is not vacuous.
  const { data: probe, error: probeErr } = await admin.from("rewrite_log")
    .insert({ listing_id: "RLS-TEST", model: "check", prompt: {} }).select("id").single();
  if (probeErr) throw new Error(`service role insert into rewrite_log failed: ${probeErr.message}`);
  const { data: anonLog, error: anonLogReadErr } = await anon.from("rewrite_log").select("id").eq("id", probe.id);
  check(!anonLogReadErr && anonLog.length === 0, "anon cannot read rewrite_log rows that exist");
  await admin.from("rewrite_log").delete().eq("id", probe.id);
  const anonBench = await benchmark(anon, clean);
  check(anonBench && anonBench.basis, "anon can call benchmark_listing");
  await admin.from("listings").delete().eq("listing_id", "RLS-TEST"); // tidy up if the insert check ever regresses

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("error:", e.message);
  process.exit(1);
});
