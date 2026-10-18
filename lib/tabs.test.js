import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TABS, tabForTarget, tabStatuses } from "./tabs.js";

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

describe("tabStatuses: the step state each phone tab shows as a mark", () => {
  const steps = (a, b, c, d, e) => [{ id: "listing", status: a }, { id: "unit", status: b }, { id: "price", status: c }, { id: "rewrite", status: d }, { id: "export", status: e }];
  test("Draft is done when all three form steps are done, partial when any has progress, else none", () => {
    assert.equal(tabStatuses(steps("done", "done", "done", "todo", "todo")).draft, "done");
    assert.equal(tabStatuses(steps("done", "current", "todo", "todo", "todo")).draft, "partial");
    assert.equal(tabStatuses(steps("current", "partial", "todo", "todo", "todo")).draft, "partial");
    assert.equal(tabStatuses(steps("current", "todo", "todo", "todo", "todo")).draft, "none");
  });
  test("Rewrite and Export follow their step; Check has no step", () => {
    const t = tabStatuses(steps("done", "done", "done", "done", "current"));
    assert.deepEqual([t.check, t.rewrite, t.export], ["none", "done", "none"]);
    assert.equal(tabStatuses(steps("done", "done", "done", "done", "done")).export, "done");
  });
});
