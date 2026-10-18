import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { STEPS, stepStatuses, fixCount } from "./steps.js";

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

describe("fixCount: how many of a card's fields are not ok, for the chip in its heading", () => {
  test("counts missing, partial and invalid; ignores fields outside the card", () => {
    const f = [{ field: "title", status: "partial" }, { field: "description", status: "ok" }, { field: "floor", status: "missing" }, { field: "size_sqm", status: "invalid" }];
    assert.equal(fixCount(f, STEPS[0].fields), 1);
    assert.equal(fixCount(f, STEPS[1].fields), 2);
    assert.equal(fixCount(f, STEPS[2].fields), 0);
  });
});

describe("a visited but incomplete step is 'partial': something typed in its card, not all ok, not the current step", () => {
  test("partial needs content in one of the card's fields", () => {
    const f = fields(["title", "description"]); // step 1 done, step 2 current
    const steps = stepStatuses(f, { filled: new Set(["title", "description", "monthly_rent_thb"]) });
    assert.deepEqual(steps.map((s) => s.status), ["done", "current", "partial", "todo", "todo"]);
  });
  test("without content a later step is still 'todo'; rewrite and export are never partial", () => {
    const steps = stepStatuses(fields(["title", "description"]), { filled: new Set(["title", "description"]) });
    assert.deepEqual(steps.map((s) => s.status), ["done", "current", "todo", "todo", "todo"]);
  });
  test("no filled set given: behaves as before", () => {
    assert.deepEqual(stepStatuses(fields([]), {}).map((s) => s.status), ["current", "todo", "todo", "todo", "todo"]);
  });
});
