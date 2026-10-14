// Completeness score: a pure function over a draft listing and the reference tables.
// No database, no UI. The rules live in rules.js.
//
// scoreListing(input, reference) -> {
//   score: integer 0..100,
//   max: 100,
//   fields: [{ field, label, points, earned, status, message }],   one per rule, in rule order
//   matched: { building_id, area_id, nearest_station },             what we resolved, for the UI and the benchmark
// }
//
// input: { title, description, description_th?, building, area, size_sqm, floor, bedrooms, bathrooms,
//          monthly_rent_thb, furnishing, photo_count, nearest_station }  values may be strings from a form
// reference: { buildings: [{ building_id, building_name, area_id, nearest_station, aliases }], areas: [{ area_id, area_name }] }

import { RULES, matchArea, matchBuilding, present } from "./rules.js";

export const MAX_SCORE = RULES.reduce((sum, r) => sum + r.points, 0);

const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const round2 = (x) => Math.round(x * 100) / 100;

export function scoreListing(input = {}, reference = {}) {
  const ref = { buildings: reference.buildings ?? [], areas: reference.areas ?? [] };
  const building = matchBuilding(input.building, ref.buildings);
  const area = matchArea(input.area, ref.areas);
  const ctx = { reference: ref, building, area };

  const fields = RULES.map((rule) => {
    const result = rule.check(input, ctx);
    const ratio = clamp01(result.ratio);
    const earned = round2(rule.points * ratio);
    const status = result.status ?? (ratio >= 1 ? "ok" : ratio > 0 ? "partial" : "missing");
    return { field: rule.field, label: rule.label, points: rule.points, earned, status, message: result.message ?? "" };
  });

  const total = fields.reduce((sum, f) => sum + f.earned, 0);

  return {
    score: Math.round(total),
    max: MAX_SCORE,
    fields,
    matched: {
      building_id: building?.building_id ?? null,
      area_id: area?.area_id ?? null,
      nearest_station: present(input.nearest_station) ? String(input.nearest_station).trim() : building?.nearest_station ?? null,
    },
  };
}
