// Draft autosave rules. Pure, so the restore/discard logic is testable without a browser.
// The checker saves the form to localStorage (see storage.js) and drives this reducer.

export const STORAGE_KEY = "listing-check.draft.v1";
const VERSION = 1;

export const initialState = Object.freeze({
  offer: false,     // show "You have an unfinished draft... Restore / Discard"
  offered: null,    // { draft, savedAt } being offered
  savedAt: null,    // when the current form was last written to storage
});

// `ignore`: fields that do not count as content, such as the unscored lease terms.
export function isEmptyDraft(draft, ignore = []) {
  if (!draft) return true;
  return Object.entries(draft).every(([k, v]) => ignore.includes(k) || v === null || v === undefined || String(v).trim() === "");
}

export function relativeTime(then, now = Date.now()) {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 2) return "yesterday";
  return `${d} days ago`;
}

export function serialize(draft, at) {
  return JSON.stringify({ v: VERSION, savedAt: at, draft });
}

export function parse(text) {
  if (typeof text !== "string") return null;
  try {
    const obj = JSON.parse(text);
    if (!obj || obj.v !== VERSION || typeof obj.draft !== "object" || obj.draft === null) return null;
    const draft = {};
    for (const [k, v] of Object.entries(obj.draft)) {
      if (typeof v === "string") draft[k] = v;
      else if (typeof v === "number") draft[k] = String(v);
    }
    const savedAt = Number(obj.savedAt);
    return { draft, savedAt: Number.isFinite(savedAt) ? savedAt : null };
  } catch {
    return null;
  }
}

export function reducer(state, action) {
  switch (action.type) {
    case "init": {
      const stored = action.stored && !isEmptyDraft(action.stored.draft) ? action.stored : null;
      const offer = Boolean(stored && action.formEmpty);
      return { ...state, offer, offered: offer ? stored : null };
    }
    case "restore":
      return { offer: false, offered: null, savedAt: state.offered?.savedAt ?? null };
    case "discard":
      return { offer: false, offered: null, savedAt: null };
    case "saved":
      return { offer: false, offered: null, savedAt: action.at };
    case "cleared":
      return { offer: false, offered: null, savedAt: null };
    default:
      return state;
  }
}
