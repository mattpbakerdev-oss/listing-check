# Listing Check: spec v1

**Owner:** Matt Baker
**Date:** 14 October 2026
**Status:** Draft, pre-build

## 1. Problem

Property agents in Bangkok write rental listings quickly, often in two languages, and many go live incomplete or mispriced. Incomplete listings get fewer enquiries and more back-and-forth questions. Nobody checks a listing before it's published because checking is slow and boring.

## 2. Who it's for

A listing agent at a Bangkok brokerage, on a phone or laptop, with a draft listing in front of them and two minutes to spare before they publish.

Not for: tenants, landlords, admin staff. One user type only.

## 3. What success looks like

**Primary metric:** points recovered on flagged listings. Among listings that score under 85 on the first pass, the mean score before, and the mean score after the agent accepts every suggested fix. Target: flagged listings reach 85 or above on average after fixes. Measured on the sample set in the demo.

(The first draft of this metric assumed raw drafts averaged around 55. That was a guess, and the first sample data averaged 98. See the build log, 14 Oct 2026.)

**Secondary metric:** share of listings flagged as mispriced (more than 10% above or below the benchmark, the edge of the "about right" band in section 6) that the agent reprices before publishing. Measured on the sample set in the demo.

**What I'm not measuring yet:** real enquiry rates. That needs production data and belongs in the "next" section.

## 4. The feature, in one screen

1. The agent pastes or types a draft listing: title, description, an optional Thai description, building, area, size (sqm), floor, bedrooms, bathrooms, monthly rent, furnishing, photo count.
2. The tool shows a **completeness score** (0 to 100) and the exact fields that are missing or weak.
3. The tool shows a **price benchmark**: rent per sqm for this listing against the median for the same building (if we have 3 or more listings), otherwise the same area. It says "about right", "above market" or "below market" with the percentage.
4. The tool offers an **AI rewrite**: a cleaner English title and description, and a Thai version, whether or not a Thai draft was supplied. The agent accepts or edits each one. Nothing is applied without a click.
5. The agent copies the finished listing out, or exports it as JSON.

## 5. Completeness checklist and scoring

Points add to 100. A field scores only when it's present and passes the check.

| Field | Points | Passes when |
|---|---|---|
| Title | 10 | 20 to 80 characters, names the building or area, no ALL CAPS |
| Description | 15 | 150 characters or more, mentions at least two of: floor, view, furnishing, nearest station |
| Building | 10 | Present and matches a known building in our table, case-insensitively on its name or one of its aliases. No fuzzy matching in v1 |
| Area | 5 | Present and matches a known area |
| Size (sqm) | 10 | Present, between 20 and 400 |
| Floor | 8 | Present, between 1 and 80 |
| Bedrooms | 5 | Present, 0 (studio) to 5 |
| Bathrooms | 5 | Present, 1 to 5 |
| Monthly rent | 10 | Present, between 5,000 and 500,000 THB |
| Furnishing | 5 | One of: unfurnished, partly furnished, fully furnished |
| Photo count | 10 | 5 or more |
| Nearest station | 7 | Present, or derivable from the building table |

Three fields get linear partial credit: title length, description length and photo count (for example a 120-character description scores 8 of 15). Every other field is all or nothing. The rules live in one file so they're easy to change.

## 6. Price benchmark rules

- Compute `rent_per_sqm = monthly_rent / size_sqm`.
- Benchmark against the **median** rent per sqm of comparable listings. Compare like with like: the first of these with 3 or more listings wins, and the app shows which one was used.
  1. Same building, same bedroom count.
  2. Same area, same building tier (luxury, mid, budget), same bedroom count.
  3. Same area, same tier.
  4. The whole area.
- In v1 every priced listing counts, including ones with status "let" and the listing being checked if it is already in the table.
- Why tier is in the chain: on the sample data it cut wrongly flagged clean listings from 28% to 14% against a bedrooms-only chain (BUILD_LOG, 14 Oct 2026). Caveat: the sample generator priced by tier, so tier is bound to look good here. It needs re-checking on real listings, where tier is a judgement call per building.
- Report the percentage difference. Bands: within 10% is "about right", 10 to 25% is "above/below market", more than 25% is "well above/below market, check for a typo".
- Always show the sample size the benchmark is based on. A benchmark from 4 listings looks different from one from 40.
- Show the area's typical 1-bed rent next to it as a sanity line.

## 7. AI rewrite guardrails

This is the part most likely to go wrong, so the rules come first.

- The model may only use facts that appear in the agent's draft or the building table. It must not add amenities, views, distances or figures.
- The prompt passes the structured fields as JSON and asks for a title and description in English and Thai, plus a `facts_used` list.
- After the response, the app checks every number and every amenity word in the rewrite against the input. Anything not in the input is highlighted as "added by AI, check this" and the agent has to remove or confirm it.
- The agent sees the original and the rewrite side by side. The rewrite is never applied automatically.
- Every prompt and response is logged to a `rewrite_log` table with the listing id, so I can see how often the model adds things. That number goes in the build log.

Expected failure to document: the model inventing a "pool and gym" or a "5 minutes to BTS" that wasn't in the draft. The guardrail above is the fix, and the log is the evidence.

## 8. Data

- **Sample data, clearly labelled.** The listings table is generated from public market data: 12 areas with rent-per-sqm bands from 2026 listing medians, and 67 real condo buildings with their nearest station. See `data/SOURCES.md`.
- About 400 listings. Around 70% are deliberately incomplete or mispriced, with one to three flaws each, so the tool has something to catch.
- The app shows a banner: "Sample data generated from public market averages. Point it at your listings table and it runs on real data."
- A CSV importer accepts a listings file in the same column format, to make that claim true.

## 9. Out of scope for v1

- Photo quality checks. v1 only counts photos.
- Sale listings. Rent only.
- Multi-user accounts, roles, approval flows.
- Publishing to any portal. The output is copy or JSON.
- Mobile app. Responsive web only.

## 10. Stack

- **Database and functions:** Supabase (Postgres, edge functions for the AI call so the API key stays server-side).
- **App:** Next.js on Vercel.
- **Built with:** Claude Code, with a build log kept in `BUILD_LOG.md` from the first commit.

## 11. Data model

Tables: `areas`, `buildings`, `listings`, `rewrite_log`. Full schema in `supabase/migrations/`, applied with `supabase db push`. Listings reference buildings, buildings reference areas. Buildings carry an `aliases` array for the other names agents use. The benchmark is a single SQL query over `listings` grouped by building or area.

Row-level security: the anon key can read `areas`, `buildings`, `listings` and the benchmark views, and write nothing. `rewrite_log` and all writes go through server-side code with the service role key.

## 12. Build order

1. Schema and sample data loaded into Supabase. Benchmark query working in the SQL editor.
2. Completeness scoring, pure function with tests, no UI yet.
3. The one screen: form, score, benchmark.
4. AI rewrite edge function with the guardrails and the log.
5. Export and CSV import.
6. Deploy, record a 60-second walkthrough, write up the metric.

## 13. Next, if this were real

- Measure enquiries per listing before and after, on live data.
- Photo checks: count, resolution, duplicates.
- A "fix all" button once the agent trusts the rewrite.
- Thai-first drafts with an English rewrite, since many agents write Thai first.
- Tighten the benchmark population: exclude "let" listings older than some cutoff, and exclude the listing being checked from its own benchmark. v1 includes both.
- Fuzzy building matching once the aliases list shows which misspellings are common.
