// State for reviewing an AI rewrite. Pure reducer so the rules are testable without React.
//
// The panel component dispatches these actions; nothing reaches the form until "done",
// and only the fields the agent accepted. Clear and the example buttons remount the
// panel, which is the same as "reset".

export const FIELDS = [
  { out: "title_en", draft: "title", label: "Title" },
  { out: "description_en", draft: "description", label: "Description" },
  { out: "title_th", draft: "title_th", label: "Thai title", lang: "th" },
  { out: "description_th", draft: "description_th", label: "Thai description", lang: "th" },
];

export const initialState = Object.freeze({
  status: "idle",   // idle | loading | ready | error
  data: null,       // the function's response: { log_id, rewrite, flagged, facts_added, ... }
  error: null,
  edits: {},        // out field -> current text in the edit box
  confirmed: {},    // out field -> agent ticked "I have checked it"
  accepted: {},     // out field -> text as accepted
  open: false,      // review overlay showing
  applied: false,   // "done" pressed; accepted entries were put into the form
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function remainingFlags(state, field) {
  const tokens = state.data?.flagged?.[field] ?? [];
  const text = state.edits[field] ?? "";
  return tokens.filter((t) => new RegExp(escapeRe(t), "i").test(text));
}

export function canAccept(state, field) {
  if (state.status !== "ready" || state.accepted[field] !== undefined) return false;
  if (!(state.edits[field] ?? "").trim()) return false;
  return remainingFlags(state, field).length === 0 || Boolean(state.confirmed[field]);
}

export function progress(state) {
  return { accepted: Object.keys(state.accepted).length, total: FIELDS.length };
}

export function acceptedEntries(state) {
  return FIELDS.filter((f) => state.accepted[f.out] !== undefined).map((f) => ({ draft: f.draft, text: state.accepted[f.out] }));
}

export function reducer(state, action) {
  switch (action.type) {
    case "reset":
      return initialState;
    case "start":
      return { ...initialState, status: "loading" };
    case "loaded":
      return {
        ...initialState,
        status: "ready",
        data: action.data,
        edits: Object.fromEntries(FIELDS.map((f) => [f.out, action.data?.rewrite?.[f.out] ?? ""])),
        open: true,
      };
    case "failed":
      return { ...initialState, status: "error", error: action.error };
    case "edit":
      if (state.accepted[action.field] !== undefined) return { ...state, edits: { ...state.edits, [action.field]: action.text } };
      return { ...state, edits: { ...state.edits, [action.field]: action.text } };
    case "confirm":
      return { ...state, confirmed: { ...state.confirmed, [action.field]: Boolean(action.value) } };
    case "accept":
      if (!canAccept(state, action.field)) return state;
      return { ...state, accepted: { ...state.accepted, [action.field]: state.edits[action.field] } };
    case "acceptAllUnflagged": {
      const accepted = { ...state.accepted };
      for (const f of FIELDS) {
        if (accepted[f.out] === undefined && remainingFlags(state, f.out).length === 0 && (state.edits[f.out] ?? "").trim()) {
          accepted[f.out] = state.edits[f.out];
        }
      }
      return { ...state, accepted };
    }
    case "open":
      return state.status === "ready" ? { ...state, open: true } : state;
    case "close":
      return { ...state, open: false };
    case "done":
      return { ...state, open: false, applied: true };
    default:
      return state;
  }
}
