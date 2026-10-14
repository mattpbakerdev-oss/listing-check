"use client";

import { useReducer } from "react";
import { supabaseBrowser } from "../lib/supabase/browser.js";
import { reducer, initialState, progress, acceptedEntries } from "../lib/rewrite/state.js";
import ReviewOverlay from "./review-overlay.js";

// The panel is remounted (key change) whenever the draft is replaced, so Clear and the
// example buttons also clear any rewrite in progress. See lib/rewrite/state.js.
export default function RewritePanel({ draft, setDraft, canRewrite }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const thaiEmpty = !(draft.description_th ?? "").trim() && !(draft.title_th ?? "").trim();

  async function run() {
    dispatch({ type: "start" });
    const { data, error } = await supabaseBrowser().functions.invoke("rewrite", { body: { listing: draft } });
    if (error) {
      let detail = error.message;
      try { detail = (await error.context?.json())?.error ?? detail; } catch {}
      dispatch({ type: "failed", error: detail });
      return;
    }
    dispatch({ type: "loaded", data });
  }

  function done() {
    const entries = acceptedEntries(state);
    if (entries.length) {
      setDraft((d) => ({ ...d, ...Object.fromEntries(entries.map((e) => [e.draft, e.text])) }));
      if (state.data.log_id && !state.applied) {
        supabaseBrowser().functions.invoke("rewrite", { body: { action: "accept", log_id: state.data.log_id, accepted: true } });
      }
    }
    dispatch({ type: "done" });
  }

  const p = progress(state);
  const label = state.status === "loading" ? "Rewriting…"
    : state.status === "ready" ? "Rewrite again"
    : thaiEmpty ? "Rewrite with AI and add a Thai version" : "Rewrite with AI";

  return (
    <section className="rewrite" id="rewrite">
      <div className="rewrite-head">
        <h2>AI rewrite</h2>
        <div className="form-actions">
          {state.status === "ready" && !state.open ? (
            <button type="button" onClick={() => dispatch({ type: "open" })}>Review the rewrite</button>
          ) : null}
          <button type="button" id="rewrite-button" className={state.status === "ready" ? "quiet" : ""} onClick={run} disabled={!canRewrite || state.status === "loading"}>
            {label}
          </button>
        </div>
      </div>
      {!canRewrite ? <p className="muted">Add a title or a description and a known building first.</p> : null}
      {state.status === "idle" && canRewrite ? (
        <p className="muted">Cleaner English and a Thai version, using only the facts in your draft and the building record. You review each part and nothing is applied until you say so.</p>
      ) : null}
      {state.status === "loading" ? <p className="muted">Writing from your draft and the building record. Usually 5 to 10 seconds.</p> : null}
      {state.status === "error" ? <p className="fieldmsg">The rewrite did not come back. {state.error}</p> : null}
      {state.status === "ready" && !state.open ? (
        <p className="muted">
          {p.accepted} of {p.total} accepted{state.applied ? " and applied to the form" : ", not yet applied"}.
          {state.data.facts_added.length ? ` The AI added: ${state.data.facts_added.join(", ")}.` : " Nothing added that was not in your draft."}
        </p>
      ) : null}

      <ReviewOverlay state={state} dispatch={dispatch} draft={draft} onDone={done} returnFocusTo="rewrite-button" />
    </section>
  );
}
