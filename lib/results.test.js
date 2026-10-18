import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { verdictSentence, groupBars, ringBand, barBand } from "./results.js";

const f = (field, earned, points, status) => ({ field, earned, points, status });

describe("verdictSentence: one plain sentence under the score", () => {
  test("empty, ready, nearly there, needs work", () => {
    assert.equal(verdictSentence({ empty: true, score: 0, toFix: 12 }), "Nothing to check yet. Start with the title, or load an example draft.");
    assert.equal(verdictSentence({ empty: false, score: 100, toFix: 0 }), "Ready to publish. Every field is complete.");
    assert.equal(verdictSentence({ empty: false, score: 88, toFix: 1 }), "Ready to publish. One field could still improve.");
    assert.equal(verdictSentence({ empty: false, score: 70, toFix: 5 }), "Nearly there. Five fields are holding it back.");
    assert.equal(verdictSentence({ empty: false, score: 70, toFix: 2 }), "Nearly there. Two fields are holding it back.");
    assert.equal(verdictSentence({ empty: false, score: 40, toFix: 9 }), "Needs work. Nine fields are missing or weak.");
    assert.equal(verdictSentence({ empty: false, score: 40, toFix: 13 }), "Needs work. 13 fields are missing or weak.");
  });
});

describe("groupBars: earned over possible for each card, in card order", () => {
  test("sums the fields of each card and counts what is not ok", () => {
    const fields = [f("title", 8, 10, "partial"), f("description", 4.2, 15, "partial"), f("building", 10, 10, "ok"), f("floor", 0, 8, "missing"), f("monthly_rent_thb", 10, 10, "ok"), f("photo_count", 6, 10, "partial")];
    const bars = groupBars(fields);
    assert.deepEqual(bars.map((b) => b.id), ["listing", "unit", "price"]);
    assert.deepEqual(bars[0], { id: "listing", label: "The listing", earned: 12.2, points: 25, toFix: 2, target: "title" });
    assert.equal(bars[1].earned, 10); assert.equal(bars[1].points, 18); assert.equal(bars[1].toFix, 1);
    assert.equal(bars[2].earned, 16); assert.equal(bars[2].points, 20);
  });
});

describe("bands: the ring is red under 25, amber to 84, green from 85; a bar is red under 25%, amber under 60%, else green", () => {
  test("ringBand", () => {
    assert.deepEqual([0, 24, 25, 59, 60, 84, 85, 100].map(ringBand), ["low", "low", "mid", "mid", "mid", "mid", "high", "high"]);
  });
  test("barBand takes a percentage of the card's maximum", () => {
    assert.deepEqual([0, 24.9, 25, 59.9, 60, 100].map(barBand), ["low", "low", "mid", "mid", "high", "high"]);
  });
});
