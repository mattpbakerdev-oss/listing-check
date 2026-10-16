"use client";

import { useCallback, useRef } from "react";
import { FIELDS, remainingFlags, canAccept, progress } from "../lib/rewrite/state.js";
import { useDialog } from "./use-dialog.js";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Highlighted({ text, tokens }) {
  if (!tokens.length) return text;
  const re = new RegExp(`(${tokens.map(escapeRe).join("|")})`, "gi");
  const lower = tokens.map((t) => t.toLowerCase());
  return text.split(re).map((part, i) =>
    lower.includes(part.toLowerCase()) ? <mark key={i} title="Added by AI, check this">{part}</mark> : part,
  );
}

// Full-screen review: a sheet on phones, a centred panel on wider screens.
// Focus moves in on open and goes back to the rewrite button on close. Escape closes.
// Nothing reaches the form until "Done".
export default function ReviewOverlay({ state, dispatch, draft, onDone, returnFocusTo }) {
  const panel = useRef(null);
  const heading = useRef(null);
  const p = progress(state);
  const close = useCallback(() => dispatch({ type: "close" }), [dispatch]);
  useDialog({ open: state.open, onClose: close, panelRef: panel, headingRef: heading, returnFocusTo });

  if (!state.open || state.status !== "ready") return null;

  const unflaggedLeft = FIELDS.filter((f) => state.accepted[f.out] === undefined && remainingFlags(state, f.out).length === 0 && (state.edits[f.out] ?? "").trim()).length;

  return (
    <div className="overlay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) dispatch({ type: "close" }); }}>
      <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="review-title" ref={panel}>
        <div className="overlay-head">
          <div>
            <h2 id="review-title" ref={heading} tabIndex={-1}>Review the rewrite</h2>
            <p className="overlay-progress" aria-live="polite">{p.accepted} of {p.total} accepted</p>
          </div>
          <button type="button" className="quiet overlay-close" onClick={() => dispatch({ type: "close" })} aria-label="Close without applying">Close</button>
        </div>

        {state.data.facts_added.length ? (
          <p className="rewrite-warning">
            The AI added {state.data.facts_added.length === 1 ? "something" : "things"} not in your draft: <strong>{state.data.facts_added.join(", ")}</strong>. Highlighted below. Remove it or confirm it before accepting.
          </p>
        ) : (
          <p className="allgood">Every number and feature in the rewrite is in your draft or the building record.</p>
        )}

        <div className="overlay-cards">
          {FIELDS.map((f) => {
            const accepted = state.accepted[f.out] !== undefined;
            if (accepted) {
              return (
                <div className="rw-card rw-card-done" key={f.out}>
                  <span className="tick" aria-hidden="true">✓</span>
                  <span><strong>{f.label}</strong> accepted</span>
                </div>
              );
            }
            const original = draft[f.draft] ?? "";
            const proposed = state.data.rewrite[f.out] ?? "";
            const flagged = state.data.flagged[f.out] ?? [];
            const left = remainingFlags(state, f.out);
            return (
              <div className="rw-card" key={f.out} data-flagged={flagged.length > 0}>
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
                <textarea id={`edit_${f.out}`} lang={f.lang} rows={f.out.startsWith("title") ? 2 : 4} value={state.edits[f.out] ?? ""}
                  onChange={(e) => dispatch({ type: "edit", field: f.out, text: e.target.value })} />
                {left.length ? (
                  <label className="rw-confirm">
                    <input type="checkbox" checked={!!state.confirmed[f.out]} onChange={(e) => dispatch({ type: "confirm", field: f.out, value: e.target.checked })} />
                    <span>Still includes {left.join(", ")}. I have checked {left.length === 1 ? "it is" : "they are"} true.</span>
                  </label>
                ) : null}
                <div className="rw-actions">
                  <button type="button" onClick={() => dispatch({ type: "accept", field: f.out })} disabled={!canAccept(state, f.out)}>Accept</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="overlay-foot">
          <button type="button" className="quiet" onClick={() => dispatch({ type: "acceptAllUnflagged" })} disabled={unflaggedLeft === 0}>
            Accept all unflagged{unflaggedLeft ? ` (${unflaggedLeft})` : ""}
          </button>
          <button type="button" onClick={onDone}>Done{p.accepted ? `, apply ${p.accepted}` : ""}</button>
        </div>
      </div>
    </div>
  );
}
