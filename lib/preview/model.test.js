import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { previewModel, ordinal } from "./model.js";

const ALL = ["title", "description", "building", "area", "size_sqm", "floor", "bedrooms", "bathrooms", "monthly_rent_thb", "furnishing", "photo_count", "nearest_station"];
const fields = (statuses) => ALL.map((field) => ({ field, status: statuses[field] ?? "ok" }));
const building = { building_name: "Rhythm Rangnam", nearest_station: "BTS Victory Monument", walk_min: 3, completed_year: 2018, tier: "mid" };
const area = { area_name: "Ratchathewi / Phaya Thai" };
const full = {
  title: "1 BED RHYTHM RANGNAM FOR RENT", description: "Nice room.", description_th: "ห้องสวย", building: "Rhythm Rangnam", area: "Ratchathewi / Phaya Thai",
  size_sqm: "28", floor: "6", bedrooms: "1", bathrooms: "1", monthly_rent_thb: "17000", furnishing: "fully furnished", photo_count: "3", nearest_station: "",
};

describe("previewModel: the draft as a portal listing page, with its gaps named", () => {
  test("header: title, location line, rent per month", () => {
    const m = previewModel({ draft: full, fields: fields({}), score: 90, building, area, verdict: null });
    assert.equal(m.title, "1 BED RHYTHM RANGNAM FOR RENT");
    assert.equal(m.location, "Rhythm Rangnam, Ratchathewi / Phaya Thai, Bangkok");
    assert.equal(m.rentText, "฿17,000/month");
  });

  test("facts strip in portal wording, station from the building with walking minutes", () => {
    const m = previewModel({ draft: full, fields: fields({}), score: 90, building, area, verdict: null });
    const byId = Object.fromEntries(m.facts.map((f) => [f.id, f]));
    assert.equal(byId.bedrooms.text, "1 bedroom");
    assert.equal(byId.bathrooms.text, "1 bathroom");
    assert.equal(byId.size.text, "28 m²");
    assert.equal(byId.floor.text, "6th floor");
    assert.equal(byId.rent_sqm.text, "฿607/sqm");
    assert.equal(byId.furnishing.text, "Fully furnished");
    assert.equal(byId.station.text, "3 min walk to BTS Victory Monument");
    assert.ok(m.facts.every((f) => !f.missing));
  });

  test("studio and plurals", () => {
    const m = previewModel({ draft: { ...full, bedrooms: "0", bathrooms: "2" }, fields: fields({}), score: 90, building, area, verdict: null });
    const byId = Object.fromEntries(m.facts.map((f) => [f.id, f]));
    assert.equal(byId.bedrooms.text, "Studio");
    assert.equal(byId.bathrooms.text, "2 bathrooms");
  });

  test("ordinals", () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 40].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "40th"]);
  });

  test("a missing or invalid field is a named gap in its slot; a partial one is not", () => {
    const draft = { ...full, floor: "", bathrooms: "", monthly_rent_thb: "abc" };
    const m = previewModel({ draft, fields: fields({ floor: "missing", bathrooms: "missing", monthly_rent_thb: "invalid", title: "partial" }), score: 60, building, area, verdict: null });
    const byId = Object.fromEntries(m.facts.map((f) => [f.id, f]));
    assert.equal(byId.floor.missing, true);
    assert.equal(byId.floor.text, "Floor missing");
    assert.equal(byId.bathrooms.missing, true);
    assert.equal(byId.rent_sqm.missing, true);
    assert.equal(m.rentText, null);
    assert.equal(m.rentMissing, true);
    assert.equal(m.titleMissing, false);
    assert.deepEqual(m.gaps.map((g) => g.field), ["floor", "bathrooms", "monthly_rent_thb"]);
  });

  test("no title, no description, no photos", () => {
    const m = previewModel({ draft: { ...full, title: "", description: "", description_th: "", photo_count: "0" }, fields: fields({ title: "missing", description: "missing", photo_count: "missing" }), score: 50, building, area, verdict: null });
    assert.equal(m.titleMissing, true);
    assert.equal(m.description, "");
    assert.equal(m.descriptionMissing, true);
    assert.equal(m.descriptionTh, "");
    assert.equal(m.photoCount, 0);
    assert.equal(m.photoTiles, 0);
  });

  test("photo tiles cap at five and say how many there are", () => {
    assert.equal(previewModel({ draft: { ...full, photo_count: "12" }, fields: fields({}), score: 90, building, area, verdict: null }).photoTiles, 5);
    assert.equal(previewModel({ draft: { ...full, photo_count: "12" }, fields: fields({}), score: 90, building, area, verdict: null }).photoCount, 12);
  });

  test("badges: price verdict in portal words, and complete at 85 or more", () => {
    let m = previewModel({ draft: full, fields: fields({}), score: 90, building, area, verdict: { tone: "ok", label: "about right" } });
    assert.deepEqual(m.badges.map((b) => b.text), ["Fairly priced", "Complete listing"]);
    m = previewModel({ draft: full, fields: fields({}), score: 70, building, area, verdict: { tone: "alert", label: "well above market, check for a typo" } });
    assert.deepEqual(m.badges.map((b) => [b.text, b.tone]), [["Well above market", "alert"]]);
    m = previewModel({ draft: full, fields: fields({}), score: 70, building, area, verdict: { tone: "note", label: "a bit below similar listings" } });
    assert.deepEqual(m.badges.map((b) => b.text), ["A bit below market"]);
    m = previewModel({ draft: full, fields: fields({}), score: 70, building, area, verdict: null });
    assert.deepEqual(m.badges, []);
  });

  test("details table: listed today, condo, floor, bedrooms, size, building and year; gaps named", () => {
    const m = previewModel({ draft: { ...full, floor: "" }, fields: fields({ floor: "missing" }), score: 80, building, area, verdict: null, today: new Date("2026-10-16") });
    const byLabel = Object.fromEntries(m.details.map((d) => [d.label, d]));
    assert.equal(byLabel["Date listed"].value, "16 October 2026");
    assert.equal(byLabel["Property type"].value, "Condo");
    assert.equal(byLabel.Floor.missing, true);
    assert.equal(byLabel.Bedrooms.value, "1");
    assert.equal(byLabel.Size.value, "28 m²");
    assert.equal(byLabel.Building.value, "Rhythm Rangnam");
    assert.equal(byLabel.Completed.value, "2018");
  });

  test("no building matched: location falls back to the typed area, station to the typed one, no year", () => {
    const m = previewModel({ draft: { ...full, building: "Somewhere", nearest_station: "BTS Asok" }, fields: fields({ building: "invalid" }), score: 80, building: null, area, verdict: null });
    assert.equal(m.location, "Ratchathewi / Phaya Thai, Bangkok");
    const byId = Object.fromEntries(m.facts.map((f) => [f.id, f]));
    assert.equal(byId.station.text, "Near BTS Asok");
    assert.equal(m.details.find((d) => d.label === "Completed"), undefined);
  });
});
