import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STEPS, stepStatuses } from "./steps.js";

const ALL = ["title", "description", "building", "area", "size_sqm", "floor", "bedrooms", "bathrooms", "monthly_rent_thb", "furnishing", "photo_count", "nearest_station"];
const fields = (okIds) => ALL.map((field) => ({ field, status: okIds.includes(field) ? "ok" : "missing" }));
const ids = (steps, status) => steps.filter((s) => s.status === status).map((s) => s.id);

describe("stepStatuses: five steps, done from real state, current is the first not done", () => {
  test("there are five steps in order, each with a target to scroll to", () => {
    assert.deepEqual(STEPS.map((s) => s.id), ["listing", "unit", "price", "rewrite", "export"]);
    assert.deepEqual(STEPS.map((s) => s.n), [1, 2, 3, 4, 5]);
    for (const s of STEPS) assert.ok(s.target && s.label);
  });

  test("an empty draft: nothing done, step 1 current, the rest to do", () => {
    const steps = stepStatuses(fields([]), {});
    assert.deepEqual(ids(steps, "done"), []);
    assert.deepEqual(ids(steps, "current"), ["listing"]);
    assert.deepEqual(ids(steps, "todo"), ["unit", "price", "rewrite", "export"]);
  });

  test("step 1 is done only when title and description are both ok", () => {
    assert.equal(stepStatuses(fields(["title"]), {})[0].status, "current");
    assert.equal(stepStatuses(fields(["title", "description"]), {})[0].status, "done");
  });

  test("step 2 needs every unit field; step 3 needs rent and photos", () => {
    const unit = ["building", "area", "size_sqm", "floor", "bedrooms", "bathrooms", "furnishing", "nearest_station"];
    let steps = stepStatuses(fields(["title", "description", ...unit]), {});
    assert.deepEqual(ids(steps, "done"), ["listing", "unit"]);
    assert.deepEqual(ids(steps, "current"), ["price"]);
    steps = stepStatuses(fields(["title", "description", ...unit, "monthly_rent_thb", "photo_count"]), {});
    assert.deepEqual(ids(steps, "done"), ["listing", "unit", "price"]);
    assert.deepEqual(ids(steps, "current"), ["rewrite"]);
  });

  test("a later step can be done before an earlier one; current is still the first not done", () => {
    const steps = stepStatuses(fields(["monthly_rent_thb", "photo_count"]), {});
    assert.deepEqual(ids(steps, "done"), ["price"]);
    assert.deepEqual(ids(steps, "current"), ["listing"]);
  });

  test("rewrite is done when a rewrite was applied; export when the listing was copied or downloaded", () => {
    const all = fields(ALL);
    let steps = stepStatuses(all, { applied: true });
    assert.deepEqual(ids(steps, "done"), ["listing", "unit", "price", "rewrite"]);
    assert.deepEqual(ids(steps, "current"), ["export"]);
    steps = stepStatuses(all, { applied: true, exported: true });
    assert.deepEqual(ids(steps, "done"), ["listing", "unit", "price", "rewrite", "export"]);
    assert.deepEqual(ids(steps, "current"), []);
  });

  test("partial and invalid fields do not count as ok", () => {
    const f = fields(ALL).map((x) => (x.field === "title" ? { ...x, status: "partial" } : x));
    assert.equal(stepStatuses(f, {})[0].status, "current");
  });
});
