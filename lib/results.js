// The results panel's words and bars. Shared by the desktop right column and the phone Check tab.
import { STEPS } from "./steps.js";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const count = (n, cap = false) => { const w = WORDS[n] ?? String(n); return cap ? w.charAt(0).toUpperCase() + w.slice(1) : w; };
const fields = (n) => `field${n === 1 ? "" : "s"}`;

export function verdictSentence({ empty, score, toFix }) {
  if (empty) return "Nothing to check yet. Start with the title, or load an example draft.";
  if (score >= 85) return toFix === 0 ? "Ready to publish. Every field is complete." : `Ready to publish. ${count(toFix, true)} ${fields(toFix)} could still improve.`;
  if (score >= 60) return `Nearly there. ${count(toFix, true)} ${fields(toFix)} ${toFix === 1 ? "is" : "are"} holding it back.`;
  return `Needs work. ${count(toFix, true)} ${fields(toFix)} ${toFix === 1 ? "is" : "are"} missing or weak.`;
}

export function groupBars(allFields) {
  return STEPS.filter((s) => s.fields.length).map((s) => {
    const own = allFields.filter((f) => s.fields.includes(f.field));
    const sum = (k) => Math.round(own.reduce((a, f) => a + f[k], 0) * 10) / 10;
    return { id: s.id, label: s.heading, earned: sum("earned"), points: sum("points"), toFix: own.filter((f) => f.status !== "ok").length, target: s.target };
  });
}
