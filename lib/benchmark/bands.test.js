// Tests for the benchmark wording, from SPEC.md section 6. Written before the implementation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { band, basisLabel, bedLabel, shortVerdict, MIN_COMPARABLES, proximityNote } from "./bands.js";

describe("shortVerdict for the phone strip", () => {
  test("about right -> price ok", () => assert.equal(shortVerdict(band(3)), "price ok"));
  test("a bit above -> a bit high", () => assert.equal(shortVerdict(band(15)), "a bit high"));
  test("a bit below -> a bit low", () => assert.equal(shortVerdict(band(-15)), "a bit low"));
  test("typo band -> price typo?", () => assert.equal(shortVerdict(band(60)), "price typo?"));
  test("no band -> empty", () => assert.equal(shortVerdict(null), ""));
  test("minimum comparables is 8", () => assert.equal(MIN_COMPARABLES, 8));
});

describe("band: within 10% is about right, 10 to 25% is a note with no warning colour, more than 25% is red and says check for a typo", () => {
  const cases = [
    [0, "about right", "ok"],
    [10, "about right", "ok"],
    [-10, "about right", "ok"],
    [10.1, "a bit above similar listings", "note"],
    [25, "a bit above similar listings", "note"],
    [-25, "a bit below similar listings", "note"],
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

describe("proximityNote: the comparables are not filtered by distance, so say how far this building is", () => {
  test("with walking minutes and a station", () => {
    assert.equal(proximityNote({ building_name: "Rhythm Rangnam", nearest_station: "BTS Victory Monument", walk_min: 3 }),
      "Comparables are not filtered by distance to a station. Rhythm Rangnam is a 3 minute walk from BTS Victory Monument.");
  });
  test("plural minutes", () => {
    assert.match(proximityNote({ building_name: "The Met", nearest_station: "BTS Chong Nonsi", walk_min: 8 }), /an 8 minute walk from BTS Chong Nonsi/);
  });
  test("no building, or no walking minutes: nothing", () => {
    assert.equal(proximityNote(null), null);
    assert.equal(proximityNote({ building_name: "X", nearest_station: "BTS Asok", walk_min: null }), null);
  });
});
