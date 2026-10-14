import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lineFor } from "./stations.js";

describe("lineFor: which line a station is on, with its colour", () => {
  test("BTS Sukhumvit line stations", () => {
    for (const s of ["BTS Thong Lo", "BTS Ekkamai", "BTS Phrom Phong", "BTS Asok", "BTS Nana", "BTS Phra Khanong", "BTS On Nut", "BTS Ari", "BTS Victory Monument", "BTS Phaya Thai", "BTS Ratchathewi", "BTS Bang Na", "BTS Udom Suk", "BTS Punnawithi", "BTS Ha Yaek Lat Phrao"]) {
      assert.equal(lineFor(s).name, "BTS Sukhumvit line", s);
    }
    assert.equal(lineFor("BTS Asok").colour, "#7cb342");
  });
  test("BTS Silom line stations", () => {
    for (const s of ["BTS Chong Nonsi", "BTS Sala Daeng", "BTS Surasak", "BTS Saint Louis"]) assert.equal(lineFor(s).name, "BTS Silom line", s);
    assert.equal(lineFor("BTS Chong Nonsi").colour, "#00703c");
  });
  test("MRT Blue line stations", () => {
    for (const s of ["MRT Sukhumvit", "MRT Phra Ram 9", "MRT Phetchaburi", "MRT Phahon Yothin", "MRT Huai Khwang"]) assert.equal(lineFor(s).name, "MRT Blue line", s);
    assert.equal(lineFor("MRT Sukhumvit").colour, "#1e4d9c");
  });
  test("an unknown station still gets a network from its prefix, and no colour", () => {
    assert.deepEqual(lineFor("BTS Somewhere New"), { name: "BTS", colour: null });
    assert.deepEqual(lineFor("MRT Elsewhere"), { name: "MRT", colour: null });
  });
  test("nothing for a blank", () => assert.equal(lineFor(""), null));
});
