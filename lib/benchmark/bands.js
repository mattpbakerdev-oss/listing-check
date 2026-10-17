// Benchmark wording. Pure functions, from SPEC.md section 6.
// band(pct) turns a percentage difference into the verdict the agent reads.
// basisLabel(basis, ctx) says in words which comparables the median came from.

// Fewer comparables than this and the app gives no verdict, only the area's published band.
// The SQL chain already falls back to broader groups until it finds 8, so this only bites
// when the whole area has under 8 priced listings.
export const MIN_COMPARABLES = 8;

// Short form for the phone strip: "price ok", "a bit high", "a bit low", "price typo?"
export function shortVerdict(b) {
  if (!b) return "";
  if (b.tone === "ok") return "price ok";
  if (b.tone === "alert") return "price typo?";
  return b.label.includes("above") ? "a bit high" : "a bit low";
}

// Tones: "ok" (green), "note" (no warning colour), "alert" (red).
// The 10 to 25% band is a note, not a warning: with a few hundred listings the medians are
// noisy enough that a third of fair prices land there (BUILD_LOG, 14 Oct 2026). Only the
// over-25% band, where almost no fair price lands, gets red.
export function band(pct) {
  const p = Number(pct);
  if (pct === null || pct === undefined || !Number.isFinite(p)) return null;
  const size = Math.abs(p);
  if (size <= 10) return { label: "about right", tone: "ok" };
  const dir = p > 0 ? "above" : "below";
  if (size <= 25) return { label: `a bit ${dir} similar listings`, tone: "note" };
  return { label: `well ${dir} market, check for a typo`, tone: "alert" };
}

export const bedLabel = (bedrooms) => (Number(bedrooms) === 0 ? "studios" : `${bedrooms}-bed units`);

export function basisLabel(basis, { buildingName, areaName, tier, bedrooms }) {
  switch (basis) {
    case "building_bedrooms":
      return `${bedLabel(bedrooms)} in ${buildingName}`;
    case "area_tier_bedrooms":
      return `${bedLabel(bedrooms)} in ${tier} buildings in ${areaName}`;
    case "area_tier":
      return `${tier} buildings in ${areaName}`;
    default:
      return `all listings in ${areaName}`;
  }
}

// The chain does not slice by distance to a station: measured on 17 Oct 2026 it bought nothing on
// the sample, whose prices carry no proximity effect. So the price check says how far this
// building is and lets the agent weigh it.
export function proximityNote(building) {
  if (!building || building.walk_min === null || building.walk_min === undefined) return null;
  const n = Number(building.walk_min);
  const article = /^(8|11|18)\b/.test(String(n)) ? "an" : "a";
  return `Comparables are not filtered by distance to a station. ${building.building_name} is ${article} ${n} minute walk from ${building.nearest_station}.`;
}
