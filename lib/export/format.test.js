// Tests for the export formats, written before the implementation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { listingText, listingJson } from "./format.js";

const draft = {
  title: "1 bed at The Met, 45 sqm, near BTS Chong Nonsi",
  description: "Bright one-bedroom on floor 12.",
  description_th: "ห้องสว่าง ชั้น 12",
  title_th: "ให้เช่า 1 ห้องนอน The Met",
  building: "The Met", area: "Sathorn / Chong Nonsi", size_sqm: "45", floor: "12", bedrooms: "1", bathrooms: "1",
  monthly_rent_thb: "35000", furnishing: "fully furnished", photo_count: "8", nearest_station: "",
};
const result = { score: 92, max: 100, matched: { building_id: "the-met", area_id: "sathorn", nearest_station: "BTS Chong Nonsi" }, fields: [] };
const bench = { basis: "area_tier", n: 16, median_rent_per_sqm: "740", listing_rent_per_sqm: "778", pct_diff: "5.1" };

describe("listingText: what an agent pastes into a portal", () => {
  test("title first, then facts on one line, then the descriptions", () => {
    const t = listingText(draft, result);
    const lines = t.split("\n");
    assert.equal(lines[0], "1 bed at The Met, 45 sqm, near BTS Chong Nonsi");
    assert.equal(lines[1], "ให้เช่า 1 ห้องนอน The Met");
    assert.ok(t.includes("1 bed · 1 bath · 45 sqm · floor 12 · fully furnished"));
    assert.ok(t.includes("The Met, Sathorn / Chong Nonsi. Nearest station BTS Chong Nonsi."));
    assert.ok(t.includes("฿35,000 a month"));
    assert.ok(t.includes("Bright one-bedroom on floor 12."));
    assert.ok(t.includes("ห้องสว่าง ชั้น 12"));
  });
  test("uses the derived station when the agent left it blank", () => {
    assert.ok(listingText(draft, result).includes("BTS Chong Nonsi"));
  });
  test("leaves out what is empty rather than printing blanks", () => {
    const t = listingText({ ...draft, description: "Bright.", title_th: "", description_th: "", floor: "", furnishing: "" }, { ...result, matched: { ...result.matched, nearest_station: null } });
    assert.equal(t.includes("floor"), false);
    assert.equal(t.includes("furnished"), false);
    assert.equal(t.includes("Nearest station"), false);
    assert.equal(t.includes("ห้องสว่าง"), false);
    assert.equal(/\n\n\n/.test(t), false);
  });
  test("a studio says studio", () => {
    assert.ok(listingText({ ...draft, bedrooms: "0" }, result).includes("Studio · 1 bath"));
  });
  test("no score or benchmark in the text: it is the listing, not the report", () => {
    const t = listingText(draft, result, bench);
    assert.equal(t.includes("92"), false);
    assert.equal(t.includes("median"), false);
  });
});

describe("listingJson: the same columns as listings.csv plus the check results", () => {
  test("has the listings.csv columns with numbers as numbers and blanks as null", () => {
    const j = listingJson(draft, result, bench);
    assert.equal(j.listing.building_id, "the-met");
    assert.equal(j.listing.area_id, "sathorn");
    assert.equal(j.listing.size_sqm, 45);
    assert.equal(j.listing.monthly_rent_thb, 35000);
    assert.equal(j.listing.nearest_station, "BTS Chong Nonsi");
    assert.equal(j.listing.title_th, "ให้เช่า 1 ห้องนอน The Met");
    assert.equal(j.listing.description_en, "Bright one-bedroom on floor 12.");
  });
  test("carries the score and the benchmark", () => {
    const j = listingJson(draft, result, bench);
    assert.equal(j.check.score, 92);
    assert.equal(j.check.benchmark.basis, "area_tier");
    assert.equal(j.check.benchmark.pct_diff, 5.1);
    assert.equal(j.check.benchmark.n, 16);
  });
  test("benchmark is null when there was none", () => {
    assert.equal(listingJson(draft, result, null).check.benchmark, null);
  });
  test("exported_at is an ISO timestamp", () => {
    assert.match(listingJson(draft, result, bench).exported_at, /^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("lease terms: optional, confirmed by the agent, carried into both exports", () => {
  const withTerms = { ...draft, contract_months: "12", deposit_months: "2", advance_months: "1" };
  test("the text gets a terms line after the facts", () => {
    const text = listingText(withTerms, result);
    assert.match(text, /12-month contract · 2 months deposit · 1 month advance/);
  });
  test("plurals and partial terms", () => {
    assert.match(listingText({ ...draft, contract_months: "6", deposit_months: "1" }, result), /6-month contract · 1 month deposit\n/);
    assert.doesNotMatch(listingText({ ...draft, contract_months: "6", deposit_months: "1" }, result), /advance/);
  });
  test("no terms, no line", () => {
    assert.doesNotMatch(listingText(draft, result), /contract|deposit|advance/);
  });
  test("the JSON carries the three as integers or null", () => {
    const j = listingJson(withTerms, result, null).listing;
    assert.deepEqual([j.contract_months, j.deposit_months, j.advance_months], [12, 2, 1]);
    const k = listingJson(draft, result, null).listing;
    assert.deepEqual([k.contract_months, k.deposit_months, k.advance_months], [null, null, null]);
  });
});
