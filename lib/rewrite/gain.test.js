import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { projectedGain } from "./gain.js";

const fields = (title, description) => [
  { field: "title", earned: title, points: 10 }, { field: "description", earned: description, points: 15 }, { field: "floor", earned: 0, points: 8 },
];

describe("projectedGain: what a rewrite of the title and description could recover", () => {
  test("adds the two deficits, to one decimal", () => {
    assert.deepEqual(projectedGain(fields(8, 4.2)), { points: 12.8, title: 2, description: 10.8 });
  });
  test("nothing to gain when both are full", () => {
    assert.deepEqual(projectedGain(fields(10, 15)), { points: 0, title: 0, description: 0 });
  });
  test("missing fields count as zero earned", () => {
    assert.equal(projectedGain([{ field: "floor", earned: 0, points: 8 }]).points, 25);
  });
});
