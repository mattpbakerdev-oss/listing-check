// Tests for the completeness score, written from SPEC.md section 5 before the implementation.
// Run with: npm test

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { scoreListing } from "./score.js";
import { RULES } from "./rules.js";

const reference = {
  buildings: [
    { building_id: "the-met", building_name: "The Met", area_id: "sathorn", nearest_station: "BTS Chong Nonsi", aliases: ["Met Sathorn"] },
    { building_id: "hq-thonglor", building_name: "HQ Thonglor", area_id: "thonglor", nearest_station: "BTS Thong Lo", aliases: [] },
  ],
  areas: [
    { area_id: "sathorn", area_name: "Sathorn / Chong Nonsi" },
    { area_id: "thonglor", area_name: "Thonglor" },
  ],
};

// A draft that passes every check in the table.
const full = {
  title: "1 bed at The Met, 45 sqm, near BTS Chong Nonsi",
  description:
    "Bright one-bedroom on floor 12 at The Met with an unblocked city view. Fully furnished with a washing machine and bathtub. " +
    "About 10 minutes' walk to BTS Chong Nonsi. One year contract, two months deposit.",
  building: "The Met",
  area: "Sathorn / Chong Nonsi",
  size_sqm: 45,
  floor: 12,
  bedrooms: 1,
  bathrooms: 1,
  monthly_rent_thb: 35000,
  furnishing: "fully furnished",
  photo_count: 8,
  nearest_station: "BTS Chong Nonsi",
};

const score = (overrides) => scoreListing({ ...full, ...overrides }, reference);
const earned = (result, field) => result.fields.find((f) => f.field === field).earned;

describe("rules table", () => {
  test("points add to 100 and cover the twelve fields in section 5", () => {
    assert.equal(RULES.reduce((s, r) => s + r.points, 0), 100);
    assert.deepEqual(
      RULES.map((r) => r.field).sort(),
      ["area", "bathrooms", "bedrooms", "building", "description", "floor", "furnishing", "monthly_rent_thb", "nearest_station", "photo_count", "size_sqm", "title"],
    );
  });
});

describe("a complete draft", () => {
  test("scores 100 with every field ok", () => {
    const r = score({});
    assert.equal(r.score, 100);
    assert.equal(r.max, 100);
    assert.ok(r.fields.every((f) => f.status === "ok"), JSON.stringify(r.fields.filter((f) => f.status !== "ok")));
  });

  test("reports the matched building, area and station", () => {
    const r = score({});
    assert.deepEqual(r.matched, { building_id: "the-met", area_id: "sathorn", nearest_station: "BTS Chong Nonsi" });
  });
});

describe("missing fields lose exactly their points", () => {
  const expected = {
    title: 10, description: 15, building: 10, area: 5, size_sqm: 10, floor: 8,
    bedrooms: 5, bathrooms: 5, monthly_rent_thb: 10, furnishing: 5, photo_count: 10,
  };
  for (const [field, points] of Object.entries(expected)) {
    for (const blank of [undefined, null, ""]) {
      test(`${field} = ${JSON.stringify(blank)} scores ${100 - points}`, () => {
        const r = score({ [field]: blank });
        assert.equal(r.score, 100 - points);
        assert.equal(earned(r, field), 0);
        assert.equal(r.fields.find((f) => f.field === field).status, "missing");
      });
    }
  }

  test("an empty draft scores 0", () => {
    const r = scoreListing({}, reference);
    assert.equal(r.score, 0);
  });
});

describe("title: 10 points. 6 for length (linear to 20 chars, full to 80), 2 names a building or area, 2 not ALL CAPS", () => {
  test("10 characters naming the building earns 3 + 2 + 2 = 7", () => {
    const r = score({ title: "At The Met" });
    assert.equal(earned(r, "title"), 7);
    assert.equal(r.fields.find((f) => f.field === "title").status, "partial");
  });
  test("exactly 20 characters earns full length credit", () => {
    assert.equal(earned(score({ title: "The Met 1 bed, 45sqm" }), "title"), 10);
  });
  test("ALL CAPS loses 2", () => {
    assert.equal(earned(score({ title: full.title.toUpperCase() }), "title"), 8);
  });
  test("naming neither a building nor an area loses 2", () => {
    assert.equal(earned(score({ title: "Lovely one bed condo for rent, great location" }), "title"), 8);
  });
  test("naming an alias counts as naming the building", () => {
    assert.equal(earned(score({ title: "1 bed at met sathorn, 45 sqm, high floor" }), "title"), 10);
  });
  test("naming only the area counts", () => {
    assert.equal(earned(score({ title: "1 bed in Chong Nonsi, 45 sqm, high floor" }), "title"), 10);
  });
  test("over 80 characters loses length credit linearly, 120 characters earns 3 of 6 for length", () => {
    const long = ("1 bed at The Met, 45 sqm, near BTS Chong Nonsi, " + "x".repeat(200)).slice(0, 120);
    assert.equal(earned(score({ title: long }), "title"), 7);
  });
});

describe("description: 15 points. 10 for length (linear to 150 chars), 5 for mentioning two of floor, view, furnishing, station", () => {
  test("120 characters with no mentions earns 8 of 15, the example in the spec", () => {
    // Ends in a full stop so trimming cannot shorten it; the scorer trims whitespace before measuring.
    const d = "Nice condo in a great location, ready to move in. Contact us for more details. ".repeat(3).slice(0, 119) + ".";
    assert.equal(d.length, 120);
    assert.equal(earned(score({ description: d }), "description"), 8);
  });
  test("120 characters with two mentions earns 13", () => {
    const d = ("City view unit on floor 12, fully furnished. " + "Great location, ready to move in now. ".repeat(4)).slice(0, 120);
    assert.equal(d.length, 120);
    assert.equal(earned(score({ description: d }), "description"), 13);
  });
  test("150+ characters with one mention earns 10", () => {
    const d = "Lovely unit on floor 12. " + "Great location, close to shops and restaurants, ready to move in. ".repeat(3);
    assert.ok(d.length >= 150);
    assert.equal(earned(score({ description: d }), "description"), 10);
  });
  test("a short description says what to add, not how many characters are missing", () => {
    const msg = (d) => score({ description: d }).fields.find((f) => f.field === "description").message;
    assert.equal(msg("Nice room, ready to move in."), "Too short. Mention the floor, the view, the furnishing or the nearest station.");
    assert.equal(msg("Nice room, fully furnished, near BTS."), "Too short. Mention the floor or the view.");
    assert.equal(msg("On floor 12 with a city view, fully furnished, near the BTS."), "Too short. Add a sentence or two more.");
  });
  test("a long description with too few mentions lists all four", () => {
    const d = "Lovely unit on floor 12. " + "Great location, close to shops and restaurants, ready to move in. ".repeat(3);
    assert.equal(score({ description: d }).fields.find((f) => f.field === "description").message, "Mention at least 2 of: floor, view, furnishing, nearest station.");
  });
  test("mentions are detected case-insensitively and by the station network name", () => {
    const d = "Unblocked VIEW from a high floor. Five minutes to the MRT. " + "Ready to move in. ".repeat(6);
    assert.ok(d.length >= 150);
    assert.equal(earned(score({ description: d }), "description"), 15);
  });
});

describe("building: 10 points, case-insensitive match on name or alias, no fuzzy matching", () => {
  test("exact name", () => assert.equal(earned(score({ building: "The Met" }), "building"), 10));
  test("different case and surrounding whitespace", () => assert.equal(earned(score({ building: "  the met " }), "building"), 10));
  test("alias", () => assert.equal(earned(score({ building: "met sathorn" }), "building"), 10));
  test("near miss is not matched", () => {
    const r = score({ building: "The Met Sathorn" });
    assert.equal(earned(r, "building"), 0);
    assert.equal(r.fields.find((f) => f.field === "building").status, "invalid");
    assert.equal(r.matched.building_id, null);
  });
});

describe("area: 5 points, matches area id, full name, or one part of a 'A / B' name", () => {
  test("full name", () => assert.equal(earned(score({ area: "Sathorn / Chong Nonsi" }), "area"), 5));
  test("one part", () => assert.equal(earned(score({ area: "chong nonsi" }), "area"), 5));
  test("area id", () => assert.equal(earned(score({ area: "sathorn" }), "area"), 5));
  test("unknown", () => assert.equal(earned(score({ area: "Nowhere" }), "area"), 0));
});

describe("numeric ranges are all or nothing", () => {
  const cases = [
    ["size_sqm", 10, [[19, 0], [20, 10], [400, 10], [401, 0], ["45", 10]]],
    ["floor", 8, [[0, 0], [1, 8], [80, 8], [81, 0], ["12", 8]]],
    ["bedrooms", 5, [[0, 5], [5, 5], [6, 0], [-1, 0]]],
    ["bathrooms", 5, [[0, 0], [1, 5], [5, 5], [6, 0]]],
    ["monthly_rent_thb", 10, [[4999, 0], [5000, 10], [500000, 10], [500001, 0], ["35,000", 10]]],
  ];
  for (const [field, , values] of cases) {
    for (const [value, expected] of values) {
      test(`${field} = ${JSON.stringify(value)} earns ${expected}`, () => {
        const r = score({ [field]: value });
        assert.equal(earned(r, field), expected);
        if (expected === 0) assert.equal(r.fields.find((f) => f.field === field).status, "invalid");
      });
    }
  }
  test("a non-numeric string counts as missing", () => {
    const r = score({ size_sqm: "big" });
    assert.equal(earned(r, "size_sqm"), 0);
    assert.equal(r.fields.find((f) => f.field === "size_sqm").status, "invalid");
  });
});

describe("furnishing: 5 points, one of three values, forgiving on case, hyphens and spacing", () => {
  for (const v of ["unfurnished", "partly furnished", "fully furnished", "Fully Furnished", "fully-furnished", " PARTLY  FURNISHED "]) {
    test(`${JSON.stringify(v)} earns 5`, () => assert.equal(earned(score({ furnishing: v }), "furnishing"), 5));
  }
  for (const v of ["furnished", "semi furnished", "yes"]) {
    test(`${JSON.stringify(v)} earns 0`, () => {
      const r = score({ furnishing: v });
      assert.equal(earned(r, "furnishing"), 0);
      assert.equal(r.fields.find((f) => f.field === "furnishing").status, "invalid");
    });
  }
});

describe("photo count: 10 points, linear to 5 photos", () => {
  for (const [n, expected] of [[0, 0], [1, 2], [3, 6], [5, 10], [12, 10], ["4", 8]]) {
    test(`${JSON.stringify(n)} photos earn ${expected}`, () => assert.equal(earned(score({ photo_count: n }), "photo_count"), expected));
  }
  test("3 photos is partial, 0 is missing", () => {
    assert.equal(score({ photo_count: 3 }).fields.find((f) => f.field === "photo_count").status, "partial");
    assert.equal(score({ photo_count: 0 }).fields.find((f) => f.field === "photo_count").status, "missing");
  });
});

describe("nearest station: 7 points, present or derivable from the matched building", () => {
  test("missing but building known earns 7 and reports the derived station", () => {
    const r = score({ nearest_station: "" });
    assert.equal(earned(r, "nearest_station"), 7);
    assert.equal(r.matched.nearest_station, "BTS Chong Nonsi");
    assert.match(r.fields.find((f) => f.field === "nearest_station").message, /The Met/);
  });
  test("missing and building unknown earns 0", () => {
    const r = score({ nearest_station: "", building: "Unknown Tower" });
    assert.equal(earned(r, "nearest_station"), 0);
    assert.equal(r.matched.nearest_station, null);
  });
  test("a typed station wins over the building's station", () => {
    const r = score({ nearest_station: "BTS Surasak" });
    assert.equal(earned(r, "nearest_station"), 7);
    assert.equal(r.matched.nearest_station, "BTS Surasak");
  });
});

describe("output shape", () => {
  test("every field entry has field, label, points, earned, status and message", () => {
    for (const f of score({}).fields) {
      assert.deepEqual(Object.keys(f).sort(), ["earned", "field", "label", "message", "points", "status"]);
      assert.ok(["ok", "partial", "missing", "invalid"].includes(f.status));
    }
  });
  test("the score is an integer and earned values never exceed points", () => {
    const r = score({ title: "At The Met", photo_count: 1, description: "Short." });
    assert.equal(r.score, Math.round(r.score));
    for (const f of r.fields) assert.ok(f.earned <= f.points && f.earned >= 0);
  });
  test("works with no reference data at all", () => {
    const r = scoreListing(full, { buildings: [], areas: [] });
    assert.equal(earned(r, "building"), 0);
    assert.equal(earned(r, "area"), 0);
    assert.equal(earned(r, "nearest_station"), 7);
  });
});
