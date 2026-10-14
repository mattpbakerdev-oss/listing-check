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
