"use client";

// One heading per card, the same on both layouts: a small-caps eyebrow "01 · THE LISTING" with the
// status mark on the right (green tick when every field in the card is ok, amber "N to fix"
// otherwise, nothing on a blank draft), and one line on what the card is for.
export default function CardHead({ n, title, purpose, chip }) {
  return (
    <div className="card-head" aria-hidden="true">
      <div className="card-head-row">
        <span className="eyebrow"><span className="marker">{n}</span> {title}</span>
        {chip === null || chip === undefined ? null : chip === 0 ? <span className="chip" data-tone="ok">✓</span> : <span className="chip" data-tone="warn">{chip} to fix</span>}
      </div>
      <p className="card-purpose">{purpose}</p>
    </div>
  );
}
