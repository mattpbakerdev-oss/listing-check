"use client";

import { useReducer } from "react";
import { supabaseBrowser } from "../lib/supabase/browser.js";
import { reducer, initialState, FIELDS, remainingFlags, canAccept, progress, acceptedEntries } from "../lib/rewrite/state.js";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Split text into plain strings and <mark>s for the flagged tokens.
function Highlighted({ text, tokens }) {
  if (!tokens.length) return text;
  const re = new RegExp(`(${tokens.map(escapeRe).join("|")})`, "gi");
  const lower = tokens.map((t) => t.toLowerCase());
  return text.split(re).map((part, i) =>
    lower.includes(part.toLowerCase()) ? <mark key={i} title="Added by AI, check this">{part}</mark> : part,
  );
}

// The panel is remounted (key change) whenever the draft is replaced, so Clear and the
// example buttons also clear any rewrite in progress. See lib/rewrite/state.js.
export default function RewritePanel({ draft, setDraft, canRewrite }) {
  const [state, dispatch] = useReducer(reducer, initialState);

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

  return (
    <section className="rewrite" id="rewrite">
      <div className="rewrite-head">
        <h2>AI rewrite</h2>
        <button type="button" id="rewrite-button" onClick={run} disabled={!canRewrite || state.status === "loading"}>
          {state.status === "loading" ? "Rewriting…" : state.status === "ready" ? "Rewrite again" : "Rewrite with AI"}
        </button>
      </div>
      {!canRewrite ? <p className="muted">Add a title or a description and a known building first.</p> : null}
      {state.status === "idle" && canRewrite ? (
        <p className="muted">Cleaner English and a Thai version, using only the facts in your draft and the building record. Nothing is applied until you accept it.</p>
      ) : null}
      {state.status === "loading" ? <p className="muted">Writing from your draft and the building record. Usually 5 to 10 seconds.</p> : null}
      {state.status === "error" ? <p className="fieldmsg">The rewrite did not come back. {state.error}</p> : null}

      {state.status === "ready" ? (
        <>
          {state.data.facts_added.length ? (
            <p className="rewrite-warning">
              The AI added {state.data.facts_added.length === 1 ? "something" : "things"} not in your draft: <strong>{state.data.facts_added.join(", ")}</strong>. Each is highlighted below. Remove it or confirm it before accepting.
            </p>
          ) : (
            <p className="allgood">Every number and feature in the rewrite is in your draft or the building record.</p>
          )}
          <p className="muted">{p.accepted} of {p.total} accepted{state.applied ? ", applied to the form" : ""}.</p>

          {FIELDS.map((f) => {
            const original = draft[f.draft] ?? "";
            const proposed = state.data.rewrite[f.out] ?? "";
            const flagged = state.data.flagged[f.out] ?? [];
            const edited = state.edits[f.out] ?? "";
            const left = remainingFlags(state, f.out);
            const accepted = state.accepted[f.out] !== undefined;
            return (
              <div className="rw-field" key={f.out} data-flagged={flagged.length > 0}>
                <h3>{f.label}</h3>
                <div className="rw-compare">
                  <div>
                    <p className="rw-caption">Your draft</p>
                    <p className="rw-text" lang={f.lang}>{original || <span className="muted">Empty</span>}</p>
                  </div>
                  <div>
                    <p className="rw-caption">Rewrite</p>
                    <p className="rw-text" lang={f.lang}><Highlighted text={proposed} tokens={flagged} /></p>
                  </div>
                </div>
                <label className="label" htmlFor={`edit_${f.out}`}>Edit before accepting</label>
                <textarea id={`edit_${f.out}`} lang={f.lang} rows={f.out.startsWith("title") ? 2 : 4} value={edited}
                  onChange={(e) => dispatch({ type: "edit", field: f.out, text: e.target.value })} disabled={accepted} />
                {left.length && !accepted ? (
                  <label className="rw-confirm">
                    <input type="checkbox" checked={!!state.confirmed[f.out]} onChange={(e) => dispatch({ type: "confirm", field: f.out, value: e.target.checked })} />
                    <span>Still includes {left.join(", ")}. I have checked {left.length === 1 ? "it is" : "they are"} true.</span>
                  </label>
                ) : null}
                <div className="rw-actions">
                  <button type="button" onClick={() => dispatch({ type: "accept", field: f.out })} disabled={!canAccept(state, f.out)}>
                    {accepted ? "Accepted" : `Accept ${f.label.toLowerCase()}`}
                  </button>
                </div>
              </div>
            );
          })}

          <div className="rw-actions">
            <button type="button" className="quiet" onClick={() => dispatch({ type: "acceptAllUnflagged" })}>Accept all unflagged</button>
            <button type="button" onClick={done} disabled={state.applied}>{state.applied ? "Applied" : "Apply accepted to the form"}</button>
          </div>
        </>
      ) : null}
    </section>
  );
}
