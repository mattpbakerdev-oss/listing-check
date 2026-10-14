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

async function benchmark(client, l) {
  const { data, error } = await client.rpc("benchmark_listing", {
    p_building_id: l.building_id, p_area_id: l.area_id, p_rent: l.monthly_rent_thb, p_size: l.size_sqm,
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
  const [bc, bo, bu, bt] = await Promise.all([clean, over, under, typo].map((l) => benchmark(admin, l)));
  const fmt = (l, b) => `${l.listing_id} ${l.building_id} rent ${l.monthly_rent_thb} / ${l.size_sqm} sqm -> ${b.basis} n=${b.n} median ${b.median_rent_per_sqm} listing ${b.listing_rent_per_sqm} diff ${b.pct_diff}%`;
  check(Math.abs(Number(bc.pct_diff)) <= 25, "clean listing is not flagged as well off market", fmt(clean, bc));
  check(Number(bo.pct_diff) > 10, "overpriced listing is above market", fmt(over, bo));
  check(Number(bu.pct_diff) < -10, "underpriced listing is below market", fmt(under, bu));
  check(Math.abs(Number(bt.pct_diff)) > 25, "typo-priced listing is well off market", fmt(typo, bt));

  // 5. Building fallback: a building with fewer than 3 comparables benchmarks against its area.
  const { data: bb } = await admin.from("building_benchmark").select("*");
  const small = bb.find((r) => r.n < 3);
  if (small) {
    const { data: l } = await admin.from("listings").select("*").eq("building_id", small.building_id).not("size_sqm", "is", null).limit(1);
    const b = await benchmark(admin, l[0]);
    check(b.basis === "area", "building with <3 listings falls back to area", fmt(l[0], b));
  } else {
    console.log("note  every building has 3+ priced listings, fallback branch not exercised by sample data");
  }

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
