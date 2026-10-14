"use client";

import { useState } from "react";
import { supabaseBrowser } from "../lib/supabase/browser.js";

// Which rewrite field writes to which draft field.
const FIELDS = [
  { out: "title_en", draft: "title", label: "Title" },
  { out: "description_en", draft: "description", label: "Description" },
  { out: "title_th", draft: "title_th", label: "Thai title", lang: "th" },
  { out: "description_th", draft: "description_th", label: "Thai description", lang: "th" },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const remaining = (text, tokens) => tokens.filter((t) => new RegExp(escapeRe(t), "i").test(text));

// Split text into plain strings and <mark>s for the flagged tokens.
function Highlighted({ text, tokens }) {
  if (!tokens.length) return text;
  const re = new RegExp(`(${tokens.map(escapeRe).join("|")})`, "gi");
  const lower = tokens.map((t) => t.toLowerCase());
  return text.split(re).map((part, i) =>
    lower.includes(part.toLowerCase()) ? <mark key={i} title="Added by AI, check this">{part}</mark> : part,
  );
}

export default function RewritePanel({ draft, setDraft, canRewrite }) {
  const [state, setState] = useState({ status: "idle" });
  const [edits, setEdits] = useState({});
  const [confirmed, setConfirmed] = useState({});
  const [accepted, setAccepted] = useState({});

  async function run() {
    setState({ status: "loading" });
    setEdits({}); setConfirmed({}); setAccepted({});
    const { data, error } = await supabaseBrowser().functions.invoke("rewrite", { body: { listing: draft } });
    if (error) {
      let detail = error.message;
      try { detail = (await error.context?.json())?.error ?? detail; } catch {}
      setState({ status: "error", error: detail });
      return;
    }
    setState({ status: "ready", data });
    setEdits(Object.fromEntries(FIELDS.map((f) => [f.out, data.rewrite[f.out] ?? ""])));
  }

  function accept(f) {
    const text = edits[f.out] ?? "";
    setDraft((d) => ({ ...d, [f.draft]: text }));
    setAccepted((a) => ({ ...a, [f.out]: true }));
    if (state.data.log_id && Object.keys(accepted).length === 0) {
      supabaseBrowser().functions.invoke("rewrite", { body: { action: "accept", log_id: state.data.log_id, accepted: true } });
    }
  }

  return (
    <section className="rewrite" id="rewrite">
      <div className="rewrite-head">
        <h2>AI rewrite</h2>
        <button type="button" onClick={run} disabled={!canRewrite || state.status === "loading"}>
          {state.status === "loading" ? "Rewriting…" : state.status === "ready" ? "Rewrite again" : "Rewrite with AI"}
        </button>
      </div>
      {!canRewrite ? <p className="muted">Add a title or a description and a known building first.</p> : null}
      {state.status === "idle" && canRewrite ? (
        <p className="muted">Cleaner English and a Thai version, using only the facts in your draft and the building record. Nothing is applied until you accept it.</p>
      ) : null}
      {state.status === "loading" ? <p className="muted">Writing from your draft and the building record. Usually 10 to 20 seconds.</p> : null}
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

          {FIELDS.map((f) => {
            const original = draft[f.draft] ?? "";
            const proposed = state.data.rewrite[f.out] ?? "";
            const flagged = state.data.flagged[f.out] ?? [];
            const edited = edits[f.out] ?? "";
            const left = remaining(edited, flagged);
            const canAccept = !accepted[f.out] && edited.trim() && (left.length === 0 || confirmed[f.out]);
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
                  onChange={(e) => setEdits((x) => ({ ...x, [f.out]: e.target.value }))} disabled={accepted[f.out]} />
                {left.length ? (
                  <label className="rw-confirm">
                    <input type="checkbox" checked={!!confirmed[f.out]} onChange={(e) => setConfirmed((c) => ({ ...c, [f.out]: e.target.checked }))} />
                    <span>Still includes {left.join(", ")}. I have checked {left.length === 1 ? "it is" : "they are"} true.</span>
                  </label>
                ) : null}
                <div className="rw-actions">
                  <button type="button" onClick={() => accept(f)} disabled={!canAccept}>
                    {accepted[f.out] ? "Accepted" : `Accept ${f.label.toLowerCase()}`}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      ) : null}
    </section>
  );
}
