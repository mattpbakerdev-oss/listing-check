// Tests for the rewrite guardrail (SPEC section 7), written before the implementation.
// Runs under Node's test runner with type stripping, and the same file is imported by the Deno edge function.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { factCheck, extractNumbers, type Rewrite } from "./factcheck.ts";

const listing = {
  title: "1 bed at The Met, 45 sqm, near BTS Chong Nonsi",
  description: "Bright one-bedroom on floor 12 at The Met with an unblocked city view. Fully furnished with a washing machine. 1 year contract, 2 months deposit.",
  description_th: "",
  building: "The Met",
  area: "Sathorn / Chong Nonsi",
  size_sqm: 45,
  floor: 12,
  bedrooms: 1,
  bathrooms: 1,
  monthly_rent_thb: 35000,
  furnishing: "fully furnished",
  photo_count: 8,
  nearest_station: "BTS Chong Nonsi",
};

const building = {
  building_name: "The Met",
  area_name: "Sathorn / Chong Nonsi",
  nearest_station: "BTS Chong Nonsi",
  walk_min: 10,
  completed_year: 2008,
};

const clean: Rewrite = {
  title_en: "Furnished 1-bed at The Met, 45 sqm, 12th floor, near BTS Chong Nonsi",
  description_en: "A bright one-bedroom of 45 sqm on the 12th floor of The Met in Sathorn. Fully furnished with a washing machine and an unblocked city view. About 10 minutes' walk to BTS Chong Nonsi. 35,000 THB a month, one year contract, two months deposit.",
  title_th: "ให้เช่า 1 ห้องนอน The Met 45 ตร.ม. ชั้น 12 ใกล้ BTS ช่องนนทรี",
  description_th: "ห้อง 1 ห้องนอน 45 ตร.ม. ชั้น 12 ที่ The Met สาทร ตกแต่งครบ มีเครื่องซักผ้า วิวเมืองไม่บล็อก เดิน 10 นาทีถึง BTS ช่องนนทรี 35,000 บาทต่อเดือน สัญญา 1 ปี มัดจำ 2 เดือน",
  facts_used: [],
};

describe("extractNumbers", () => {
  test("finds integers, strips thousands separators, keeps decimals", () => {
    assert.deepEqual(extractNumbers("45 sqm, 35,000 THB, 2.5 km, floor 12"), ["45", "35000", "2.5", "12"]);
  });
  test("handles Thai digits as plain digits", () => {
    assert.deepEqual(extractNumbers("ชั้น ๑๒"), ["12"]);
  });
});

describe("factCheck passes a faithful rewrite", () => {
  test("no facts added when every number and feature is in the input or the building record", () => {
    const r = factCheck(clean, listing, building);
    assert.deepEqual(r.facts_added, []);
    assert.deepEqual(r.flagged, { title_en: [], description_en: [], title_th: [], description_th: [] });
  });
});

describe("factCheck flags numbers not in the input", () => {
  test("a walking time that is not the building's walk_min", () => {
    const r = factCheck({ ...clean, description_en: clean.description_en.replace("About 10 minutes", "About 5 minutes") }, listing, building);
    assert.deepEqual(r.flagged.description_en, ["5"]);
    assert.ok(r.facts_added.includes("5"));
  });
  test("a made-up year, even though completed_year is allowed", () => {
    const r = factCheck({ ...clean, description_en: clean.description_en + " Renovated in 2021." }, listing, building);
    assert.ok(r.flagged.description_en.includes("2021"));
    assert.ok(r.flagged.description_en.includes("renovated"));
  });
  test("numbers in the input text, like '1 year' and '2 months', are allowed", () => {
    const r = factCheck({ ...clean, description_en: "Contract 1 year, deposit 2 months." }, listing, building);
    assert.deepEqual(r.flagged.description_en, []);
  });
  test("the same number is reported once per field", () => {
    const r = factCheck({ ...clean, description_en: "Only 5 minutes one way and 5 minutes the other." }, listing, building);
    assert.deepEqual(r.flagged.description_en, ["5"]);
  });
});

describe("factCheck flags amenities and features not in the input", () => {
  test("pool and gym added in English", () => {
    const r = factCheck({ ...clean, description_en: clean.description_en + " The building has a pool and a gym." }, listing, building);
    assert.deepEqual(r.flagged.description_en, ["pool", "gym"]);
    assert.deepEqual(r.facts_added, ["pool", "gym"]);
  });
  test("pool added in Thai is flagged with the Thai word", () => {
    const r = factCheck({ ...clean, description_th: clean.description_th + " มีสระว่ายน้ำ" }, listing, building);
    assert.deepEqual(r.flagged.description_th, ["สระว่ายน้ำ"]);
    assert.deepEqual(r.facts_added, ["สระว่ายน้ำ"]);
  });
  test("a feature mentioned in the Thai draft is allowed in the English rewrite", () => {
    const withThai = { ...listing, description_th: "มีระเบียง วิวเมือง" };
    const r = factCheck({ ...clean, description_en: clean.description_en + " There is a balcony." }, withThai, building);
    assert.deepEqual(r.flagged.description_en, []);
  });
  test("matching is case-insensitive and covers plurals and phrases", () => {
    const r = factCheck({ ...clean, title_en: "Pet-friendly 1-bed with Bathtub at The Met, 45 sqm" }, listing, building);
    assert.deepEqual(r.flagged.title_en, ["pet-friendly", "bathtub"]);
  });
  test("a view type not in the input is flagged, the input's view type is not", () => {
    const r = factCheck({ ...clean, description_en: clean.description_en.replace("city view", "river view") }, listing, building);
    assert.deepEqual(r.flagged.description_en, ["river view"]);
  });
  test("furnishing level is a fact: 'unfurnished' is flagged when the input says fully furnished", () => {
    const r = factCheck({ ...clean, description_en: clean.description_en.replace("Fully furnished", "Unfurnished") }, listing, building);
    assert.deepEqual(r.flagged.description_en, ["unfurnished"]);
  });
});

describe("factCheck is robust to missing data", () => {
  test("no building record: building facts are not allowed", () => {
    const r = factCheck(clean, listing, null);
    assert.ok(r.flagged.description_en.includes("10"));
  });
  test("missing output fields are treated as empty", () => {
    const r = factCheck({ title_en: "1 bed at The Met, 45 sqm" } as Rewrite, listing, building);
    assert.deepEqual(r.flagged.description_en, []);
    assert.deepEqual(r.facts_added, []);
  });
});
