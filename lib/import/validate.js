// Row validation for the CSV importer. Pure: takes parsed rows and the reference tables,
// returns the rows to load and the rows to skip, each skip with a reason naming the CSV row.
//
// A row is loaded if it can be stored: it has an id, it points at a known building or area,
// its numbers are numbers, its date is a date. Incomplete is fine. Missing floor, photos or
// furnishing are exactly what the completeness checker is for, so they are not import errors.

import { num } from "../completeness/rules.js";

export const LISTING_COLUMNS = [
  "listing_id", "building_id", "area_id", "title", "description_en", "description_th", "bedrooms", "bathrooms",
  "size_sqm", "floor", "monthly_rent_thb", "furnishing", "photo_count", "nearest_station", "listed_date", "status", "flaws",
];

const REQUIRED_COLUMNS = ["listing_id", "building_id", "area_id"];
const INTEGER_COLUMNS = ["bedrooms", "bathrooms", "size_sqm", "floor", "monthly_rent_thb", "photo_count"];
const POSITIVE_COLUMNS = ["size_sqm", "monthly_rent_thb"];
const STATUSES = ["active", "let"];

const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

export function validateRows(rows, reference) {
  const ok = [];
  const skipped = [];
  if (rows.length === 0) return { ok, skipped, fileError: "The file has no rows." };

  const columns = Object.keys(rows[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length) {
    return { ok, skipped, fileError: `The file is missing the column${missing.length === 1 ? "" : "s"} ${missing.join(", ")}. It needs the same columns as data/listings.csv.` };
  }

  const buildings = new Map((reference.buildings ?? []).map((b) => [b.building_id, b]));
  const areas = new Set((reference.areas ?? []).map((a) => a.area_id));
  const seen = new Set();

  rows.forEach((raw, i) => {
    const rowNumber = i + 2; // row 1 is the header
    const listingId = text(raw.listing_id);
    const skip = (reason) => skipped.push({ row: rowNumber, listing_id: listingId, reason });

    if (!listingId) return skip("listing_id is missing");
    if (seen.has(listingId)) return skip(`duplicate listing_id "${listingId}", already loaded from an earlier row`);

    const row = {};
    for (const c of LISTING_COLUMNS) row[c] = text(raw[c]);

    const building = row.building_id ? buildings.get(row.building_id) : null;
    if (row.building_id && !building) return skip(`building_id "${row.building_id}" is not in the buildings table`);
    if (row.area_id && !areas.has(row.area_id)) return skip(`area_id "${row.area_id}" is not in the areas table`);
    if (!row.area_id && building) row.area_id = building.area_id;
    if (!row.building_id && !row.area_id) return skip("needs a building_id or an area_id");

    for (const c of INTEGER_COLUMNS) {
      if (row[c] === null) continue;
      const n = num(row[c]);
      if (n === null) return skip(`${c} "${row[c]}" is not a number`);
      if (POSITIVE_COLUMNS.includes(c) && n <= 0) return skip(`${c} must be above zero`);
      row[c] = Math.round(n);
    }

    if (row.listed_date !== null) {
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(row.listed_date) && !Number.isNaN(Date.parse(row.listed_date));
      if (!ok) return skip(`listed_date "${row.listed_date}" is not a date (use YYYY-MM-DD)`);
    }

    if (row.status === null) row.status = "active";
    else if (!STATUSES.includes(row.status.toLowerCase())) return skip(`status must be active or let, not "${row.status}"`);
    else row.status = row.status.toLowerCase();

    seen.add(listingId);
    ok.push(row);
  });

  return { ok, skipped };
}
