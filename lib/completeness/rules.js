// Completeness rules. This is the one file to edit when the scoring changes.
// Source: SPEC.md section 5. Points add to 100.
//
// Each rule has a field, a label for the UI, its points, and a check(input, ctx) that returns
//   { ratio: 0..1, status?: "ok" | "partial" | "missing" | "invalid", message: string }
// The engine (score.js) multiplies ratio by points. Only three rules give partial credit:
// title length, description length and photo count. Everything else is all or nothing.
//
// ctx = { reference: { buildings, areas }, building: matched building row or null, area: matched area row or null }

// ---------- tunables ----------

export const TITLE = {
  minChars: 20,
  maxChars: 80,
  lengthPoints: 6,   // linear: 0 at 0 chars, full at minChars, full to maxChars, then declines to 0 at 2*maxChars
  placePoints: 2,    // names a known building (or alias) or area
  capsPoints: 2,     // not written in ALL CAPS
};

export const DESCRIPTION = {
  minChars: 150,
  lengthPoints: 10,  // linear to minChars. A 120-char description earns 8, the example in the spec.
  mentionPoints: 5,  // at least two of the mentions below
  mentionsNeeded: 2,
  mentions: [
    { name: "floor", pattern: /\bfloors?\b|\bfl\.?\s*\d|ชั้น/i },
    { name: "view", pattern: /\bviews?\b|วิว/i },
    { name: "furnishing", pattern: /furnish|ตกแต่ง|ห้องเปล่า/i },
    { name: "nearest station", pattern: /\b(bts|mrt|arl|srt|station)\b|รถไฟฟ้า|สถานี/i },
  ],
};

export const FURNISHING_VALUES = ["unfurnished", "partly furnished", "fully furnished"];

export const PHOTOS = { full: 5 }; // linear partial credit below this

export const RANGES = {
  size_sqm: { lo: 20, hi: 400, unit: " sqm" },
  floor: { lo: 1, hi: 80, unit: "" },
  bedrooms: { lo: 0, hi: 5, unit: "" },
  bathrooms: { lo: 1, hi: 5, unit: "" },
  monthly_rent_thb: { lo: 5000, hi: 500000, unit: " THB" },
};

// ---------- helpers ----------

export const present = (v) => !(v === null || v === undefined || String(v).trim() === "");

export const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");

export function num(v) {
  if (!present(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function matchBuilding(value, buildings = []) {
  if (!present(value)) return null;
  const q = norm(value);
  return buildings.find((b) => norm(b.building_name) === q || (b.aliases ?? []).some((a) => norm(a) === q)) ?? null;
}

export function matchArea(value, areas = []) {
  if (!present(value)) return null;
  const q = norm(value);
  return areas.find((a) => norm(a.area_id) === q || norm(a.area_name) === q || String(a.area_name).split("/").map(norm).includes(q)) ?? null;
}

function titleNamesPlace(title, reference) {
  const t = norm(title);
  const names = [];
  for (const b of reference.buildings ?? []) names.push(b.building_name, ...(b.aliases ?? []));
  for (const a of reference.areas ?? []) names.push(a.area_name, ...String(a.area_name).split("/"));
  return names.some((n) => present(n) && t.includes(norm(n)));
}

function isAllCaps(s) {
  const letters = s.replace(/[^a-z]/gi, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
}

const missing = (label) => ({ ratio: 0, status: "missing", message: `${label} is missing.` });

function rangeRule(field, label, points) {
  const { lo, hi, unit } = RANGES[field];
  return {
    field, label, points,
    check(input) {
      const raw = input[field];
      if (!present(raw)) return missing(label);
      const n = num(raw);
      if (n === null) return { ratio: 0, status: "invalid", message: `${label} must be a number.` };
      if (n < lo || n > hi) return { ratio: 0, status: "invalid", message: `${label} should be between ${lo.toLocaleString()} and ${hi.toLocaleString()}${unit}.` };
      return { ratio: 1, message: "" };
    },
  };
}

// ---------- the rules ----------

export const RULES = [
  {
    field: "title", label: "Title", points: 10,
    check(input, ctx) {
      const t = String(input.title ?? "").trim();
      if (!t) return missing("Title");
      const len = t.length;
      const lengthRatio = len < TITLE.minChars ? len / TITLE.minChars
        : len <= TITLE.maxChars ? 1
        : Math.max(0, 1 - (len - TITLE.maxChars) / TITLE.maxChars);
      const namesPlace = titleNamesPlace(t, ctx.reference);
      const caps = isAllCaps(t);
      const earned = TITLE.lengthPoints * lengthRatio + (namesPlace ? TITLE.placePoints : 0) + (caps ? 0 : TITLE.capsPoints);
      const notes = [];
      if (len < TITLE.minChars) notes.push(`Too short (${len} of ${TITLE.minChars} characters).`);
      if (len > TITLE.maxChars) notes.push(`Too long (${len} characters, keep it under ${TITLE.maxChars}).`);
      if (!namesPlace) notes.push("Name the building or the area.");
      if (caps) notes.push("Avoid ALL CAPS.");
      return { ratio: earned / this.points, message: notes.join(" ") };
    },
  },
  {
    field: "description", label: "Description", points: 15,
    check(input) {
      const d = String(input.description ?? "").trim();
      if (!d) return missing("Description");
      const lengthRatio = Math.min(1, d.length / DESCRIPTION.minChars);
      const found = DESCRIPTION.mentions.filter((m) => m.pattern.test(d)).map((m) => m.name);
      const mentionsOk = found.length >= DESCRIPTION.mentionsNeeded;
      const earned = DESCRIPTION.lengthPoints * lengthRatio + (mentionsOk ? DESCRIPTION.mentionPoints : 0);
      // Say what to add, not how many characters are missing.
      const want = DESCRIPTION.mentions.map((m) => m.name).filter((n) => !found.includes(n));
      const list = (xs) => { const t = xs.map((x) => `the ${x}`); return t.length <= 1 ? t.join("") : `${t.slice(0, -1).join(", ")} or ${t[t.length - 1]}`; };
      let message = "";
      if (d.length < DESCRIPTION.minChars) {
        message = want.length ? `Too short. Mention ${list(want)}.` : "Too short. Add a sentence or two more.";
      } else if (!mentionsOk) {
        message = `Mention at least ${DESCRIPTION.mentionsNeeded} of: ${DESCRIPTION.mentions.map((m) => m.name).join(", ")}.`;
      }
      return { ratio: earned / this.points, message };
    },
  },
  {
    field: "building", label: "Building", points: 10,
    check(input, ctx) {
      if (!present(input.building)) return missing("Building");
      if (!ctx.building) return { ratio: 0, status: "invalid", message: "Not a building we know. Check the spelling or pick from the list." };
      return { ratio: 1, message: "" };
    },
  },
  {
    field: "area", label: "Area", points: 5,
    check(input, ctx) {
      if (!present(input.area)) return missing("Area");
      if (!ctx.area) return { ratio: 0, status: "invalid", message: "Not an area we know. Pick from the list." };
      return { ratio: 1, message: "" };
    },
  },
  rangeRule("size_sqm", "Size (sqm)", 10),
  rangeRule("floor", "Floor", 8),
  rangeRule("bedrooms", "Bedrooms", 5),
  rangeRule("bathrooms", "Bathrooms", 5),
  rangeRule("monthly_rent_thb", "Monthly rent", 10),
  {
    field: "furnishing", label: "Furnishing", points: 5,
    check(input) {
      if (!present(input.furnishing)) return missing("Furnishing");
      if (!FURNISHING_VALUES.includes(norm(input.furnishing))) {
        return { ratio: 0, status: "invalid", message: `Use one of: ${FURNISHING_VALUES.join(", ")}.` };
      }
      return { ratio: 1, message: "" };
    },
  },
  {
    field: "photo_count", label: "Photos", points: 10,
    check(input) {
      if (!present(input.photo_count)) return missing("Photo count");
      const n = num(input.photo_count);
      if (n === null || n < 0) return { ratio: 0, status: "invalid", message: "Photo count must be a number." };
      if (n === 0) return { ratio: 0, status: "missing", message: `No photos. Add at least ${PHOTOS.full}.` };
      const ratio = Math.min(1, n / PHOTOS.full);
      return { ratio, message: ratio < 1 ? `Only ${n} photo${n === 1 ? "" : "s"}. Add at least ${PHOTOS.full}.` : "" };
    },
  },
  {
    field: "nearest_station", label: "Nearest station", points: 7,
    check(input, ctx) {
      if (present(input.nearest_station)) return { ratio: 1, message: "" };
      if (ctx.building?.nearest_station) {
        return { ratio: 1, message: `Filled in from ${ctx.building.building_name}: ${ctx.building.nearest_station}.` };
      }
      return { ratio: 0, status: "missing", message: "Nearest station is missing, and we could not work it out from the building." };
    },
  },
];
