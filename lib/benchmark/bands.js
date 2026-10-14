// Benchmark wording. Pure functions, from SPEC.md section 6.
// band(pct) turns a percentage difference into the verdict the agent reads.
// basisLabel(basis, ctx) says in words which comparables the median came from.

// Fewer comparables than this and the app gives no verdict, only the area's published band.
// The SQL chain already falls back to broader groups until it finds 8, so this only bites
// when the whole area has under 8 priced listings.
export const MIN_COMPARABLES = 8;

// Short form for the phone strip: "price ok", "price high", "price low", "price typo?"
export function shortVerdict(b) {
  if (!b) return "";
  if (b.tone === "ok") return "price ok";
  if (b.tone === "alert") return "price typo?";
  return b.label.startsWith("above") ? "price high" : "price low";
}

export function band(pct) {
  const p = Number(pct);
  if (pct === null || pct === undefined || !Number.isFinite(p)) return null;
  const size = Math.abs(p);
  if (size <= 10) return { label: "about right", tone: "ok" };
  const dir = p > 0 ? "above" : "below";
  if (size <= 25) return { label: `${dir} market`, tone: "warn" };
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
