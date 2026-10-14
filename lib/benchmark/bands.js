// Benchmark wording. Pure functions, from SPEC.md section 6.
// band(pct) turns a percentage difference into the verdict the agent reads.
// basisLabel(basis, ctx) says in words which comparables the median came from.

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
