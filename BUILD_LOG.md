# Build log

## 14 Oct 2026
Spec written, data generated, nothing built yet.

## 14 Oct 2026, later: step 1 done. Schema and sample data in Supabase, benchmark working.

**What was built**

- Supabase CLI linked to the hosted `listing-check` project. The schema now lives in `supabase/migrations/` and is applied with `supabase db push`, not pasted into the SQL editor.
- `npm run seed` upserts the three CSVs in foreign-key order and turns empty cells into NULL. Re-runnable. Its CSV handling is what the step 5 importer will reuse.
- `npm run check` is the acceptance test for this step: row counts, area medians against the published bands, the benchmark function on a clean, an overpriced, an underpriced and a typo-priced listing, the area fallback for a building with under 3 comparables, and the RLS rules exercised with the real anon key.
- Row-level security on all four tables. Anon can read areas, buildings, listings and the views. Anon cannot write anything. rewrite_log has no policy, so only the service role key reaches it.
- Buildings got an `aliases text[]` column for the step 2 case-insensitive match.

**Results from `npm run check`**

| Table | Rows |
|---|---|
| areas | 12 |
| buildings | 67 |
| listings | 400 |

Area medians from the generated listings all land inside their published band. Three sit noticeably below the "typical" figure (Ari 566 vs 620, Phra Khanong 455 vs 540, Silom 632 vs 700) because the generator applies an age discount and those areas drew more budget-tier buildings. Acceptable for sample data, worth remembering when reading benchmark output.

| Listing | Flaw | Basis | n | Median THB/sqm | Listing THB/sqm | Diff |
|---|---|---|---|---|---|---|
| L0001 | none | building | 8 | 848 | 962 | +13.4% |
| L0007 | overpriced | building | 8 | 535 | 806 | +50.6% |
| L0022 | underpriced | building | 8 | 389.5 | 264 | -32.2% |
| L0031 | typo_price | building | 5 | 590 | 6522 | +1005% |
| L0120 | none, building has <3 | area | 31 | 455 | 540 | +18.7% |

The benchmark was verified through the `benchmark_listing` function over the API, which is the same function the SQL editor would call.

**Things that went wrong or surprised me**

- The schema as written did not apply. `percentile_cont` returns double precision and Postgres has no `round(double precision, integer)`, so `benchmark_listing` failed to compile. Fixed by casting the medians to numeric in the two views. The migration runs in a transaction, so the first failed push left nothing behind.
- The spec had two internal inconsistencies, both fixed in SPEC.md: the mispriced threshold was 15% in section 3 but the bands in section 6 are 10 and 25, now 10 everywhere; and the building count was 60 in the spec, 62 in SOURCES.md and 67 in the CSV, now 67 everywhere.
- A clean studio (L0001, 26 sqm) benchmarks at +13.4%, which the app will label "above market". The generator gives small units a per-sqm premium and the median does not adjust for unit size. Expect some false "above market" flags on studios. Not fixing in v1; noting it for the metric write-up and the "next" list.
- The `supabase login` browser flow does not work from inside the Claude Code shell (no TTY). Logged in from a normal terminal instead.

**Decisions recorded** (answers to the step 1 questions, all now in SPEC.md): hosted Supabase only; "let" listings count as comparables and a listing is not excluded from its own benchmark; linear partial credit only for title length, description length and photo count; building match is case-insensitive on name or alias, no fuzzy match; the form accepts an optional Thai description.

**Next:** step 2, completeness scoring as a pure function with tests.

## 14 Oct 2026, benchmark rework: compare like with like

**Why.** The first benchmark compared a listing against every unit in its building. Small units rent dearer per sqm, so a correctly priced 26 sqm studio (L0001) came out 13% above a median dominated by 1- and 2-beds. The median ignored unit size.

**What changed.** New migration `20261014120000_benchmark_by_bedrooms.sql`. `benchmark_listing` now takes the bedroom count and picks the first basis with 3 or more comparables: same building and bedrooms, else same area and bedrooms, else the whole area. It returns which basis it used. Two new views back it: `building_bedroom_benchmark` and `area_bedroom_benchmark`.

**Result: it did not help, and on the sample it is worse.** L0001 now benchmarks against the three Phrom Phong studios and lands at +20.2%, not within 10%. The check script now reports population rates using the ground-truth flaws column, which is the honest measure. On the 251 clean and 51 mispriced sample listings:

| Rule | Clean listings wrongly flagged (>10%) | Clean flagged >25% ("check for a typo") | Mispriced caught (>10%) |
|---|---|---|---|
| Building, else area (min 3) | 41 (16%) | 1 | 50 of 51 |
| Building+bedrooms, else area+bedrooms, else area (min 3), **deployed** | 70 (28%) | 8 | 46 of 51 |
| Same, min 5 | 104 (41%) | 18 | 47 of 51 |
| Same, min 8 | 115 (46%) | 20 | 47 of 51 |
| Building+bedrooms, else area+tier+bedrooms, else area+tier, else area (min 3) | 36 (14%) | 0 | 49 of 51 |

Studios specifically: 11 of 34 clean studios were flagged before, 10 of 34 now. Unit size was not the main cause.

**What the numbers say.** Slicing by bedrooms with only 400 listings makes the comparable groups tiny (median n is 3 to 5), so the medians are noisy. Raising the minimum makes it worse, because more listings fall through to the whole-area median that mixes luxury and budget buildings. The thing that actually separates L0001 from its comparables is building tier: Aguston is luxury, the other two Phrom Phong studios are mid. Adding tier to the fallback chain gives the lowest false-flag rate of anything tried, with no clean listing pushed into the typo band.

**Decision for now.** The bedroom rule stays deployed as specified. The check script no longer asserts that L0001 is within 10%, because it is not; it asserts that at least 85% of mispriced listings are caught (46 of 51 today) and prints the false-flag rate. Recommendation: before step 3 wires the UI to the benchmark, switch to the tier-aware chain, since it beats both the original and the bedroom rule on every column. Caveat: `tier` is a hand-judged column in the sample data. Real listings would need it set per building, which the aliases workflow could absorb.

**How this was measured.** A scratch script computed all variants client-side from the listings table. The deployed rule's numbers were then confirmed through the real `benchmark_listing` function by `npm run check`.

## 14 Oct 2026, step 2 done: completeness scoring, pure function with tests

**What was built.** `lib/completeness/score.js` exports `scoreListing(draft, reference)` and returns the integer score, one entry per field with points earned, a status (ok, partial, missing, invalid) and a message the UI can show, plus the matched building, area and station. All thresholds, points, keyword patterns and matching live in `lib/completeness/rules.js`. No database, no UI. Tests were written first from the section 5 table: 102 cases, all passing with `npm test` (Node's built-in runner, no test dependency).

**Rulings made while turning the table into code**

- Title (10): 6 points for length, linear up to 20 characters, full to 80, then declining to zero at 160. 2 points for naming a known building, alias or area. 2 points for not being ALL CAPS. The spec said only length gets partial credit, so the other two are all or nothing, but splitting the 10 keeps an ALL CAPS title from scoring zero.
- Description (15): 10 for length, linear to 150 characters, plus 5 for mentioning at least two of floor, view, furnishing, station. This is the only split that reproduces the spec's example of a 120-character description scoring 8. Mentions are detected by keyword in English and Thai. Length is measured on the English description only; the optional Thai draft is not scored in v1.
- Building: exact match after lower-casing, trimming and collapsing spaces and hyphens, on the name or any alias. "The Met Sathorn" does not match "The Met". Area: same, on the id, the full name, or either half of a "Sathorn / Chong Nonsi" name.
- Numbers accept strings from a form, including "35,000". A non-numeric value is "invalid", not "missing".
- Furnishing accepts "Fully-Furnished" and odd spacing, but "furnished" alone is invalid.
- Photos: linear to 5. Zero photos reports as "missing".
- Nearest station: a typed value wins; otherwise it is filled from the matched building and the message says so.

**Sample data finding: the "before" number is not 55.** `node scripts/score-sample.mjs` scores all 400 sample listings as an agent would have typed them.

| Group | n | Mean score |
|---|---|---|
| All listings | 400 | 97.8 |
| No flaws | 251 | 100.0 |
| With flaws | 149 | 94.1 |

Scores by band: 286 listings at 100, 95 in the 90s, 18 in the 80s, 1 in the 70s. The worst flaw type (short description) still averages 86. The spec's primary metric assumes raw drafts average around 55 and targets 85 after the tool. On this sample the target is met before the tool runs, so the metric cannot show anything. The scorer is not being lenient: every listing the generator marks clean scores exactly 100, which is what the table says should happen.

The cause is the generator: 60% of listings are perfect, and the rest carry one or two flaws that each cost 5 to 15 points. Real agent drafts are not like that. Two ways forward, Matt's call: regenerate with a higher flaw rate and 2 to 4 flaws per flawed listing so raw drafts land near 55, or change the metric to measure only flawed listings and the points recovered. The first keeps the spec honest; the second is cheaper. Either way, step 6 needs this fixed before the write-up.

**Next:** step 3, the one screen. Decide the benchmark rule (tier-aware chain recommended) and the sample-data fix first.

## 14 Oct 2026, decisions: tier-aware benchmark, new primary metric, harder sample data

**Benchmark.** Matt's bedrooms-only chain was worse than the original on the sample: clean listings wrongly flagged rose from 16% to 28%, mispriced caught fell from 50 to 46 of 51. Switched to the tier-aware chain in migration `20261014150000_benchmark_by_tier.sql`: same building and bedrooms, else same area, tier and bedrooms, else same area and tier, else the whole area. Same function signature, so nothing upstream changed. Caveat recorded in SPEC section 6: the generator priced listings by tier, so tier is bound to look good on this sample. It needs re-checking on real data, where tier is a judgement per building.

**Measurement was flattering itself.** Benchmarking a sample listing that is already in the table makes it one of its own comparables. In a group of 3 it is a third of the median, so it looks correctly priced whatever its rent. Migration `20261014160000_benchmark_exclude_self.sql` adds an optional `p_exclude_listing_id` parameter (default null, the app passes nothing, so the v1 decision to not exclude self in the UI stands). The check script now measures with the listing excluded, which is what a new draft experiences. The difference is large:

| Tier chain, regenerated data (112 clean, 122 mispriced) | Clean wrongly flagged (>10%) | Mispriced caught (>10%) | Typo-priced in the >25% band |
|---|---|---|---|
| Self included (the old, flattering way) | 14% | 84% | 45 of 46 |
| Self excluded (honest) | 35% | 97% | 46 of 46 |

The honest row is the one to quote. The benchmark catches almost every mispriced listing and every price typo, and it wrongly questions about a third of correctly priced ones. That false-flag rate is mostly sample size: with 400 listings over 67 buildings and 3 tiers, many comparable groups have 3 to 5 members and their medians are noisy. The check script gates on the catch rates (85% and 90%) and reports the false-flag rate rather than gating it. The SQL numbers matched a client-side recomputation exactly, which is a decent check that the migration does what it says.

**Primary metric.** The 55-point "before" figure in the first spec was a guess that did not match the data: raw drafts averaged 98. Section 3 now reads "points recovered on flagged listings": among listings under 85 on first pass, mean score before and after the agent accepts every suggested fix, target 85 or above after.

**Sample data regenerated.** `generate_listings.py` now defaults to a 70% flaw rate with 1 to 3 flaws per flawed listing (was 40% with 1 or 2). Same seed, so the rows are reproducible. Reseeded with `npm run seed`. Raw scores from `node scripts/score-sample.mjs`:

| Group | n | Mean |
|---|---|---|
| All listings | 400 | 92.4 |
| No flaws | 112 | 100.0 |
| With flaws | 288 | 89.5 |
| Flagged, under 85 | 71 | 79.6 |

Distribution: 145 at 100, 130 in the 90s, 95 in the 80s, 30 in the 70s. So the metric's "before" number is 79.6 across 71 flagged listings. Even three flaws rarely drop a listing below 70, because most flaws cost 5 to 10 points and the generator never blanks the big-ticket fields (building, area, bedrooms) or the station. That is a fair model of a sloppy-but-not-empty draft. Points lost across the sample, largest first: description 610, size 520, photos 494, floor 384.

**Unit tests** still 102 of 102.

## 14 Oct 2026, step 3 done: the one screen

**What was built.** A Next.js 16 app at the repo root, one page. The server component loads areas and buildings with the anon key and hands them to a client component. Scoring runs in the browser with the pure function from step 2 on every keystroke. The benchmark calls `benchmark_listing` through the anon key, debounced 350 ms, ignoring stale responses, and only once there is a rent, a size and a known building or area. No AI rewrite yet.

**Design choices, kept plain as asked.** One typeface family, IBM Plex Sans with its Thai companion, because drafts are bilingual. White page, navy ink, and green, amber and red used only to mean ok, partial and wrong. The one element with any personality is the score bar: twelve segments, each as wide as the points its field is worth, filled by what the draft earned, so the bar itself shows where the points went. Each field also shows its own message underneath the input, and the results panel lists the fields to fix as links that jump to the input. On a phone it is one column with a fixed strip at the bottom showing the score and the price verdict; on a laptop the form is on the left and the results stay put on the right. Building, area and station inputs use datalists, which work as plain text boxes on phones. A "Load an example draft" button fills in a typical rushed listing for the demo.

**Benchmark wording** lives in `lib/benchmark/bands.js` with 19 tests: the three bands from section 6, and a sentence saying which comparables the median came from, such as "studios in luxury buildings in Phrom Phong". Fewer than 8 comparables adds "treat this as a rough guide".

**Verified.** `next build` compiles clean. `npm test` is 121 of 121. The server-rendered page contains the form, the banner, and all 67 buildings and 12 areas in the datalists, with no errors in the dev log. The browser extension was not connected in this session, so the interactive behaviour (typing, score updating, benchmark call) was not exercised in a real browser by me. Matt should click through once before trusting it.

**To run it locally:** `npm run dev`, then open http://localhost:3000. Needs `.env.local` with the Supabase URL and anon key.

**Next:** step 4, the AI rewrite edge function with guardrails and the log.
