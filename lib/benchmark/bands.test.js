// Tests for the benchmark wording, from SPEC.md section 6. Written before the implementation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { band, basisLabel, bedLabel, shortVerdict, MIN_COMPARABLES } from "./bands.js";

describe("shortVerdict for the phone strip", () => {
  test("about right -> price ok", () => assert.equal(shortVerdict(band(3)), "price ok"));
  test("above market -> price high", () => assert.equal(shortVerdict(band(15)), "price high"));
  test("below market -> price low", () => assert.equal(shortVerdict(band(-15)), "price low"));
  test("typo band -> price typo?", () => assert.equal(shortVerdict(band(60)), "price typo?"));
  test("no band -> empty", () => assert.equal(shortVerdict(null), ""));
  test("minimum comparables is 8", () => assert.equal(MIN_COMPARABLES, 8));
});

describe("band: within 10% is about right, 10 to 25% is above or below, more than 25% says check for a typo", () => {
  const cases = [
    [0, "about right", "ok"],
    [10, "about right", "ok"],
    [-10, "about right", "ok"],
    [10.1, "above market", "warn"],
    [25, "above market", "warn"],
    [-25, "below market", "warn"],
    [25.1, "well above market, check for a typo", "alert"],
    [-40, "well below market, check for a typo", "alert"],
    [905.3, "well above market, check for a typo", "alert"],
  ];
  for (const [pct, label, tone] of cases) {
    test(`${pct}% -> "${label}" (${tone})`, () => assert.deepEqual(band(pct), { label, tone }));
  }
  test("a non-number has no band", () => assert.equal(band(null), null));
});

describe("bedLabel", () => {
  test("0 is studios", () => assert.equal(bedLabel(0), "studios"));
  test("1 is 1-bed units", () => assert.equal(bedLabel(1), "1-bed units"));
  test("3 is 3-bed units", () => assert.equal(bedLabel(3), "3-bed units"));
});

describe("basisLabel says in words what the median was taken over", () => {
  const ctx = { buildingName: "The Met", areaName: "Sathorn / Chong Nonsi", tier: "luxury", bedrooms: 1 };
  test("building_bedrooms", () => assert.equal(basisLabel("building_bedrooms", ctx), "1-bed units in The Met"));
  test("area_tier_bedrooms", () => assert.equal(basisLabel("area_tier_bedrooms", ctx), "1-bed units in luxury buildings in Sathorn / Chong Nonsi"));
  test("area_tier", () => assert.equal(basisLabel("area_tier", ctx), "luxury buildings in Sathorn / Chong Nonsi"));
  test("area", () => assert.equal(basisLabel("area", ctx), "all listings in Sathorn / Chong Nonsi"));
  test("studio in a building", () => assert.equal(basisLabel("building_bedrooms", { ...ctx, bedrooms: 0 }), "studios in The Met"));
  test("unknown basis falls back to the area", () => assert.equal(basisLabel("something_else", ctx), "all listings in Sathorn / Chong Nonsi"));
});
