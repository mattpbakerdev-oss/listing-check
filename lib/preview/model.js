// The draft as a tenant would see it on a rental portal, with every missing or invalid field
// kept in its slot and named, so the preview shows the holes rather than hiding them.
import { num } from "../completeness/rules.js";

const baht = (n) => `฿${Math.round(n).toLocaleString("en-US")}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const VERDICT_WORDS = {
  ok: () => "Fairly priced",
  note: (label) => `A bit ${/above/.test(label) ? "above" : "below"} market`,
  alert: (label) => `Well ${/above/.test(label) ? "above" : "below"} market`,
};

export function previewModel({ draft, fields, score, building, area, verdict, today = new Date() }) {
  const status = Object.fromEntries(fields.map((f) => [f.field, f.status]));
  const gap = (field) => status[field] === "missing" || status[field] === "invalid";
  const val = (field) => (draft[field] ?? "").toString().trim();

  const rent = num(draft.monthly_rent_thb);
  const size = num(draft.size_sqm);
  const bedrooms = num(draft.bedrooms);
  const bathrooms = num(draft.bathrooms);
  const floor = num(draft.floor);
  const station = val("nearest_station") || building?.nearest_station || "";

  const fact = (id, field, text) => (gap(field) ? { id, missing: true, text: `${LABELS[field]} missing` } : { id, missing: false, text });
  const facts = [
    fact("bedrooms", "bedrooms", bedrooms === 0 ? "Studio" : `${bedrooms} bedroom${bedrooms === 1 ? "" : "s"}`),
    fact("bathrooms", "bathrooms", `${bathrooms} bathroom${bathrooms === 1 ? "" : "s"}`),
    fact("size", "size_sqm", `${size} m²`),
    fact("floor", "floor", floor === null ? "" : `${ordinal(floor)} floor`),
    gap("monthly_rent_thb") || gap("size_sqm") ? { id: "rent_sqm", missing: true, text: gap("monthly_rent_thb") ? "Rent missing" : "Size missing" } : { id: "rent_sqm", missing: false, text: `${baht(rent / size)}/sqm` },
    fact("furnishing", "furnishing", cap(val("furnishing").toLowerCase())),
    station
      ? { id: "station", missing: false, text: building?.walk_min && !val("nearest_station") ? `${building.walk_min} min walk to ${station}` : `Near ${station}` }
      : { id: "station", missing: true, text: "Nearest station missing" },
  ];

  const photoCount = Math.max(0, Math.round(num(draft.photo_count) ?? 0));
  const details = [
    { label: "Date listed", value: today.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) },
    { label: "Property type", value: "Condo" },
    gap("floor") ? { label: "Floor", missing: true } : { label: "Floor", value: String(floor) },
    gap("bedrooms") ? { label: "Bedrooms", missing: true } : { label: "Bedrooms", value: bedrooms === 0 ? "Studio" : String(bedrooms) },
    gap("size_sqm") ? { label: "Size", missing: true } : { label: "Size", value: `${size} m²` },
    building ? { label: "Building", value: building.building_name } : gap("building") ? { label: "Building", missing: true } : { label: "Building", value: val("building") },
    ...(building?.completed_year ? [{ label: "Completed", value: String(building.completed_year) }] : []),
    ...leaseRows(draft),
  ];

  const badges = [];
  if (verdict && VERDICT_WORDS[verdict.tone]) badges.push({ id: "price", text: VERDICT_WORDS[verdict.tone](verdict.label), tone: verdict.tone });
  if (score >= 85) badges.push({ id: "complete", text: "Complete listing", tone: "ok" });

  return {
    title: val("title"),
    titleMissing: gap("title"),
    location: [building?.building_name, area?.area_name, "Bangkok"].filter(Boolean).join(", "),
    rentText: gap("monthly_rent_thb") ? null : `${baht(rent)}/month`,
    rentMissing: gap("monthly_rent_thb"),
    badges,
    photoCount,
    photoTiles: Math.min(photoCount, 5),
    facts,
    description: val("description"),
    descriptionMissing: gap("description"),
    descriptionTh: val("description_th"),
    details,
    gaps: fields.filter((f) => gap(f.field)).map((f) => ({ field: f.field, label: LABELS[f.field] })),
  };
}

// Lease terms are optional and confirmed by the agent, so an absent one is not a gap.
function leaseRows(draft) {
  const months = (n) => `${n} month${n === 1 ? "" : "s"}`;
  const rows = [];
  for (const [field, label] of [["contract_months", "Contract"], ["deposit_months", "Deposit"], ["advance_months", "Advance rent"]]) {
    const n = num(draft[field]);
    if (n !== null && n > 0) rows.push({ label, value: months(n) });
  }
  return rows;
}

const LABELS = {
  title: "Title", description: "Description", building: "Building", area: "Area", size_sqm: "Size", floor: "Floor", bedrooms: "Bedrooms",
  bathrooms: "Bathrooms", monthly_rent_thb: "Rent", furnishing: "Furnishing", photo_count: "Photos", nearest_station: "Nearest station",
};
