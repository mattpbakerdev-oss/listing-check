"use client";

import { useState } from "react";
import { listingText, listingJson } from "../lib/export/format.js";

export default function ExportPanel({ draft, result, bench, onExported }) {
  const [copied, setCopied] = useState(null);
  const text = listingText(draft, result);
  const json = () => JSON.stringify(listingJson(draft, result, bench), null, 2);
  const empty = !text.trim();

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
      <div className="rewrite-head">
        <h2>Export</h2>
        <div className="form-actions">
          <button type="button" onClick={() => copy("text")} disabled={empty}>{copied === "text" ? "Copied" : "Copy as text"}</button>
          <button type="button" className="quiet" onClick={() => copy("json")} disabled={empty}>{copied === "json" ? "Copied" : "Copy as JSON"}</button>
          <button type="button" className="quiet" onClick={download} disabled={empty}>Download JSON</button>
        </div>
      </div>
      {copied === "failed" ? <p className="fieldmsg">Copying did not work in this browser. Select the text below and copy it.</p> : null}
      {empty ? (
        <p className="muted">Fill in the draft and the finished listing appears here, ready to paste.</p>
      ) : (
        <textarea className="export-text" readOnly rows={Math.min(16, text.split("\n").length + 1)} value={text} aria-label="Finished listing as text" />
      )}
    </section>
  );
}
