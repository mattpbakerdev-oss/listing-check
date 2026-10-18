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
      <text className="ring-number" x="56" y={small ? "56" : "58"} textAnchor="middle" dominantBaseline="middle">{score}</text>
      {small ? null : <text className="ring-of" x="56" y="80" textAnchor="middle">of 100</text>}
    </svg>
  );
}
