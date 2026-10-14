// Rewrite guardrail (SPEC section 7). Pure, no I/O.
//
// Every number and every amenity or feature word in the model's output must already appear
// in the agent's draft or in the building record. Anything else is "added by AI" and comes
// back flagged so the agent has to remove or confirm it before accepting.
//
// Features are matched by concept, with English and Thai synonyms, so a balcony mentioned in
// the Thai draft is allowed in the English rewrite and vice versa.
//
// Shared between the Deno edge function and Node tests (erasable TypeScript only).

export type Rewrite = {
  title_en: string;
  description_en: string;
  title_th: string;
  description_th: string;
  facts_used?: string[];
};

export type ListingInput = {
  title?: string | null;
  description?: string | null;
  description_th?: string | null;
  building?: string | null;
  area?: string | null;
  size_sqm?: number | string | null;
  floor?: number | string | null;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  monthly_rent_thb?: number | string | null;
  furnishing?: string | null;
  photo_count?: number | string | null;
  nearest_station?: string | null;
};

export type BuildingRecord = {
  building_name?: string | null;
  area_name?: string | null;
  nearest_station?: string | null;
  walk_min?: number | null;
  completed_year?: number | null;
} | null;

export const OUTPUT_FIELDS = ["title_en", "description_en", "title_th", "description_th"] as const;
export type OutputField = (typeof OUTPUT_FIELDS)[number];

export type FactCheckResult = {
  facts_added: string[];
  flagged: Record<OutputField, string[]>;
};

// Each concept: English phrases (matched as whole words, case-insensitive) and Thai substrings.
// Longer phrases are listed first so "swimming pool" wins over "pool".
const CONCEPTS: { id: string; en: string[]; th: string[] }[] = [
  { id: "pool", en: ["swimming pool", "pool"], th: ["สระว่ายน้ำ", "สระ"] },
  { id: "gym", en: ["fitness centre", "fitness center", "fitness", "gym"], th: ["ฟิตเนส", "ยิม"] },
  { id: "sauna", en: ["steam room", "sauna"], th: ["ซาวน่า"] },
  { id: "parking", en: ["car park", "parking"], th: ["ที่จอดรถ", "จอดรถ"] },
  { id: "balcony", en: ["balconies", "balcony"], th: ["ระเบียง"] },
  { id: "bathtub", en: ["bath tub", "bathtub", "tub"], th: ["อ่างอาบน้ำ"] },
  { id: "washing machine", en: ["washing machine", "washer"], th: ["เครื่องซักผ้า"] },
  { id: "dryer", en: ["tumble dryer", "dryer"], th: ["เครื่องอบผ้า"] },
  { id: "river view", en: ["river view", "river glimpse", "riverside", "river"], th: ["วิวแม่น้ำ", "แม่น้ำ"] },
  { id: "city view", en: ["city views", "city view"], th: ["วิวเมือง"] },
  { id: "pool view", en: ["pool view"], th: ["วิวสระ"] },
  { id: "garden view", en: ["garden view"], th: ["วิวสวน"] },
  { id: "garden", en: ["gardens", "garden"], th: ["สวน"] },
  { id: "unblocked view", en: ["unblocked view", "unobstructed view", "open view"], th: ["วิวไม่บล็อก", "วิวโล่ง"] },
  { id: "quiet", en: ["quiet side", "quiet"], th: ["ฝั่งเงียบ", "เงียบ"] },
  { id: "rooftop", en: ["rooftop", "roof top", "sky lounge", "sky garden"], th: ["ดาดฟ้า", "รูฟท็อป"] },
  { id: "security", en: ["24-hour security", "24 hour security", "security", "cctv", "key card", "keycard"], th: ["รักษาความปลอดภัย", "กล้องวงจรปิด", "คีย์การ์ด", "รปภ"] },
  { id: "lift", en: ["lift", "elevator"], th: ["ลิฟต์", "ลิฟท์"] },
  { id: "pets", en: ["pet-friendly", "pet friendly", "pets allowed", "pets", "pet"], th: ["เลี้ยงสัตว์", "สัตว์เลี้ยง"] },
  { id: "kitchen", en: ["kitchenette", "kitchen"], th: ["ครัว"] },
  { id: "cooking", en: ["microwave", "oven", "stove", "hob"], th: ["ไมโครเวฟ", "เตาอบ", "เตา"] },
  { id: "internet", en: ["wi-fi", "wifi", "internet", "fibre", "fiber"], th: ["ไวไฟ", "อินเทอร์เน็ต"] },
  { id: "coworking", en: ["co-working", "coworking", "library", "meeting room"], th: ["โคเวิร์กกิ้ง", "ห้องสมุด"] },
  { id: "playground", en: ["playground"], th: ["สนามเด็กเล่น"] },
  { id: "shuttle", en: ["shuttle", "tuk-tuk", "tuk tuk"], th: ["รถรับส่ง", "ตุ๊กตุ๊ก"] },
  { id: "corner unit", en: ["corner unit", "corner room"], th: ["ห้องมุม"] },
  { id: "high ceiling", en: ["high ceilings", "high ceiling", "double height"], th: ["เพดานสูง"] },
  { id: "renovated", en: ["newly renovated", "renovated", "refurbished"], th: ["รีโนเวท", "ปรับปรุงใหม่"] },
  { id: "wardrobe", en: ["walk-in wardrobe", "walk-in closet", "built-in wardrobe", "wardrobe"], th: ["ตู้เสื้อผ้า", "วอล์คอิน"] },
  { id: "duplex", en: ["duplex", "penthouse", "loft"], th: ["ดูเพล็กซ์", "เพนท์เฮาส์", "ลอฟท์"] },
  { id: "bbq", en: ["barbecue", "bbq", "jacuzzi", "spa"], th: ["บาร์บีคิว", "จากุซซี่", "สปา"] },
  { id: "lobby", en: ["concierge", "lobby", "reception"], th: ["ล็อบบี้"] },
  { id: "fully furnished", en: ["fully furnished", "fully-furnished"], th: ["ตกแต่งครบ", "เฟอร์ครบ"] },
  { id: "partly furnished", en: ["partly furnished", "partially furnished", "semi-furnished", "semi furnished"], th: ["ตกแต่งบางส่วน"] },
  { id: "unfurnished", en: ["unfurnished"], th: ["ห้องเปล่า", "ไม่มีเฟอร์"] },
  { id: "new building", en: ["brand new", "new building", "newly built"], th: ["ตึกใหม่"] },
  { id: "shops", en: ["shopping mall", "mall", "supermarket", "7-eleven", "convenience store", "restaurants", "cafes"], th: ["ห้าง", "ซูเปอร์", "เซเว่น", "ร้านอาหาร"] },
  { id: "school", en: ["international school", "school", "university", "hospital"], th: ["โรงเรียน", "มหาวิทยาลัย", "โรงพยาบาล"] },
  { id: "expressway", en: ["expressway", "tollway", "highway"], th: ["ทางด่วน"] },
  { id: "airport", en: ["airport link", "airport"], th: ["สนามบิน"] },
  { id: "smart home", en: ["smart home", "digital door lock", "digital lock"], th: ["ดิจิตอลล็อค", "สมาร์ทโฮม"] },
  { id: "air conditioning", en: ["air conditioning", "air-conditioning", "aircon", "air con"], th: ["แอร์"] },
  { id: "appliances", en: ["television", "tv", "fridge", "refrigerator", "water heater"], th: ["ทีวี", "ตู้เย็น", "เครื่องทำน้ำอุ่น"] },
];

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const toAsciiDigits = (s: string) => s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));

// "35,000" -> "35000"; "2.5" stays; "45," is "45".
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of toAsciiDigits(text).matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) out.push(m[0].replace(/,/g, ""));
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

type Hit = { index: number; length: number; token: string; concept: string };

function findConcepts(text: string): Hit[] {
  const hits: Hit[] = [];
  const taken: boolean[] = new Array(text.length).fill(false);
  const claim = (index: number, length: number, token: string, concept: string) => {
    for (let i = index; i < index + length; i++) if (taken[i]) return;
    for (let i = index; i < index + length; i++) taken[i] = true;
    hits.push({ index, length, token, concept });
  };
  // Longest phrases first across all concepts so "pool view" is claimed before "pool".
  const phrases: { phrase: string; concept: string; thai: boolean }[] = [];
  for (const c of CONCEPTS) {
    for (const p of c.en) phrases.push({ phrase: p, concept: c.id, thai: false });
    for (const p of c.th) phrases.push({ phrase: p, concept: c.id, thai: true });
  }
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);
  for (const { phrase, concept, thai } of phrases) {
    const re = thai ? new RegExp(escapeRe(phrase), "g") : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase)}(?![\\p{L}\\p{N}])`, "giu");
    for (const m of text.matchAll(re)) claim(m.index!, m[0].length, thai ? m[0] : m[0].toLowerCase(), concept);
  }
  return hits.sort((a, b) => a.index - b.index);
}

export function factCheck(rewrite: Partial<Rewrite>, listing: ListingInput, building: BuildingRecord): FactCheckResult {
  const inputText = [
    listing.title, listing.description, listing.description_th, listing.building, listing.area,
    listing.furnishing, listing.nearest_station,
    building?.building_name, building?.area_name, building?.nearest_station,
  ].map(str).join("\n");

  const allowedNumbers = new Set<string>(extractNumbers(inputText));
  for (const v of [listing.size_sqm, listing.floor, listing.bedrooms, listing.bathrooms, listing.monthly_rent_thb, listing.photo_count, building?.walk_min, building?.completed_year]) {
    for (const n of extractNumbers(str(v))) allowedNumbers.add(n);
  }
  const allowedConcepts = new Set(findConcepts(inputText).map((h) => h.concept));

  const flagged = { title_en: [], description_en: [], title_th: [], description_th: [] } as Record<OutputField, string[]>;
  const factsAdded: string[] = [];
  const noteAdded = (token: string) => { if (!factsAdded.includes(token)) factsAdded.push(token); };

  for (const field of OUTPUT_FIELDS) {
    const text = str(rewrite[field]);
    const hits: { index: number; token: string }[] = [];
    for (const m of toAsciiDigits(text).matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) {
      const n = m[0].replace(/,/g, "");
      if (!allowedNumbers.has(n)) hits.push({ index: m.index!, token: n });
    }
    for (const h of findConcepts(text)) {
      if (!allowedConcepts.has(h.concept)) hits.push({ index: h.index, token: h.token });
    }
    hits.sort((a, b) => a.index - b.index);
    const seen = new Set<string>();
    for (const h of hits) {
      if (seen.has(h.token)) continue;
      seen.add(h.token);
      flagged[field].push(h.token);
      noteAdded(h.token);
    }
  }

  return { facts_added: factsAdded, flagged };
}
