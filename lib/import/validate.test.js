// Tests for the CSV importer's row validation, written before the implementation.
// The importer accepts the same columns as data/listings.csv.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateRows, LISTING_COLUMNS } from "./validate.js";

const reference = {
  buildings: [
    { building_id: "the-met", area_id: "sathorn" },
    { building_id: "hq-thonglor", area_id: "thonglor" },
  ],
  areas: [{ area_id: "sathorn" }, { area_id: "thonglor" }],
};

const good = {
  listing_id: "X0001", building_id: "the-met", area_id: "sathorn", title: "1 bed at The Met",
  description_en: "Nice.", description_th: "", bedrooms: "1", bathrooms: "1", size_sqm: "45", floor: "12",
  monthly_rent_thb: "35000", furnishing: "fully furnished", photo_count: "8", nearest_station: "BTS Chong Nonsi",
  listed_date: "2026-09-01", status: "active", flaws: "",
};

const run = (rows) => validateRows(rows, reference);

describe("columns", () => {
  test("the importer's columns are exactly the listings.csv header", () => {
    assert.deepEqual(LISTING_COLUMNS, [
      "listing_id", "building_id", "area_id", "title", "description_en", "description_th", "bedrooms", "bathrooms",
      "size_sqm", "floor", "monthly_rent_thb", "furnishing", "photo_count", "nearest_station", "listed_date", "status", "flaws",
    ]);
  });
  test("a file missing a required column is rejected as a whole", () => {
    const { listing_id, ...noId } = good;
    const r = run([noId]);
    assert.equal(r.ok.length, 0);
    assert.match(r.fileError, /listing_id/);
  });
  test("unknown extra columns are ignored, not an error", () => {
    const r = run([{ ...good, agent_name: "Somchai" }]);
    assert.equal(r.ok.length, 1);
    assert.equal("agent_name" in r.ok[0], false);
  });
});

describe("a good row", () => {
  test("is accepted with numbers parsed and empty cells as null", () => {
    const r = run([good]);
    assert.equal(r.skipped.length, 0);
    assert.equal(r.ok[0].size_sqm, 45);
    assert.equal(r.ok[0].monthly_rent_thb, 35000);
    assert.equal(r.ok[0].description_th, null);
    assert.equal(r.ok[0].flaws, null);
  });
  test("area_id is filled from the building when blank", () => {
    const r = run([{ ...good, area_id: "" }]);
    assert.equal(r.ok[0].area_id, "sathorn");
  });
  test("thousands separators in the rent are accepted", () => {
    const r = run([{ ...good, monthly_rent_thb: "35,000" }]);
    assert.equal(r.ok[0].monthly_rent_thb, 35000);
  });
  test("an incomplete row is still loaded: missing floor and photos are what the checker is for", () => {
    const r = run([{ ...good, floor: "", photo_count: "", furnishing: "" }]);
    assert.equal(r.ok.length, 1);
    assert.equal(r.ok[0].floor, null);
  });
});

describe("rows that are skipped, each with a reason naming the row", () => {
  const cases = [
    ["no listing_id", { ...good, listing_id: "" }, /listing_id is missing/],
    ["unknown building", { ...good, building_id: "nowhere-tower" }, /building_id "nowhere-tower" is not in the buildings table/],
    ["unknown area", { ...good, area_id: "mars" }, /area_id "mars" is not in the areas table/],
    ["no building and no area", { ...good, building_id: "", area_id: "" }, /needs a building_id or an area_id/],
    ["non-numeric size", { ...good, size_sqm: "big" }, /size_sqm "big" is not a number/],
    ["negative rent", { ...good, monthly_rent_thb: "-5" }, /monthly_rent_thb must be above zero/],
    ["bad date", { ...good, listed_date: "yesterday" }, /listed_date "yesterday" is not a date/],
    ["bad status", { ...good, status: "sold" }, /status must be active or let/],
  ];
  for (const [name, row, reason] of cases) {
    test(name, () => {
      const r = run([row]);
      assert.equal(r.ok.length, 0);
      assert.equal(r.skipped.length, 1);
      assert.equal(r.skipped[0].row, 2); // row 1 is the header
      assert.match(r.skipped[0].reason, reason);
    });
  }
  test("a duplicate listing_id in the same file: the second is skipped", () => {
    const r = run([good, { ...good, title: "again" }]);
    assert.equal(r.ok.length, 1);
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].row, 3);
    assert.match(r.skipped[0].reason, /duplicate listing_id "X0001"/);
  });
  test("a blank status defaults to active", () => {
    assert.equal(run([{ ...good, status: "" }]).ok[0].status, "active");
  });
  test("a bad row does not stop the good ones", () => {
    const r = run([good, { ...good, listing_id: "X0002", size_sqm: "big" }, { ...good, listing_id: "X0003" }]);
    assert.deepEqual(r.ok.map((x) => x.listing_id), ["X0001", "X0003"]);
    assert.equal(r.skipped[0].listing_id, "X0002");
  });
});
