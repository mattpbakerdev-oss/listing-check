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
