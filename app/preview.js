"use client";

import { useRef, useState } from "react";
import { previewModel } from "../lib/preview/model.js";
import { useDialog } from "./use-dialog.js";

// The draft as it would read on a rental portal: a sample layout in a portal's idiom, not ours.
// Gaps stay in their slots and are named, so the agent sees the holes a tenant would see.
export default function PreviewOverlay({ open, onClose, draft, result, building, area, verdict, returnFocusTo }) {
  const panel = useRef(null);
  const heading = useRef(null);
  const [showGaps, setShowGaps] = useState(true);
  useDialog({ open, onClose, panelRef: panel, headingRef: heading, returnFocusTo });
  if (!open) return null;

  const m = previewModel({ draft, fields: result.fields, score: result.score, building, area, verdict });
  const gap = (text, as = "span") => (showGaps ? <Gap text={text} as={as} /> : null);

  return (
    <div className="overlay-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay preview" role="dialog" aria-modal="true" aria-labelledby="preview-title" ref={panel}>
        <div className="overlay-head">
          <div>
            <h2 id="preview-title" ref={heading} tabIndex={-1}>Preview as a listing</h2>
            <p className="overlay-progress">How the draft would read on a rental portal. A sample layout, not a real page.</p>
          </div>
          <div className="form-actions">
            <label className="toggle">
              <input type="checkbox" checked={showGaps} onChange={(e) => setShowGaps(e.target.checked)} />
              <span>Show gaps{m.gaps.length ? ` (${m.gaps.length})` : ""}</span>
            </label>
            <button type="button" className="quiet" onClick={onClose} aria-label="Close the preview">Close</button>
          </div>
        </div>

        <article className="portal" aria-label="Listing preview">
          <header className="portal-head">
            <h3 className="portal-title">{m.titleMissing ? (showGaps ? <Gap text="Title missing" /> : "\u2014") : m.title}</h3>
            <p className="portal-location">{m.location}</p>
            <p className="portal-rent">{m.rentMissing ? gap("Rent missing") : m.rentText}</p>
            {m.badges.length ? (
              <p className="portal-badges">{m.badges.map((b) => <span key={b.id} className="portal-badge" data-tone={b.tone}>{b.text}</span>)}</p>
            ) : null}
          </header>

          <div className="portal-body">
            <div className="portal-main">
              <div className="portal-photos" data-count={m.photoTiles} aria-label={`${m.photoCount} photo${m.photoCount === 1 ? "" : "s"}`}>
                {m.photoTiles === 0
                  ? (showGaps ? <Gap text="No photos" as="div" /> : <div className="portal-photo" />)
                  : Array.from({ length: m.photoTiles }, (_, i) => (
                    <div key={i} className="portal-photo">
                      {i === m.photoTiles - 1 && m.photoCount > m.photoTiles ? `Show all ${m.photoCount} photos` : `Photo ${i + 1}`}
                    </div>
                  ))}
              </div>

              <ul className="portal-facts">
                {m.facts.map((f) => (f.missing ? (showGaps ? <li key={f.id}><Gap text={f.text} /></li> : null) : <li key={f.id}>{f.text}</li>))}
              </ul>

              <section className="portal-about">
                <h4>About this listing</h4>
                {m.descriptionMissing ? gap("Description missing", "p") : <p>{m.description}</p>}
                {m.descriptionTh ? <p lang="th">{m.descriptionTh}</p> : null}
              </section>

              <dl className="portal-details">
                {m.details.map((d) => (
                  <div key={d.label}>
                    <dt>{d.label}</dt>
                    <dd>{d.missing ? (showGaps ? <Gap text={`${d.label} missing`} /> : "\u2014") : d.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <aside className="portal-contact" aria-label="Sample enquiry form, not functional">
              <p className="portal-contact-title">Interested in this property?</p>
              <input type="text" placeholder="Name" disabled aria-label="Name (sample)" />
              <input type="text" placeholder="Phone number" disabled aria-label="Phone (sample)" />
              <input type="text" placeholder="Email" disabled aria-label="Email (sample)" />
              <button type="button" className="portal-send" disabled>Send enquiry</button>
            </aside>
          </div>
        </article>
      </div>
    </div>
  );
}

function Gap({ text, as: As = "span" }) {
  return <As className="pv-gap">{text}</As>;
}
