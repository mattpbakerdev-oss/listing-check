// The five stages of checking a listing, in order, and which are done.
// Steps 1 to 3 are done when every field in that card scores ok. Step 4 is done once a rewrite
// has been applied to the form, step 5 once the listing has been copied or downloaded. The
// current step is the first one not done; nothing is hidden behind it, it is a guide.

export const STEPS = Object.freeze([
  { id: "listing", n: 1, label: "Listing", heading: "The listing", target: "title", fields: ["title", "description"] },
  { id: "unit", n: 2, label: "Unit", heading: "The unit", target: "building", fields: ["building", "area", "size_sqm", "floor", "bedrooms", "bathrooms", "furnishing", "nearest_station"] },
  { id: "price", n: 3, label: "Price & photos", heading: "Price and photos", target: "monthly_rent_thb", fields: ["monthly_rent_thb", "photo_count"] },
  { id: "rewrite", n: 4, label: "Rewrite", heading: "AI rewrite", target: "rewrite", fields: [] },
  { id: "export", n: 5, label: "Export", heading: "Export", target: "export", fields: [] },
]);

export function stepStatuses(fields, { applied = false, exported = false } = {}) {
  const ok = new Set(fields.filter((f) => f.status === "ok").map((f) => f.field));
  const done = STEPS.map((s) => {
    if (s.id === "rewrite") return Boolean(applied);
    if (s.id === "export") return Boolean(exported);
    return s.fields.every((f) => ok.has(f));
  });
  const current = done.indexOf(false);
  return STEPS.map((s, i) => ({ ...s, status: done[i] ? "done" : i === current ? "current" : "todo" }));
}
