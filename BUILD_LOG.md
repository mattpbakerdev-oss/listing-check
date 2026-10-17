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

## 14 Oct 2026, review of the screen on a laptop and a 375px phone

**What worked.** The example draft scored 81 with messages that said what to do. Fixing the floor and the caps title moved it from 81 to 91, exactly 8 + 2. "the met" matched The Met and filled in the station; "Met Sathorn" gave a clear unknown-building message. A rent of 5,000,000 was rejected with a sensible message. The price check explained its comparables in words with the sample size. On the phone: no horizontal scroll, every input 44px tall at 16px, no console errors.

**What went wrong, in Matt's words:** the first thing a user did was load the example, and the example made the tool look like it was shouting. We had checked that it computed, nobody had checked how the demo felt. The example draft was priced 42% above market, so the first thing on screen was "check for a typo".

**Fixes made**

1. The default example is now a fairly priced draft with obvious gaps (caps title, thin description, no floor, no bathrooms, three photos). It is a Rhythm Rangnam 1-bed at 28 sqm for 17,000, which sits on the median for mid-tier Ratchathewi. The overpriced one is a second button, "Load a mispriced draft".
2. No price check while the rent or the size is outside its range. The panel says "fix the rent first" instead of showing a 21,980% difference.
3. Minimum of 8 comparables for a verdict. Two ways to apply it were measured on the sample, self-excluded:

   | Where the 8 applies | Listings that get a verdict | Clean wrongly flagged | Mispriced caught | Mispriced with no verdict |
   |---|---|---|---|---|
   | UI only; chain still picks the first basis with 3 | 27% | 29% | 93% | 94 of 122 |
   | Chain picks the first basis with 8 | 100% | 31% | 96% | 0 |

   Suppressing in the UI alone would have hidden the verdict from three quarters of listings, including most of the mispriced ones, for no gain in accuracy. So migration `20261014180000_benchmark_min_8.sql` raises the chain's minimum to 8 and the UI shows "not enough similar listings to judge" with the area's published low-to-high band only when even the whole area has under 8. False-flag rate on listings that get a verdict, which is now all of them: 31%, against 35% before the change. Side effect: on 400 listings no building has 8 of the same bedroom count, so the building basis never fires on the sample. It will on real data.
4. Phone strip is one line, "81 · 4 to fix · price high", with ellipsis if it still overflows, and tapping it scrolls to the results. The Next dev badge moved to the top right so it stops covering the score.
5. A field that gains points shows "+8" next to its message for two seconds. Measured against the last settled state 700 ms after typing stops, so a title shows one "+6" rather than a flicker of "+0.3" per keystroke.
6. A filled-in Thai description says "Thai description added. It will be used for the rewrite."
7. The description message says what to add: "Too short. Mention the floor, the view, the furnishing or the nearest station", listing only the ones not yet mentioned. Three new tests pin the wording.

Tests: 129 of 129. `next build` clean. `npm run check` all pass with the minimum of 8.

**Follow-up, same day: softer price bands.** With the minimum of 8, 31% of fair prices were still being questioned, and the building basis never fires on the sample, so every demo listing is compared with its area and tier. Matt's third option: keep the minimum, soften the tone. Within 10% is "about right" in green. 10 to 25% is "a bit above/below similar listings" with no warning colour and a line saying a difference that size is worth a look, not an alarm. Only over 25% is red and says "check for a typo". The bar for shipping it was under 10% of fair prices in red. Measured self-excluded: 3 of 112 clean listings, 3%. Shipped, and the check script now gates on it.

## 14 Oct 2026, step 4 done: AI rewrite with guardrails and the log

**What was built.** A Supabase edge function, `rewrite`, deployed with `--use-api` so no Docker. It sends the agent's filled-in fields and the building record (name, area, station, walking minutes, year completed) as JSON to the model with a structured-output schema: English title and description, Thai title and description, and a `facts_used` list. The model key sits in Supabase secrets. After the response, `_shared/factcheck.ts` checks every number and every amenity or feature word in the four outputs against the input and the building record. Features are matched by concept with English and Thai synonyms, so a balcony in the Thai draft is allowed in the English rewrite. Anything not in the input comes back flagged per field. Every prompt and response is written to `rewrite_log` with the model, usage and the `facts_added` list, and the agent's accept click is recorded on the same row. 17 tests on the checker, 146 in total.

**In the UI.** A "Rewrite with AI" section below the form. For each of the four fields: the draft and the rewrite side by side, flagged words highlighted, an edit box prefilled with the rewrite, and an accept button. While a flagged word is still in the edit box the button stays off until the agent ticks "I have checked it is true". Nothing is applied until accept. An accepted Thai title appears in the form so the export in step 5 can carry it.

**Twenty sample listings through two models.** Ten clean and ten flawed, the same twenty for both, sent as the form would send them.

| | Claude Opus 5 | Claude Sonnet 5.5 |
|---|---|---|
| Rewrites that added a fact not in the input | 1 of 20 | 0 of 20 |
| Time per call, median | 9.2 s | 6.0 s |
| Time per call, mean and max | 9.4 s, 12.1 s | 6.3 s, 11.5 s |
| Tokens per call, mean | 1,156 in, 665 out | 1,158 in, 585 out |
| Cost per call | $0.022 | $0.008 |
| Cost for 20 | $0.45 | $0.16 |

Prices from the platform pricing page: Opus 5 at $5 in and $25 out per million tokens, Sonnet 5.5 at $2 and $10. Matt's first ask was "Sonnet 5.5"; that model name exists and the API accepted it, so that is what ran. **Sonnet 5.5 is now the default.** It was as clean, a third faster, and a third of the price.

**The one real addition, and the checker's own mistake.** At run time the checker flagged 5 of the 20 Opus rewrites. Four of those were the checker's fault: the drafts said "pool view" and the model wrote "looks out over the pool" or "วิวสระว่ายน้ำ", which the concept matcher treated as a new "pool" claim. The checker now treats a view of something as evidence the thing exists. Re-scoring the logged outputs with the fixed checker, without calling the model again, gives the 1 of 20 in the table. That one is genuine: listing L0011 has no furnishing level (its generated description says only "furnished") and Opus wrote "fully furnished" and "ตกแต่งครบ" in both languages. That is exactly the failure the spec expected, a plausible upgrade of a vague fact, and the guardrail caught it. Sonnet wrote "furnished" and left it there. The log rows keep the `facts_added` list from the checker that was live at the time, so the first Opus rows say 5; the re-scored number is the one to quote.

**Not caught by design.** Both models add "minimum one-year contract, two-month deposit" when the draft says so and leave it out when it does not. Neither invented a view, a distance or a walking time in 40 rewrites. The checker only knows the amenity words in its list; a novel invention outside the list would get through. The list is in one place and easy to extend as the log shows what models actually add.

**Things that went wrong.** The first model key was not scoped to a workspace and the API refused every call until Matt replaced it. The slowest Sonnet call (L0001 at 11.5 s) landed while the function was being redeployed with the checker fix; the median is the number to trust. The rewrite function is callable by anyone holding the anon key, at model cost; rate limiting is on the "next" list.

**Next:** step 5, export and CSV import.

## 14 Oct 2026, rate limit and two planted tests

**Rate limit.** The rewrite function now refuses before spending tokens: 20 rewrites per IP in any rolling hour, 300 in total in any rolling 24 hours, counted from `rewrite_log`, which gained a `client_ip` column (migration `20261014200000`). Over the limit the agent sees "You have used 20 rewrites in the last hour, which is the limit. Try again a bit later." or the daily equivalent. Rolling windows rather than calendar days because they need no clock-zone decisions and the counts are one query each. Moved off the "next" list in the spec.

**Two planted tests on the checker**, as asked. A rewrite containing "pool and gym, 3 minutes to BTS" for a draft that mentions none of those: all three flagged, in order. And "pool view" in the draft with "looks out over the pool" in the rewrite: nothing flagged, so the fix from the Opus run stays fixed. 150 tests.

## 14 Oct 2026, step 5 done: export and CSV import

**Export.** An Export section under the rewrite with three buttons: copy as text, copy as JSON, download JSON. The text is what an agent pastes into a portal: title, Thai title, a facts line ("1 bed · 1 bath · 45 sqm · floor 12 · fully furnished"), the building, area and station, the rent, then both descriptions. Empty things are left out rather than printed blank, and the score and benchmark are not in it, because it is the listing, not the report. The JSON carries the listings.csv columns with numbers as numbers and blanks as null, plus the score, the per-field results and the benchmark. Both are pure functions in `lib/export/format.js` with 9 tests.

**Import.** `/import` takes a CSV with the same columns as `data/listings.csv` and an import key. The route validates every row with `lib/import/validate.js` (16 tests): a row needs a listing_id, a known building_id or area_id (area filled from the building when blank), numbers that are numbers, a rent and size above zero, a date that is a date, and a status of active or let. Incomplete rows load; missing floor or photos are what the checker is for. Unknown extra columns are ignored. Each skipped row is reported with its CSV row number and a reason, and a bad row never stops the good ones. Rows with an existing listing_id replace it. Loading happens server-side with the service role key, which never reaches the browser. The import key is a shared secret, `IMPORT_KEY` on the server, so a public URL cannot be used to overwrite the table.

**Verified end to end** on the running dev server with a four-row file: one good row with a blank area and a rent written "35,000", one unknown building, one non-numeric size, one duplicate id. Wrong key: 401. Right key: loaded 1, skipped 3, each with the right reason and row number. The test row was then removed; the sample is back to 400 listings. `next build` clean, 175 tests.

**Next:** step 6, deploy to Vercel.

## 14 Oct 2026, step 6 done: live on Vercel

**Live at https://listing-check.vercel.app**

**How it was deployed.** Vercel CLI installed as a dev dependency (the global npm cache had a permissions fault, so it went in with a scratch cache). Matt logged in from a terminal; the browser login does not work from inside the Claude Code shell, same as Supabase's. `vercel link` to a project named listing-check, four production env vars added from `.env.local` by piping each value into `vercel env add` so nothing was typed or printed: the Supabase URL and anon key, the service role key for the import route, and the import key. The CLI refused the anon key at first because it looks like a secret; it went in as a plain config value, which is what a NEXT_PUBLIC_ key is. Then `vercel --prod`.

**Verified on the live URL.** The page serves the form, the banner, all 67 buildings and 12 areas in the datalists, and the price check, rewrite and export sections. `/import` serves. The import route returns 401 for a wrong key and, with the right key, loaded 1 of a 4-row test file and skipped 3 with the right row numbers and reasons; the test row was then removed. The rewrite edge function answers a call carrying the live site's origin with Sonnet 5.5 and no added facts. Tests 175 of 175, build clean.

**Two things the housekeeping turned up.** `vercel link` appends `.vercel` and `.env*` to `.gitignore`; the second pattern would have covered the tracked `.env.example`, so it came out again. And deployment-specific URLs (listing-check-xxxx-mattpdev.vercel.app) sit behind Vercel's deployment protection and redirect to a login; the production alias is the one to share.

## 14 Oct 2026, polish pass before the walkthrough

**1. Clear did not clear the rewrite.** The rewrite panel kept its own React state, so Clear reset the form and left the old rewrite and its edits on screen. The review state now lives in `lib/rewrite/state.js`, a pure reducer with 18 tests covering reset, loading, the accept rules, accept-all-unflagged, close-keeps-state and done-applies. The checker keys the panel on a counter that Clear and both example buttons bump, so the panel remounts empty. Committed as "Polish 1".

**2. The rewrite has its own review screen.** When a rewrite comes back, an overlay opens: a sheet sliding up on phones, a centred panel on wider screens, titled "Review the rewrite". One card per field with the draft and the rewrite side by side (stacked on phones), flagged words highlighted, an edit box and Accept. An accepted card collapses to a tick and "Accepted"; the header counts "2 of 4 accepted". At the bottom, "Accept all unflagged" takes every card without a flagged word, and "Done" closes and applies the accepted ones to the form. Escape, the Close button and the backdrop close it without losing anything. Focus moves to the heading on open, Tab stays inside, and focus returns to the rewrite button on close. Nothing reaches the form until Done. The section under the form keeps a one-line summary and a "Review the rewrite" button to reopen. Committed as "Polish 2".

**3. Prompt and copy.** (a) With both Thai fields empty the button reads "Rewrite with AI and add a Thai version". (b) The rent is no longer sent to the model at all, and the prompt says why; the completion year is sent only when the building is 5 years old or newer, and the fact checker is given the same trimmed record, so a rent or an old year in the output is flagged like any other addition. Verified with the example draft: Rhythm Rangnam (2018) came back with no rent and no year. (c) The "+8" flash at 375px: I could not reproduce it from the code, and I have no phone in this session. The likeliest cause is the keyboard: the flash sits in the line under the input, which iOS scrolls just out of view when the keyboard is up. So the same gain now also flashes next to the score in the bottom strip, which is always on screen, and both last 3 seconds instead of 2.2. If it still does not show on Matt's phone, that is a finding for the log, not a fix.

**4. Visual pass.** Goal: a tool a brokerage would hand its agents, not a landing page. Screenshots in `docs/screenshots/`, taken with Playwright against the dev server at 1280px and 375px, light and dark, with the example draft loaded. No console errors, no horizontal scroll at 375px.

What changed:
- One accent, a deep teal, on every button, link and focus ring. One neutral scale (paper, well, rule, ink, muted). Three status tones, green, amber and red, shared by the score ring, the per-field bar, the price verdict, the field borders and the accept ticks. Dark mode swaps the same tokens under `prefers-color-scheme: dark`; it cost twelve lines.
- A real header: "Listing Check", one line on what it does, and the sample-data line restyled as a quiet notice with a thin left rule instead of a banner.
- The form is three `fieldset`s with light dividers and small grey legends: The listing (title, descriptions), The unit (building, area, size, floor, beds, baths, furnishing, station), Price and photos (rent, photos).
- The score is the hero of the results: a 112px ring that fills by score, red under 60, amber 60 to 84, green from 85, with the number inside and a word beside it ("Needs work", "Nearly there", "Ready to publish") and "5 fields to fix". The twelve-segment bar sits under it.
- Spacing on a 0.25rem grid, 16px body text, every input and button at least 44px tall. No new animation beyond the overlay and the points flash; no imagery, no gradients.

What went wrong: the first screenshot showed the phone score strip on the desktop too. The rewritten stylesheet declared the strip after the media query that hides it, so the later rule won. Moved the hide rule to the end. The "N" badge top right in the screenshots is the Next.js dev indicator and is not in production.

**5. The metric.** `npm run metric` (scripts/metric.mjs) takes every sample listing scoring under 85, applies the fixes an agent would accept, and re-scores. Structured gaps get a sensible value: floor 10, bathrooms 1, furnishing "fully furnished", photos 8, and size from the median of same-bedroom listings in the same building, else the same area. Then the title and description take the AI rewrite, generated from the draft after those fixes so the model can mention the floor it now has. Logged rewrites are reused only when the logged draft matches the fixed draft.

| | |
|---|---|
| Sample listings | 400 |
| Flagged, under 85 on first pass | 71 |
| Mean before | 79.6 |
| Mean after accepting every fix | 98.0 |
| Reach 85 or more | 71 of 71 |
| Rewrite calls | 71 (55 fresh, 16 reused from the log), $0.68 |
| Fresh rewrites that added a fact not in the input | 0 of 55 |

Two notes on what the number means. First, the structured fixes do most of the work: a run where the rewrite failed for 55 of the 71 (see below) still reached a mean of 92.9 and 69 of 71 over 85 on the structured fixes alone. The rewrite is what takes the thin descriptions from 4 out of 15 to 15, and the caps titles to 10. Second, the simulation never touches the rent, because "a sensible value" for a rent is a judgement the agent makes with the price check in front of them. The two listings whose rent is a typo (L0161, L0195) keep that fault and pass on everything else.

What went wrong, in order. The first metric run hit the rewrite rate limit after 16 fresh calls: the service-role bypass compared the Authorization header with the key from the function's environment and they did not match in the edge runtime. Replaced with a check of the role claim in the already-verified JWT, which is the right way round anyway. Confirmed anon still gets a 429 while this IP is over its hour while the service role gets a 200. The second run reused the 16 logged rewrites by comparing the logged draft with the fixed draft, so they were not paid for twice.

**Rate limit raised, and a side effect found.** Per-IP limit is now 60 an hour because an office shares one IP; the daily cap stays at 300. Verifying it turned up a flaw: service-role calls skipped the limit but were still logged with the IP they ran from, so the 55 metric-run calls had pushed this IP over 60 and the browser was refused. Service-role rows are now logged with `client_ip = "service_role"`, and the last hour's metric rows were re-attributed the same way so the count reflects browser calls only.

**README** added with the live link, the two screenshots, the metric table and a two-line how-to-run.

## 15 Oct 2026, three usability additions

**Autosave.** The form is written to localStorage 800 ms after it stops changing, and "Draft saved · 2 minutes ago" sits under the action buttons with a clock that ticks every 30 s. On load, if a saved draft exists and the form is empty, a one-line bar offers "You have an unfinished draft from 20 minutes ago" with Restore and Discard. Clear and both example buttons forget the saved draft. The rules are a pure reducer in `lib/drafts/autosave.js` (23 tests: offer only when stored and empty, restore, discard, a save while the offer is open withdraws it, versioned serialize and parse that drops anything that is not a string or number). Storage access is wrapped in try/catch so a private window or a full quota cannot break the page. Checked in a real browser at 375px: save, reload, restore, clear, discard. One detail: restoring does not rewrite the draft as "saved just now"; the stored one is already there.

**Sticky header.** The header is sticky and, once the page has scrolled past the intro, compresses to one line: product name on the left, a 40px score ring with "4 to fix · price ok" on the right. Tapping the score scrolls to the results. Hysteresis on the scroll threshold (compact above 96px, back below 24px) because the header shrinking shifts the page and would otherwise flip it straight back. The phone strip at the bottom is gone, and the "+N" points flash moved into the header ring. `scroll-padding-top` and `scroll-margin-top` keep a focused field's label from sliding under the header. Measured at 375px with Playwright: header 235px at the top, 58px compact; the title and floor labels sit clear of the header when focused; no horizontal scroll; no console errors. What went wrong: Playwright's `tap` kept failing with "element not visible" even though the link had a 194 by 44 box. Its pre-tap scrollIntoView was yanking the page to the top, which un-compacts the header and hides the link, so the check clicks at the measured coordinates instead, which is what a thumb does anyway. The first scroll-to-results also landed 46px short because `scrollIntoView` ignored the margin in the mobile emulation; it now computes the offset from the compact header height.

**Building card.** When a building matches, a compact card sits above the price check: the building name, the nearest station with a coloured dot for its line (BTS Sukhumvit light green, BTS Silom dark green, MRT Blue), walking minutes, year completed with the age, tier, and "7 listings in our data". Everything comes from the buildings table plus a count over listings done on the server and cached with the page; no external requests. The station-to-line table is `lib/stations.js` with tests for every station in the data and a prefix fallback for new ones. Hidden when no building matches.

A map preview was considered for this spot and not built. A map needs tiles from an outside service, which means an API key, a cost, a third-party request on every page view, and a privacy note; the buildings table has no coordinates, so each of the 67 would need geocoding first; and an agent already knows where the building is. What they are about to be asked by a tenant is how far the station is, which line, how old the building is, and whether the price is right, and the card answers those from data we hold.

## 15 Oct 2026, finishing pass

A marketing-site checklist was reviewed and most of it skipped, because this is an internal tool for agents, not a public page: no analytics, no SEO keywords or sitemap, no share buttons, no newsletter or testimonials, no cookie banner (there are no cookies), no pricing page. Taken, because they help the one thing a demo link is used for, being pasted into a chat and opened on a phone:

- Page title "Listing Check", a one-sentence description, and Open Graph and Twitter card tags with the desktop screenshot resized to 1200px as the image, so a pasted link shows a preview. `metadataBase` set so the image URL is absolute.
- A favicon: a white tick in a teal circle, SVG at `app/icon.svg` with a 32px PNG fallback rendered from it with Playwright.
- A 404 page in the same style with a link back to the checker.
- Loading states confirmed: the price check shows "Comparing with the market…" during the call, and the importer's button reads "Loading…" and is disabled; the importer gained a status line too, since a few hundred rows take a few seconds.
- A one-line footer: demo credit, a note on data, and the GitHub link.
- `robots.txt` disallowing everything, plus a `noindex` meta tag, since robots.txt alone does not keep an already-linked page out of search.

One wording note for Matt. The footer says "nothing personal is stored". Two things are stored: the draft, in the agent's own browser (localStorage, never sent anywhere until they press a button), and in `rewrite_log` on the server, the listing text sent for rewriting plus the caller's IP address for the rate limit. Listing text is about a flat, not a person, but an IP address is personal data under most definitions. The line stands as asked; it may want to read "nothing about you is stored" or mention the IP, and the rate-limit IP could be hashed. Neither change was made without a decision.

Verified on the live site after deploy: the Open Graph tags and image URL in the page head, the image returning 200 at 1200 by 843, `/robots.txt`, both icons, and a made-up URL returning the 404 page. No OG debugger was used; the tags were read directly from the served HTML, which is what a chat app reads.

## 15 Oct 2026, the footer made a claim the code did not back up

The footer said "nothing personal is stored". The rate limiter was storing each caller's IP address in `rewrite_log`. The fix was to change the code first and the wording second.

**Code.** The limiter now identifies a caller by a SHA-256 hash of the IP with a server-side salt (`RATE_LIMIT_SALT`, a random 32-byte secret set in Supabase, never in the repo). It compares hashes, never addresses, and refuses to run if the salt is missing rather than fall back to the raw IP. The column was renamed from `client_ip` to `client_key` so nothing can mistake it for an address, and the migration nulls every raw IP that earlier rows held. Script runs keep the `service_role` marker. The hashing lives in `_shared/ratelimit.ts` with 8 tests: deterministic, 64 hex characters, no trace of the address, a different salt gives a different hash, an empty salt is refused. A search of the repo for the old column name and the forwarded-for header finds only the historical migration, the one line in the function that feeds the hash, and these log entries.

**Wording.** The footer now reads: "Demo by Matt Baker. Runs on sample data. Drafts stay in your browser; rewrite requests are logged without anything that identifies you. Source on GitHub." Every clause is true of the code: drafts are in localStorage, and the log holds the listing text, the model's answer and a salted hash.

**Verified live** after deploy: a browser-style call succeeds, the new row's `client_key` is 64 hex characters, and no row in the table holds anything shaped like an address.

## 15 Oct 2026, closing entry

v1 is live at https://listing-check.vercel.app and every step of the build order is done except the 60-second walkthrough. The primary metric is measured, not estimated: see the metric table in the polish pass above (`npm run metric`, 14 Oct 2026), where the 71 flagged sample listings go from a mean of 79.6 to 98.0 after every suggested fix, and all 71 reach 85. SPEC.md section 3 carries the same figures.

## 15 Oct 2026, visual refinement: canvas, cards, markers

Brief: a well-made internal tool, not a white form and not a landing page. Restraint over decoration. Before and after, taken with Playwright against the dev server with the example draft loaded:

| | Before | After |
|---|---|---|
| Desktop 1280, light | [before-desktop-light.png](docs/screenshots/before-desktop-light.png) | [after-desktop-light.png](docs/screenshots/after-desktop-light.png) |
| Desktop 1280, dark | [before-desktop-dark.png](docs/screenshots/before-desktop-dark.png) | [after-desktop-dark.png](docs/screenshots/after-desktop-dark.png) |
| 375px, light | [before-mobile-375.png](docs/screenshots/before-mobile-375.png) | [after-mobile-375.png](docs/screenshots/after-mobile-375.png) |
| 375px, dark | [before-mobile-375-dark.png](docs/screenshots/before-mobile-375-dark.png) | [after-mobile-375-dark.png](docs/screenshots/after-mobile-375-dark.png) |

**What changed**, all in `app/globals.css` plus class names in the components.

1. **Canvas and cards.** The page is off-white (`#f6f7f5`; `#0f1215` in dark). The three form sections, the score panel, the building card, the price check, the AI rewrite and the export each sit in a card: white, 1px hairline, one shadow layer at 5% opacity with a 2px blur, 8px radius. Padding is 20px on phones and 24px from 900px, through one `--card-pad` token. Cards are 16px apart, in both columns and between the two layout blocks. The import form and the 404 message are cards too, so the other pages match.
2. **Section markers.** Each fieldset's legend now starts with "01 · The listing", "02 · The unit", "03 · Price and photos": system mono, 12px, 0.08em tracking, teal, aria-hidden so a screen reader hears the heading once. The heading under it is 17px semibold ink (16px on phones). The fieldset top rules and the rules above the rewrite and export sections are gone; the cards separate things now. The footer's top rule went too.
3. **Results panel.** The score card and the price check card carry a teal tint, 4% over white (`#f5f9fa`; `#1a2227` in dark), so the right column reads as the tool's voice and the form as the agent's input. The building card between them stays white, because it is a fact sheet rather than a verdict. The ring grew from 112 to 120px and its number from 32 to 40px; the band word beside it keeps the band colour; the segment bar sits 12px under the ring instead of 14. The fields-to-fix rows are white on the tint with a hairline and their status rule on the left.
4. **Accent discipline.** Teal is now on the product name in the header, primary buttons, focus rings, section markers and links, and nothing else. The secondary buttons (mispriced draft, Clear, Copy as JSON, Download JSON, Discard, Close, Accept all unflagged) are a neutral outline: ink text, white, a slightly stronger hairline. The restore bar's left rule went from teal to ink. Counted on the live DOM in the first 1280 by 900 viewport with the example loaded: five teal elements at rest (name, import link, primary button, two markers), six with a field focused. The whole page has ten, because the rewrite button, the Copy as text button, the third marker and two more links are below the fold.
5. **Type.** IBM Plex Sans and its Thai companion, unchanged. Heading line height 1.2 to 1.15. On phones h1 drops from 24 to 20px and h2 from 17 to 16px. Body stays 16px. Labels are 14px medium in a neutral dark grey (`#3a4350`) rather than ink.
6. **States.** Inputs rest on a neutral border a step darker than the hairline so they read as fields on a white card. Focus is a teal border with a 3px teal ring at 22% in place of the outline. Amber and red borders appear only when the field has a message, as before, and focus wins over them while the agent is typing. Every input and button is still 44px tall.

**Dark mode** swaps the same tokens: deep neutral canvas, slightly lighter cards, the tint mixed from the dark accent, a darker shadow that is just visible on the card edge. Checked in the two dark screenshots above and in the compact header.

**Not added:** gradients, icons, illustrations, extra webfonts (the marker uses the system mono stack), animation beyond the existing overlay and points flash, heavy shadows, large radii.

**Verified.** 229 tests, `next build` clean, no console errors in any of the eight screenshots, no horizontal scroll at 375px, compact header 58px. The Open Graph image was re-rendered from the new page at 1200 by 843. The README screenshots point at the after set and the three older screenshot files are removed.

**What went wrong.** The first OG render came out at 2400 by 1686 because the screenshot context was at 2x for the documentation shots while the metadata declares 1200 by 843; re-rendered at 1x. And the example draft scores 70 in these screenshots where the 14 Oct review entry says 81. Checked against git: the example and the scoring rules are unchanged since that commit, and the example scored 70 then too. The 81 was the earlier, overpriced example that the review replaced; the entry recorded the number before the swap. Nothing to change in the code.

## 15 Oct 2026, the visual pass was reported done while the live site still showed the old build

Matt opened listing-check.vercel.app and saw the white page with no cards and no markers. Checked before changing anything:

- Local main was two commits ahead of origin/main (the spec and log tidy, and the visual pass). Neither had been pushed. The work was committed and reported as done, and nothing in the report said it was unpushed and undeployed.
- The production alias pointed at a deployment Matt had made from his terminal with `vercel --prod` at 22:16, from the working tree at the previous commit. Its build log shows a file upload, not a git clone.
- The served HTML had plain fieldsets and the old colour tokens, so the site was faithfully showing the last thing deployed.

Fixed by pushing main and running `vercel --prod`. Verified on the live HTML: the three section markers, seven card elements, and the canvas and tint tokens in the served stylesheet.

**What was wrong in my own reasoning.** I told Matt the project deploys only from the CLI, because `vercel project inspect` lists no git connection and every recent build log began with a file upload. Both facts were true and the conclusion was false. The GitHub repo was already connected: the push produced a git-cloned production deployment of dcc3fcc eight seconds before the CLI one, and the earlier pairs of deployments were the same thing, Matt's push and his `vercel --prod` landing together. `vercel git connect` confirmed the link. From here on a push to main is enough, and the CLI step is redundant rather than required.

**Rule for the log.** "Done" means committed, pushed and, for anything visible, verified on the live URL. A report that stops at the commit should say so in the first line.

## 15 Oct 2026, stepper, Next buttons, help toggles, and the shapes made to agree

Matt brought two sign-up forms he liked, both wizards with a progress rail, and said the page felt "weirdly different and boring" in its shapes and colours. Decision: a progress rail over the existing one-page form, not a wizard. The live score beside the form is the product; paging the form would hide it behind three clicks. Screenshots, example loaded: [steps-desktop-light.png](docs/screenshots/steps-desktop-light.png), [steps-desktop-dark.png](docs/screenshots/steps-desktop-dark.png), [steps-mobile-375.png](docs/screenshots/steps-mobile-375.png), [steps-mobile-375-dark.png](docs/screenshots/steps-mobile-375-dark.png). The before set is the previous pass's after set.

**What was built**

- **Stepper.** Five steps under the header: Listing, Unit, Price & photos, Rewrite, Export. The rules are a pure function in `lib/steps.js` with 7 tests: steps 1 to 3 are done when every field in that card scores ok, step 4 when a rewrite has been applied, step 5 when the listing has been copied or downloaded, and the current step is the first one not done. A later step can be done before an earlier one. Done is a green tick, current a filled teal circle, to do a grey outline; the connector turns green after a done step. Tapping a step scrolls its card under the header and focuses the first field. On phones the labels go and a line under the dots says "Step 2 of 5 · The unit". The compact header shows the same five as 8px dots beside the score ring, hidden under 480px where the row has no room.
- **Next buttons.** A neutral "Next: The unit", "Next: Price and photos", "Next: AI rewrite" at the foot of each form card, on a hairline, right-aligned, as in the DNB form. Same scroll-and-focus as a step tap.
- **Help toggles.** A "?" beside Nearest station and Monthly rent, 28px drawn with a 44px tap area, that shows a line of help under the input. `aria-expanded` and `aria-controls` wired.
- **Empty state.** An empty form used to open on a red "Needs work", 0 of 100, and twelve grey "missing" rows. It now says "Nothing to check yet. Start with the title, or load an example draft." in grey, with no rows. The messages under each input still say what is missing.
- **Shapes.** One radius token, 8px, on cards, inputs, buttons and rows; inputs and buttons were 6px. The flat-left-edge boxes with a stripe (restore bar, fix-this rows, rewrite warning) are rounded on all corners now. The restore bar lost its black stripe and sits on the teal tint instead.

**Scrolling under a header that changes height.** A step tap computes the target with the header's current height, which is right from either state because the header shrinks by exactly (full minus compact) once the page has scrolled. Scroll anchoring is switched off for the programmatic scroll and the position is checked for four frames after it ends. Measured with Playwright: step and Next targets land 69px under the 58px compact header in both motion modes, with the right field focused.

**What went wrong.** An hour on a scroll that landed 146px low. I built a theory about scroll anchoring, instrumented every scroll call, and the trace showed the page simply ran out: step 3's card sits so far down that the page's maximum scroll is 1207px and the card cannot reach the top. The reachable targets had been landing correctly all along. The anchoring handling stays because the trace did show anchoring pulling the position back by the header's shrink; it is a second-order effect, not the cause.

**Verified.** 236 tests, `next build` clean, no console errors in eight screenshots, no horizontal scroll at 375px, download marks step 5 done, the help toggle shows its text, export and stepper states reset with Clear and the example buttons.

## 16 Oct 2026, preview as a listing

Matt brought three screenshots of a listing page on a Bangkok rental portal and asked for a preview button that shows the draft the way a portal would, so agents can see what they are about to publish. Screenshots with the example draft: [preview-desktop-light.png](docs/screenshots/preview-desktop-light.png), [preview-desktop-dark.png](docs/screenshots/preview-desktop-dark.png), [preview-mobile-375.png](docs/screenshots/preview-mobile-375.png).

**What was built.** "Preview as a listing" in the score card and beside the export buttons opens an overlay laid out in a portal's idiom: a big bold title, the location line, the rent as "฿17,000/month", badges, a photo grid, a facts strip, "About this listing" with the Thai description under it, a details table, and a greyed enquiry box on the right so the page reads as a page. It is a sample layout with no portal's name or logo on it. Two of the badges are ours and a portal would not have them: "Fairly priced", "A bit above market" or "Well above market" from the price check, and "Complete listing" at 85 or more.

**Gaps stay in their slots.** Every missing or invalid field renders as a dashed amber chip where its value would be: "Floor missing" in the facts strip and again in the details table, "No photos" across the photo area, "Rent missing" where the price goes. A "Show gaps" toggle, on by default, turns them off for the pure tenant's view; the count in its label is fields, so the example draft says 2 while three chips show, because floor appears twice. The photo grid draws one tile per photo up to five, so three photos leave a visible hole where the portal's fourth and fifth would be, which the number 3 in a form never conveyed.

**Code.** `lib/preview/model.js` turns draft, score fields, matched building, area and price verdict into the view model: portal wording ("Studio", "2 bathrooms", "6th floor", "฿607/sqm", "3 min walk to BTS Victory Monument"), the badges, the details rows and the list of gaps. 10 tests. The focus trap, Escape, scroll lock and focus return that the rewrite review overlay had inline are now `app/use-dialog.js`, shared by both overlays. Focus returns to whichever of the two buttons opened the preview.

**Verified.** 246 tests, `next build` clean. Playwright: the preview buttons are absent or disabled on an empty draft; opening focuses the heading; the example shows the two gaps in three slots; the toggle removes them and the facts strip drops to five entries; Escape and the Close button both close and return focus to their opener; no console or page errors; no overflow in the 375px sheet; dark mode holds.

**Not done.** No map, since the building table has no coordinates, and no real photos, since the form only has a count. If photos ever come in, the grid is the place they go.

## 17 Oct 2026, agent feedback, and phone tabs

A Bangkok agent reviewed the live app. Liked: the bilingual rewrite, the export options with the preview, and the price check with the score. Asked for: less scrolling on phones ("tabs or step-by-step"), a minimum-photos recommendation, standard lease terms the AI can include, station proximity and tier in the pricing, and Do Not Disturb when recording demos.

Read against the product: the five-photo rule already exists and the agent did not see it, which is a finding; tier is already in the benchmark chain; lease terms must come from the agent, not the model, because the guardrail forbids added facts; station proximity is an experiment to measure, not a given, since every extra slice thins the comparables. The plan, in order: phone tabs, lease terms as confirmed facts, the photo rule visible before typing, a measured station-proximity trial, then the walkthrough. Lease terms will not be scored, so the 100-point table and the metric stay as published.

**Phone tabs, done.** Under 900px the page is four tabs with a fixed bar at the bottom: Draft (the stepper, the buttons and the three form cards), Check (score, building card, price check), Rewrite and Export. The Check tab carries a count of fields to fix. Sections are hidden with CSS, not unmounted, so the draft and a rewrite in progress survive a switch; desktop is unchanged and shows no bar. Which tab holds a target is `lib/tabs.js`, 4 tests. A step tap, a Next button, the header ring and the "Rewrite with AI" link now switch tab first and scroll once the target is on screen, through a pending-scroll effect, so the same code serves both layouts. Screenshots: [tabs-mobile-draft.png](docs/screenshots/tabs-mobile-draft.png), [tabs-mobile-check.png](docs/screenshots/tabs-mobile-check.png), [tabs-mobile-check-dark.png](docs/screenshots/tabs-mobile-check-dark.png).

**Verified** with Playwright at 375px: Draft by default with results hidden; Check shows the results and hides the form; a step 4 tap lands in Rewrite; a step 2 tap stays in Draft and puts the unit card 70px under the compact header with Building focused; "Next: AI rewrite" lands in Rewrite; the header ring lands in Check; the title survives a round trip through Export; no horizontal scroll; no console errors. Desktop: no bar, all four sections visible, step tap unchanged. 250 tests, `next build` clean.

**Two design notes.** The stepper stays only on the Draft tab, since it is about the draft; the tab bar does the navigating elsewhere. The tap highlight is hover-guarded so a touched tab does not keep a grey wash.

## 17 Oct 2026, lease terms as confirmed facts, and the photo rule in the label

**Lease terms.** Three optional fields under Price and photos: contract months, deposit months, advance rent months, with a "Use the usual terms" button that fills 12, 2 and 1. Not scored: the example still reads 70 with them set, and the 100-point table and the metric are untouched. Once set they are facts in the agent's draft, so the guardrail stays intact: the prompt now says to state them once in both languages when present, the fact checker's number whitelist includes them, the export text gets a line ("12-month contract · 2 months deposit · 1 month advance", only the parts set), the JSON carries the three as integers or null, and the preview's details table shows them as Contract, Deposit and Advance rent rows. An absent term is not a gap. Screenshot: [terms-card.png](docs/screenshots/terms-card.png). 7 new tests across the export formatter, the preview model and the fact checker; 257 in total.

**Edge function redeployed** as version 18 with `supabase functions deploy rewrite --use-api`. One live call with the example draft plus the usual terms, through the anon key as the browser would: Sonnet 5.5 in 8.4 s, English "Terms: 12-month contract, 2 months deposit, 1 month advance", Thai "สัญญา 12 เดือน เงินประกัน 2 เดือน ชำระล่วงหน้า 1 เดือน", `facts_added` empty. Without the fields the same 12 is flagged, which a test now pins.

**Photo rule.** The agent who reviewed the app asked for a five-photo recommendation that already existed as a rule. The label now reads "Number of photos (5 or more)", so it is visible before anything is typed, not only in the message after.

Items 2 and 3 of the plan from the agent feedback. Next: the station-proximity benchmark trial, measured before anything ships.

## 17 Oct 2026, station-proximity benchmark trial: measured, not shipped

The agent asked for pricing that accounts for distance to BTS and MRT. Before touching the chain, `scripts/benchmark-variants.mjs` computed every candidate client-side from the listings and buildings tables, self-excluded, minimum 8, the same way the tier chain was chosen. Walking minutes come from the building table (1 to 21, median 7); "near" is 7 minutes or under.

| Chain | Clean wrongly flagged (>10%) | Clean in red (>25%) | Mispriced caught | Typo-priced in red |
|---|---|---|---|---|
| Current: building+bed, area+tier+bed, area+tier, area | 35/112 (31%) | 4/112 (4%) | 117/122 (96%) | 46/46 |
| Walk band inside tier (near/far) | 33/112 (29%) | 5/112 (4%) | 116/122 (95%) | 46/46 |
| Walk band inside tier (near/mid/far) | 35/112 (31%) | 4/112 (4%) | 117/122 (96%) | 46/46 |
| Walk band instead of tier | 54/112 (48%) | 12/112 (11%) | 118/122 (97%) | 46/46 |
| Same station + tier, then area + tier | 36/112 (32%) | 4/112 (4%) | 117/122 (96%) | 46/46 |

**Reading.** The best walk variant moves two clean listings out of the flagged set and one mispriced listing into the missed set. That is noise, not a gain. Dropping tier for distance is clearly worse. And the reason is in the generator: the sample price is area typical, times tier, times an age discount, times a unit-size effect, times noise. Walking time is not in it. Among clean listings in area-and-tier groups of 8 or more, the near and far halves sit at 1.009 and 0.985 of their group median, on 7 and 10 listings. The sample cannot show a proximity effect because it was built without one.

**Decision.** The chain stays as it is. The price check now ends with a line the agent can weigh: "Comparables are not filtered by distance to a station. Rhythm Rangnam is a 3 minute walk from BTS Victory Monument." (`proximityNote` in `lib/benchmark/bands.js`, 3 tests; 260 in total.) On real listings, where distance does move rent, the trial script is the way to re-run this: point it at the imported data and read the same table.

**Walkthrough.** The one open item from the build order is Matt's to record. `docs/walkthrough.md` is the 60-second script, with Do Not Disturb as the first step, as the agent advised.

That closes the plan from the agent feedback: phone tabs, lease terms, the photo rule in the label, the proximity trial, and the walkthrough script. Nothing in the 100-point table or the metric changed.
