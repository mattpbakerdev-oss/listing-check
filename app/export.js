"use client";

import { useState } from "react";
import { listingText, listingJson, leaseLine } from "../lib/export/format.js";
import { previewModel } from "../lib/preview/model.js";
import CardHead from "./card-head.js";

// The Export section is the finished listing: a card in a portal's idiom, then the ways to take it
// away. Gaps stay in their slots, named, so what is exported is what was checked.
export default function ExportPanel({ draft, result, bench, building, area, verdict, onExported, onFix }) {
  const [copied, setCopied] = useState(null);
  const text = listingText(draft, result);
  const json = () => JSON.stringify(listingJson(draft, result, bench), null, 2);
  const empty = !text.trim();
  const toFix = result.fields.filter((f) => f.status !== "ok").length;

  async function copy(kind) {
    try {
      await navigator.clipboard.writeText(kind === "text" ? text : json());
      setCopied(kind);
      onExported?.();
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied("failed");
    }
  }

  function download() {
    const blob = new Blob([json()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `listing-${(draft.building || "draft").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    onExported?.();
  }

  return (
    <section className="export card" id="export">
      <CardHead n="05" title="Export" purpose="The finished listing, ready to take away." />
      {empty ? (
        <p className="muted">Fill in the draft and the finished listing appears here, ready to copy.</p>
      ) : (
        <>
          <ListingCard draft={draft} result={result} building={building} area={area} verdict={verdict} />
          <div className="option-cards">
            <button type="button" className="option-card" onClick={() => copy("text")}>
              <span className="option-title">{copied === "text" ? "Copied" : "Copy as text"}</span>
              <span className="option-sub">The listing as it reads above, ready to paste into a portal or a chat.</span>
            </button>
            <button type="button" className="option-card" onClick={download}>
              <span className="option-title">Download JSON</span>
              <span className="option-sub">The listing and the check results, for your own system.</span>
            </button>
          </div>
          <p className="hint"><button type="button" className="linklike" onClick={() => copy("json")}>{copied === "json" ? "Copied the JSON" : "Copy as JSON"}</button> instead of downloading it.</p>
          {copied === "failed" ? <p className="fieldmsg">Copying did not work in this browser. Select the text and copy it.</p> : null}
          <p className="export-done" data-tone={result.score >= 85 ? "ok" : "warn"}>
            {result.score >= 85
              ? <strong>Ready to publish.</strong>
              : <><strong>{toFix} thing{toFix === 1 ? "" : "s"} to fix first.</strong> <a href="#results" onClick={onFix}>See what</a>.</>}
          </p>
        </>
      )}
    </section>
  );
}

// The listing as a portal would show it, compact: title, Thai title, facts row, price, station,
// description, lease line. Uses the same model as the full preview, with gaps named in place.
function ListingCard({ draft, result, building, area, verdict }) {
  const m = previewModel({ draft, fields: result.fields, score: result.score, building, area, verdict });
  const gap = (text) => <span className="pv-gap">{text}</span>;
  const facts = m.facts.filter((f) => ["bedrooms", "bathrooms", "size", "furnishing"].includes(f.id));
  const station = m.facts.find((f) => f.id === "station");
  const lease = leaseLine(draft);
  return (
    <article className="listing-card" aria-label="The finished listing">
      <h3 className="listing-title">{m.titleMissing ? gap("Title missing") : m.title}</h3>
      {draft.title_th ? <p className="listing-title-th" lang="th">{draft.title_th}</p> : null}
      <p className="listing-facts">{facts.map((f, i) => <span key={f.id}>{i ? " · " : ""}{f.missing ? gap(f.text) : f.text}</span>)}</p>
      <p className="listing-price">{m.rentMissing ? gap("Rent missing") : m.rentText}</p>
      <p className="listing-line">{m.location}{station ? <> · {station.missing ? gap(station.text) : station.text}</> : null}</p>
      {m.descriptionMissing ? <p>{gap("Description missing")}</p> : <p className="listing-desc">{m.description}</p>}
      {m.descriptionTh ? <p className="listing-desc" lang="th">{m.descriptionTh}</p> : null}
      {lease ? <p className="listing-line">{lease}</p> : null}
      {m.badges.length ? <p className="listing-chips">{m.badges.map((b) => <span key={b.id} className="chip" data-tone={b.tone}>{b.text}</span>)}</p> : null}
    </article>
  );
}
