// Tests for the rewrite review state, written before the implementation.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reducer, initialState, FIELDS, remainingFlags, canAccept, progress, acceptedEntries } from "./state.js";

const data = {
  log_id: 7,
  rewrite: { title_en: "Clean title", description_en: "Clean description with a pool.", title_th: "ชื่อ", description_th: "คำอธิบาย", facts_used: [] },
  flagged: { title_en: [], description_en: ["pool"], title_th: [], description_th: [] },
  facts_added: ["pool"],
};

const loaded = () => reducer(reducer(initialState, { type: "start" }), { type: "loaded", data });
const run = (state, ...actions) => actions.reduce(reducer, state);

describe("the four fields", () => {
  test("map rewrite outputs to draft fields", () => {
    assert.deepEqual(FIELDS.map((f) => [f.out, f.draft]), [
      ["title_en", "title"], ["description_en", "description"], ["title_th", "title_th"], ["description_th", "description_th"],
    ]);
  });
});

describe("loading", () => {
  test("start clears any earlier result", () => {
    const s = run(loaded(), { type: "accept", field: "title_en" }, { type: "start" });
    assert.equal(s.status, "loading");
    assert.equal(s.data, null);
    assert.deepEqual(s.accepted, {});
  });
  test("loaded opens the review with the rewrite text in the edit boxes", () => {
    const s = loaded();
    assert.equal(s.status, "ready");
    assert.equal(s.open, true);
    assert.equal(s.edits.title_en, "Clean title");
    assert.equal(s.edits.description_en, "Clean description with a pool.");
  });
  test("failed keeps the error and nothing else", () => {
    const s = run(loaded(), { type: "failed", error: "limit" });
    assert.equal(s.status, "error");
    assert.equal(s.error, "limit");
    assert.equal(s.data, null);
  });
});

describe("reset, which is what Clear and the example buttons do", () => {
  test("after a rewrite with edits and an accepted field, reset is the initial state", () => {
    const s = run(loaded(), { type: "edit", field: "title_en", text: "Edited" }, { type: "accept", field: "title_en" }, { type: "reset" });
    assert.deepEqual(s, initialState);
  });
  test("the initial state has no rewrite, nothing accepted and the review closed", () => {
    assert.equal(initialState.status, "idle");
    assert.equal(initialState.data, null);
    assert.deepEqual(initialState.accepted, {});
    assert.equal(initialState.open, false);
  });
});

describe("accepting", () => {
  test("an unflagged field can be accepted straight away", () => {
    assert.equal(canAccept(loaded(), "title_en"), true);
    const s = run(loaded(), { type: "accept", field: "title_en" });
    assert.equal(s.accepted.title_en, "Clean title");
  });
  test("a field with a flagged word still in the text needs confirming first", () => {
    const s = loaded();
    assert.deepEqual(remainingFlags(s, "description_en"), ["pool"]);
    assert.equal(canAccept(s, "description_en"), false);
    assert.equal(run(s, { type: "accept", field: "description_en" }).accepted.description_en, undefined);
    const confirmed = run(s, { type: "confirm", field: "description_en", value: true });
    assert.equal(canAccept(confirmed, "description_en"), true);
  });
  test("editing the flagged word out makes it acceptable without confirming", () => {
    const s = run(loaded(), { type: "edit", field: "description_en", text: "Clean description." });
    assert.deepEqual(remainingFlags(s, "description_en"), []);
    assert.equal(canAccept(s, "description_en"), true);
  });
  test("an emptied field cannot be accepted", () => {
    const s = run(loaded(), { type: "edit", field: "title_en", text: "   " });
    assert.equal(canAccept(s, "title_en"), false);
  });
  test("accept stores the edited text, not the original rewrite", () => {
    const s = run(loaded(), { type: "edit", field: "title_en", text: "Edited title" }, { type: "accept", field: "title_en" });
    assert.equal(s.accepted.title_en, "Edited title");
  });
  test("accepting is final: later edits do not change the accepted text", () => {
    const s = run(loaded(), { type: "accept", field: "title_en" }, { type: "edit", field: "title_en", text: "Changed later" });
    assert.equal(s.accepted.title_en, "Clean title");
  });
  test("accept all unflagged takes every card without a flagged word and leaves the flagged one", () => {
    const s = run(loaded(), { type: "acceptAllUnflagged" });
    assert.deepEqual(Object.keys(s.accepted).sort(), ["description_th", "title_en", "title_th"]);
    assert.equal(s.accepted.description_en, undefined);
  });
  test("progress counts accepted cards", () => {
    assert.deepEqual(progress(loaded()), { accepted: 0, total: 4 });
    assert.deepEqual(progress(run(loaded(), { type: "acceptAllUnflagged" })), { accepted: 3, total: 4 });
  });
});

describe("the review overlay", () => {
  test("close keeps the accepted state and the edits", () => {
    const s = run(loaded(), { type: "accept", field: "title_en" }, { type: "edit", field: "title_th", text: "แก้" }, { type: "close" });
    assert.equal(s.open, false);
    assert.equal(s.accepted.title_en, "Clean title");
    assert.equal(s.edits.title_th, "แก้");
    assert.equal(s.applied, false);
  });
  test("open brings it back", () => {
    assert.equal(run(loaded(), { type: "close" }, { type: "open" }).open, true);
  });
  test("done closes, marks applied, and the accepted entries are what goes into the form", () => {
    const s = run(loaded(), { type: "acceptAllUnflagged" }, { type: "done" });
    assert.equal(s.open, false);
    assert.equal(s.applied, true);
    assert.deepEqual(acceptedEntries(s), [
      { draft: "title", text: "Clean title" },
      { draft: "title_th", text: "ชื่อ" },
      { draft: "description_th", text: "คำอธิบาย" },
    ]);
  });
  test("nothing is applied before done", () => {
    assert.equal(run(loaded(), { type: "acceptAllUnflagged" }).applied, false);
  });
});
