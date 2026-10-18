"use client";

import { ringBand } from "../lib/results.js";

// The ring's band, shared with the results panel.
export const scoreBand = ringBand;

// A ring that fills by score, with the number inside. `small` is the 40px header version.
export function ScoreRing({ score, small = false }) {
  const r = 48, c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 112 112" role="img" aria-label={`Score ${score} of 100`} data-band={scoreBand(score)} data-size={small ? "small" : "large"}>
      <circle className="ring-track" cx="56" cy="56" r={r} fill="none" strokeWidth="8" />
      <circle className="ring-fill" cx="56" cy="56" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform="rotate(-90 56 56)" />
      {/* "central" puts the glyph box's true middle on y, so the number sits at the ring's centre whatever the stroke */}
      {/* Large: the number (40px, line-height 1) and "of 100" (12px) stacked with a 4px gap, the pair centred on
          the ring. Measured on the rendered ink, not the font boxes: digits 32..61, label 71..80, pair centred on 56. */}
      <text className="ring-number" x="56" y={small ? "56" : "45"} textAnchor="middle" dominantBaseline="central">{score}</text>
      {small ? null : <text className="ring-of" x="56" y="75" textAnchor="middle" dominantBaseline="central">of 100</text>}
    </svg>
  );
}
