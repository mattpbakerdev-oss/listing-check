import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TABS, tabForTarget } from "./tabs.js";

describe("phone tabs: four sections, and which one holds a given target", () => {
  test("four tabs in order", () => {
    assert.deepEqual(TABS.map((t) => t.id), ["draft", "check", "rewrite", "export"]);
    for (const t of TABS) assert.ok(t.label);
  });
  test("form fields and the three form steps live in Draft", () => {
    for (const id of ["title", "description", "building", "monthly_rent_thb", "photo_count", "nearest_station"]) assert.equal(tabForTarget(id), "draft");
  });
  test("results in Check, rewrite and export in their own tabs", () => {
    assert.equal(tabForTarget("results"), "check");
    assert.equal(tabForTarget("rewrite"), "rewrite");
    assert.equal(tabForTarget("export"), "export");
  });
  test("an unknown target stays on Draft", () => {
    assert.equal(tabForTarget("nothing"), "draft");
  });
});
