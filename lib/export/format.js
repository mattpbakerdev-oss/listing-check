// Export formats (SPEC section 4, item 5). Pure.
//   listingText: what the agent pastes into a portal or a chat. The listing, not the report.
//   listingJson: the listings.csv columns plus the check results, for anything downstream.

import { num, present } from "../completeness/rules.js";

const baht = (n) => `฿${Math.round(n).toLocaleString("en-US")}`;
const clean = (v) => (present(v) ? String(v).trim() : null);

function bedLabel(b) {
  const n = num(b);
  if (n === null) return null;
  return n === 0 ? "Studio" : `${n} bed`;
}

export function listingText(draft, result) {
  const station = clean(draft.nearest_station) ?? result?.matched?.nearest_station ?? null;
  const baths = num(draft.bathrooms);
  const size = num(draft.size_sqm);
  const floor = num(draft.floor);
  const rent = num(draft.monthly_rent_thb);

  const facts = [
    bedLabel(draft.bedrooms),
    baths !== null ? `${baths} bath` : null,
    size !== null ? `${size} sqm` : null,
    floor !== null ? `floor ${floor}` : null,
    clean(draft.furnishing),
  ].filter(Boolean).join(" · ");

  const place = [clean(draft.building), clean(draft.area)].filter(Boolean).join(", ");
  const placeLine = [place ? `${place}.` : null, station ? `Nearest station ${station}.` : null].filter(Boolean).join(" ");

  const head = [clean(draft.title), clean(draft.title_th)].filter(Boolean).join("\n");
  const sections = [
    head,
    [facts, placeLine, rent !== null ? `${baht(rent)} a month` : null].filter(Boolean).join("\n"),
    clean(draft.description),
    clean(draft.description_th),
  ].filter(Boolean);
  return sections.join("\n\n");
}

export function listingJson(draft, result, bench) {
  const int = (v) => { const n = num(v); return n === null ? null : Math.round(n); };
  return {
    exported_at: new Date().toISOString(),
    listing: {
      listing_id: null,
      building_id: result?.matched?.building_id ?? null,
      area_id: result?.matched?.area_id ?? null,
      building: clean(draft.building),
      area: clean(draft.area),
      title: clean(draft.title),
      title_th: clean(draft.title_th),
      description_en: clean(draft.description),
      description_th: clean(draft.description_th),
      bedrooms: int(draft.bedrooms),
      bathrooms: int(draft.bathrooms),
      size_sqm: int(draft.size_sqm),
      floor: int(draft.floor),
      monthly_rent_thb: int(draft.monthly_rent_thb),
      furnishing: clean(draft.furnishing),
      photo_count: int(draft.photo_count),
      nearest_station: clean(draft.nearest_station) ?? result?.matched?.nearest_station ?? null,
      status: "active",
    },
    check: {
      score: result?.score ?? null,
      max: result?.max ?? null,
      fields: (result?.fields ?? []).map((f) => ({ field: f.field, earned: f.earned, points: f.points, status: f.status, message: f.message })),
      benchmark: bench
        ? { basis: bench.basis, n: Number(bench.n), median_rent_per_sqm: Number(bench.median_rent_per_sqm), listing_rent_per_sqm: Number(bench.listing_rent_per_sqm), pct_diff: Number(bench.pct_diff) }
        : null,
    },
  };
}
