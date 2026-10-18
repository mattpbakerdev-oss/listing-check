"use client";

import { useReducer, useRef } from "react";
import { supabaseBrowser } from "../lib/supabase/browser.js";
import { reducer, initialState, progress, acceptedEntries, FIELDS } from "../lib/rewrite/state.js";
import { projectedGain } from "../lib/rewrite/gain.js";
import ReviewOverlay from "./review-overlay.js";
import CardHead from "./card-head.js";

// The Rewrite section is a page in its own right, on phones a whole tab: before a rewrite it shows
// what will be rewritten and what that is worth; after one it shows the four results, what was
// accepted, and the points it actually recovered. The overlay is where editing happens.
// The panel is remounted (key change) whenever the draft is replaced, so Clear and the example
// buttons also clear any rewrite in progress. See lib/rewrite/state.js.
export default function RewritePanel({ draft, setDraft, canRewrite, onApplied, result, onNext }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const baseline = useRef(null); // the score just before accepted text went into the form
  const thaiEmpty = !(draft.description_th ?? "").trim() && !(draft.title_th ?? "").trim();
  const gain = projectedGain(result.fields);

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
      if (baseline.current === null) baseline.current = result.score;
      setDraft((d) => ({ ...d, ...Object.fromEntries(entries.map((e) => [e.draft, e.text])) }));
      onApplied?.();
      if (state.data.log_id && !state.applied) {
        supabaseBrowser().functions.invoke("rewrite", { body: { action: "accept", log_id: state.data.log_id, accepted: true } });
      }
    }
    dispatch({ type: "done" });
  }

  const p = progress(state);
  const realised = state.applied && baseline.current !== null ? Math.round(result.score - baseline.current) : null;
  const label = state.status === "loading" ? "Rewriting…" : thaiEmpty ? "Rewrite with AI and add a Thai version" : "Rewrite with AI";

  return (
    <section className="rewrite card" id="rewrite">
      <div className="rewrite-head">
        <CardHead n="04" title="AI rewrite" purpose="Cleaner English and a Thai version, from your draft only." />
        {state.status === "ready" ? (
          <div className="form-actions">
            <button type="button" className="quiet" onClick={() => dispatch({ type: "open" })}>{state.applied ? "Review again" : "Review the rewrite"}</button>
            <button type="button" id="rewrite-button" className="quiet" onClick={run} disabled={!canRewrite || state.status === "loading"}>Rewrite again</button>
          </div>
        ) : null}
      </div>

      {state.status !== "ready" ? (
        <>
          <p className="muted">Cleaner English and a Thai version, written only from the facts in your draft and the building record.</p>
          <div className="rw-preview" aria-label="What will be rewritten">
            <p className="rw-caption">Your title</p>
            <p className="rw-dim">{draft.title.trim() || <span className="muted">Empty</span>}</p>
            <p className="rw-caption">Your description</p>
            <p className="rw-dim">{draft.description.trim() || <span className="muted">Empty</span>}</p>
          </div>
          {gain.points > 0 ? (
            <p className="rw-gain">Worth up to <strong>{gain.points} more points</strong>. A rewrite usually recovers most of that.</p>
          ) : (
            <p className="rw-gain">The title and description already have full marks. A rewrite can still tidy the wording and add Thai.</p>
          )}
          <div className="form-actions">
            <button type="button" id="rewrite-button" onClick={run} disabled={!canRewrite || state.status === "loading"}>{label}</button>
          </div>
          {!canRewrite ? <p className="muted">Add a title or a description and a known building first.</p> : null}
          {state.status === "loading" ? <p className="muted">Writing from your draft and the building record. Usually 5 to 10 seconds.</p> : null}
          {state.status === "error" ? <p className="fieldmsg">The rewrite did not come back. {state.error}</p> : null}
          <p className="hint">Guardrail: every number and feature in the rewrite is checked against your draft. Anything added is highlighted for you to remove or confirm, and nothing is applied until you accept it.</p>
        </>
      ) : (
        <>
          <ul className="rw-rows">
            {FIELDS.map((f) => {
              const accepted = state.accepted[f.out] !== undefined;
              const before = (draft[f.draft] ?? "").trim();
              const after = accepted ? state.accepted[f.out] : (state.data.rewrite[f.out] ?? "");
              return (
                <li key={f.out} data-accepted={accepted}>
                  <span className="rw-row-head"><span className={accepted ? "tick" : "muted"} aria-hidden="true">{accepted ? "✓" : "·"}</span> {f.label}{accepted ? ", accepted" : ""}</span>
                  {before && !accepted ? <span className="rw-dim" lang={f.lang}>{before}</span> : null}
                  <span className="rw-after" lang={f.lang}>{after}</span>
                </li>
              );
            })}
          </ul>
          <p className="rw-gain">
            {state.applied
              ? <>{realised !== null && realised > 0 ? <strong>+{realised} applied</strong> : <strong>Applied</strong>}, {p.accepted} of {p.total} accepted.</>
              : <>{p.accepted} of {p.total} accepted, not yet applied.</>}
            {state.data.facts_added.length ? ` The AI added: ${state.data.facts_added.join(", ")}.` : " Nothing added that was not in your draft."}
          </p>
          <div className="form-actions">
            {state.applied ? <button type="button" onClick={onNext}>Next: Export</button> : <button type="button" onClick={() => dispatch({ type: "open" })}>Review the rewrite</button>}
          </div>
        </>
      )}

      <ReviewOverlay state={state} dispatch={dispatch} draft={draft} onDone={done} returnFocusTo="rewrite-button" />
    </section>
  );
}
