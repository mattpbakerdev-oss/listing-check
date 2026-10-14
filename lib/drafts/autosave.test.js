// Tests for draft autosave, written before the implementation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reducer, initialState, isEmptyDraft, relativeTime, serialize, parse, STORAGE_KEY } from "./autosave.js";

const T0 = Date.parse("2026-10-15T09:00:00Z");
const min = (n) => n * 60 * 1000;
const draft = { title: "1 bed at The Met", description: "", building: "The Met" };
const saved = { draft, savedAt: T0 - min(20) };
const run = (state, ...actions) => actions.reduce(reducer, state);

describe("isEmptyDraft", () => {
  test("empty when every value is blank", () => assert.equal(isEmptyDraft({ title: "", description: "  ", floor: "" }), true));
  test("not empty with one value", () => assert.equal(isEmptyDraft({ title: "", floor: "12" }), false));
  test("an undefined draft is empty", () => assert.equal(isEmptyDraft(undefined), true));
});

describe("relativeTime", () => {
  const cases = [[0, "just now"], [45 * 1000, "just now"], [min(1), "1 minute ago"], [min(20), "20 minutes ago"], [min(60), "1 hour ago"], [min(150), "2 hours ago"], [min(60 * 24), "yesterday"], [min(60 * 24 * 3), "3 days ago"]];
  for (const [ago, text] of cases) test(`${ago} ms -> ${text}`, () => assert.equal(relativeTime(T0 - ago, T0), text));
});

describe("serialize and parse", () => {
  test("round trip keeps the draft and the time", () => {
    const p = parse(serialize(draft, T0));
    assert.deepEqual(p.draft, draft);
    assert.equal(p.savedAt, T0);
  });
  test("garbage, wrong version or missing draft parse to null", () => {
    assert.equal(parse("not json"), null);
    assert.equal(parse(JSON.stringify({ v: 99, draft, savedAt: T0 })), null);
    assert.equal(parse(JSON.stringify({ v: 1, savedAt: T0 })), null);
    assert.equal(parse(null), null);
  });
  test("non-string values in a stored draft are dropped", () => {
    const p = parse(JSON.stringify({ v: 1, savedAt: T0, draft: { title: "ok", floor: 12, bad: { x: 1 } } }));
    assert.deepEqual(p.draft, { title: "ok", floor: "12" });
  });
  test("the storage key is stable", () => assert.equal(STORAGE_KEY, "listing-check.draft.v1"));
});

describe("reducer: start-up", () => {
  test("with a stored draft and an empty form, offer to restore", () => {
    const s = run(initialState, { type: "init", stored: saved, formEmpty: true });
    assert.equal(s.offer, true);
    assert.deepEqual(s.offered, saved);
    assert.equal(s.savedAt, null);
  });
  test("with a stored draft but a form that already has content, do not offer", () => {
    const s = run(initialState, { type: "init", stored: saved, formEmpty: false });
    assert.equal(s.offer, false);
  });
  test("with nothing stored, nothing is offered and nothing is saved", () => {
    const s = run(initialState, { type: "init", stored: null, formEmpty: true });
    assert.equal(s.offer, false);
    assert.equal(s.savedAt, null);
  });
});

describe("reducer: restore and discard", () => {
  const offered = run(initialState, { type: "init", stored: saved, formEmpty: true });
  test("restore closes the offer and reports the restored draft's save time", () => {
    const s = run(offered, { type: "restore" });
    assert.equal(s.offer, false);
    assert.equal(s.savedAt, saved.savedAt);
  });
  test("discard closes the offer and forgets the stored draft", () => {
    const s = run(offered, { type: "discard" });
    assert.equal(s.offer, false);
    assert.equal(s.offered, null);
    assert.equal(s.savedAt, null);
  });
});

describe("reducer: saving", () => {
  test("saved records the time", () => {
    const s = run(initialState, { type: "init", stored: null, formEmpty: true }, { type: "saved", at: T0 });
    assert.equal(s.savedAt, T0);
  });
  test("a save while the restore offer is open withdraws the offer: the user has started typing", () => {
    const s = run(initialState, { type: "init", stored: saved, formEmpty: true }, { type: "saved", at: T0 });
    assert.equal(s.offer, false);
    assert.equal(s.savedAt, T0);
  });
  test("cleared forgets the save time", () => {
    const s = run(initialState, { type: "saved", at: T0 }, { type: "cleared" });
    assert.equal(s.savedAt, null);
    assert.equal(s.offer, false);
  });
});
