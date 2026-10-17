"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { reducer as autosaveReducer, initialState as autosaveInitial, isEmptyDraft, relativeTime } from "../lib/drafts/autosave.js";
import { readDraft, writeDraft, removeDraft } from "../lib/drafts/storage.js";
import { scoreListing } from "../lib/completeness/score.js";
import { num } from "../lib/completeness/rules.js";
import { band, basisLabel, shortVerdict, MIN_COMPARABLES, proximityNote } from "../lib/benchmark/bands.js";
import { supabaseBrowser } from "../lib/supabase/browser.js";
import { lineFor } from "../lib/stations.js";
import { stepStatuses } from "../lib/steps.js";
import { TABS, tabForTarget } from "../lib/tabs.js";
import RewritePanel from "./rewrite.js";
import ExportPanel from "./export.js";
import PreviewOverlay from "./preview.js";

const EMPTY = {
  title: "", description: "", description_th: "", title_th: "", building: "", area: "", size_sqm: "", floor: "",
  bedrooms: "", bathrooms: "", monthly_rent_thb: "", furnishing: "", photo_count: "", nearest_station: "",
  // Lease terms: optional, confirmed by the agent, not scored. The rewrite may state them once set.
  contract_months: "", deposit_months: "", advance_months: "",
};
const USUAL_TERMS = { contract_months: "12", deposit_months: "2", advance_months: "1" };

// A rushed draft with a fair price: caps title, thin description, no floor or bathrooms, three photos.
// Rhythm Rangnam 1-beds at 28 sqm for 17,000 sit on the median for mid-tier Ratchathewi (sample L0036).
const EXAMPLE = {
  ...EMPTY,
  title: "1 BED RHYTHM RANGNAM FOR RENT",
  description: "Nice room, fully furnished, ready to move in. Call for details.",
  building: "Rhythm Rangnam",
  area: "Ratchathewi / Phaya Thai",
  size_sqm: "28",
  bedrooms: "1",
  monthly_rent_thb: "17000",
  furnishing: "fully furnished",
  photo_count: "3",
};

// The same kind of draft, priced about 40% above its comparables.
const MISPRICED = {
  ...EMPTY,
  title: "1 BED FOR RENT NOBLE REFINE PHROM PHONG",
  description: "Nice room, fully furnished, ready to move in. Near BTS. Call for details.",
  description_th: "ให้เช่า Noble Refine ตกแต่งครบ พร้อมเข้าอยู่",
  building: "Noble Refine",
  area: "Phrom Phong",
  size_sqm: "35",
  bedrooms: "1",
  bathrooms: "1",
  monthly_rent_thb: "39000",
  furnishing: "fully furnished",
  photo_count: "3",
};

const baht = (n) => `฿${Math.round(Number(n)).toLocaleString("en-US")}`;
const formatPts = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function Checker({ reference }) {
  const [draft, setDraft] = useState(EMPTY);
  // Bumped whenever the whole draft is replaced (Clear, example buttons). The rewrite panel
  // is keyed on it, so it remounts with no rewrite, no edits and nothing accepted.
  const [session, setSession] = useState(0);
  // Steps 4 and 5 of the stepper: a rewrite has been applied, the listing has been copied or downloaded.
  const [applied, setApplied] = useState(false);
  const [exported, setExported] = useState(false);
  const [preview, setPreview] = useState(null); // id of the button that opened it, for focus return
  // Phone tabs. Desktop ignores this: the CSS only hides sections under 900px.
  const [tab, setTab] = useState("draft");
  const [pendingScroll, setPendingScroll] = useState(null);
  const autosave = useAutosave(draft);
  // Clear and the example buttons replace the whole draft and forget the saved one.
  const loadDraft = (d) => { autosave.forget(); setDraft(d); setSession((s) => s + 1); setApplied(false); setExported(false); };
  const restoreDraft = () => { const d = autosave.restore(); if (d) { setDraft({ ...EMPTY, ...d }); setSession((s) => s + 1); } };
  const result = useMemo(() => scoreListing(draft, reference), [draft, reference]);
  const byField = Object.fromEntries(result.fields.map((f) => [f.field, f]));
  const bench = useBenchmark(draft, result, reference, byField);
  const gains = useGains(result);
  const compact = useCompactHeader();
  const steps = stepStatuses(result.fields, { applied, exported });
  const empty = isEmptyDraft(draft);

  const set = (field) => (e) => setDraft((d) => ({ ...d, [field]: e.target.value }));
  const problems = result.fields.filter((f) => f.status !== "ok");
  const verdict = bench.status === "ready" && bench.data.n >= MIN_COMPARABLES ? band(bench.data.pct_diff) : null;
  const matchedBuilding = result.matched.building_id ? reference.buildings.find((b) => b.building_id === result.matched.building_id) : null;
  const matchedArea = reference.areas.find((a) => a.area_id === (result.matched.area_id ?? matchedBuilding?.area_id)) ?? null;

  // Scroll so the results sit just under the sticky header. The header is 58px once compact,
  // which it will be by the time the scroll lands, so use that rather than its current height.
  // Scroll so `el` sits `extra` px under the sticky header. The header compresses once the page
  // has scrolled, which moves everything above the target up by (full - compact), so the full
  // header height is the right offset from either state. Chrome's scroll anchoring would then
  // shift the scroll position to compensate for the shrink, landing the target low, so anchoring
  // is off for the programmatic scroll and the position is checked for a few frames after it ends.
  const scrollUnderHeader = (el, extra = 8) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = document.documentElement;
    const header = () => document.querySelector("header.top")?.getBoundingClientRect().height ?? 0;
    root.style.overflowAnchor = "none";
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - header() - extra, behavior: reduce ? "auto" : "smooth" });
    let frames = 0;
    const settle = () => {
      const off = el.getBoundingClientRect().top - header() - extra;
      if (Math.abs(off) > 2) window.scrollBy({ top: off, behavior: "auto" });
      if (++frames < 4) requestAnimationFrame(settle); else root.style.overflowAnchor = "";
    };
    const start = () => requestAnimationFrame(settle);
    if ("onscrollend" in window) window.addEventListener("scrollend", start, { once: true });
    else setTimeout(start, reduce ? 50 : 700);
  };
  // Stepper, Next buttons and the header ring: switch to the tab that holds the target (a no-op
  // on desktop), then once it is on screen scroll its card under the header and focus the field.
  const goTo = (id) => (e) => {
    e?.preventDefault?.();
    setTab(tabForTarget(id));
    setPendingScroll({ id, key: Date.now() });
  };
  const jumpToResults = goTo("results");
  useEffect(() => {
    if (!pendingScroll) return;
    const el = document.getElementById(pendingScroll.id);
    if (el) {
      scrollUnderHeader(el.closest(".card") ?? el, 12);
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.focus({ preventScroll: true });
    }
    setPendingScroll(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScroll]);

  return (
    <div className="app" data-tab={tab}>
      <header className={`top${compact ? " compact" : ""}`}>
        <div className="top-inner">
          <div className="top-row">
            <h1>Listing Check</h1>
            <ol className="top-steps" aria-hidden="true">
              {steps.map((s) => <li key={s.id} data-status={s.status} />)}
            </ol>
            <a className="top-score" href="#results" onClick={jumpToResults} aria-label={`Score ${result.score} of 100. Jump to the results.`}>
              <ScoreRing score={result.score} small />
              {gains.total ? <span className="gain" key={gains.total.key} aria-live="polite">+{gains.total.amount}</span> : null}
              <span className="top-score-text">
                {empty ? "empty" : problems.length === 0 ? "complete" : `${problems.length} to fix`}
                {verdict ? ` · ${shortVerdict(verdict)}` : ""}
              </span>
            </a>
          </div>
          <p className="purpose">Check a Bangkok rental listing before it goes live: what is missing, and whether the price makes sense.</p>
          <p className="notice">
            Running on sample data generated from public market averages. <a href="/import">Import your listings</a> to run it on your own.
          </p>
        </div>
      </header>

      <Stepper steps={steps} goTo={goTo} />

      <div className="layout">
        <form className="form" onSubmit={(e) => e.preventDefault()}>
          <div className="form-top">
            <div className="form-actions">
              <button type="button" onClick={() => loadDraft(EXAMPLE)}>Load an example draft</button>
              <button type="button" className="quiet" onClick={() => loadDraft(MISPRICED)}>Load a mispriced draft</button>
              <button type="button" className="quiet" onClick={() => loadDraft(EMPTY)}>Clear</button>
            </div>

            {autosave.offer ? (
              <div className="restore-bar" role="status">
                <span>You have an unfinished draft from {relativeTime(autosave.offer.savedAt, autosave.now)}.</span>
                <span className="form-actions">
                  <button type="button" onClick={restoreDraft}>Restore</button>
                  <button type="button" className="quiet" onClick={autosave.discard}>Discard</button>
                </span>
              </div>
            ) : autosave.savedAt ? (
              <p className="saved-line" aria-live="polite">Draft saved · {relativeTime(autosave.savedAt, autosave.now)}</p>
            ) : null}
          </div>

          <fieldset className="card">
            <legend><span className="marker" aria-hidden="true">01 · The listing</span>The listing</legend>
            <Field f={byField.title} gain={gains.fields.title} htmlFor="title">
              <input id="title" value={draft.title} onChange={set("title")} autoComplete="off" />
            </Field>

            <Field f={byField.description} gain={gains.fields.description} htmlFor="description" hint="English. At least 150 characters, and mention two of: floor, view, furnishing, nearest station.">
              <textarea id="description" rows={5} value={draft.description} onChange={set("description")} />
            </Field>

            <div className="field">
              <label htmlFor="description_th" className="label">Thai description <span className="optional">optional</span></label>
              <textarea id="description_th" lang="th" rows={3} value={draft.description_th} onChange={set("description_th")} />
              {draft.description_th.trim() ? <p className="hint">Thai description added. It will be used for the rewrite.</p> : null}
            </div>

            {draft.title_th ? (
              <div className="field">
                <label htmlFor="title_th" className="label">Thai title <span className="optional">from the rewrite</span></label>
                <input id="title_th" lang="th" value={draft.title_th} onChange={set("title_th")} />
              </div>
            ) : null}
            <div className="card-foot"><button type="button" className="quiet" onClick={goTo("building")}>Next: The unit</button></div>
          </fieldset>

          <fieldset className="card">
            <legend><span className="marker" aria-hidden="true">02 · The unit</span>The unit</legend>
            <div className="row">
              <Field f={byField.building} gain={gains.fields.building} htmlFor="building">
                <input id="building" list="buildings" value={draft.building} onChange={set("building")} autoComplete="off" />
              </Field>
              <Field f={byField.area} gain={gains.fields.area} htmlFor="area">
                <input id="area" list="areas" value={draft.area} onChange={set("area")} autoComplete="off" />
              </Field>
            </div>

            <div className="row three">
              <Field f={byField.size_sqm} gain={gains.fields.size_sqm} htmlFor="size_sqm">
                <input id="size_sqm" type="number" inputMode="decimal" min="0" value={draft.size_sqm} onChange={set("size_sqm")} />
              </Field>
              <Field f={byField.floor} gain={gains.fields.floor} htmlFor="floor">
                <input id="floor" type="number" inputMode="numeric" min="0" value={draft.floor} onChange={set("floor")} />
              </Field>
              <Field f={byField.bedrooms} gain={gains.fields.bedrooms} htmlFor="bedrooms">
                <select id="bedrooms" value={draft.bedrooms} onChange={set("bedrooms")}>
                  <option value="">Choose</option>
                  <option value="0">Studio</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            </div>

            <div className="row three">
              <Field f={byField.bathrooms} gain={gains.fields.bathrooms} htmlFor="bathrooms">
                <input id="bathrooms" type="number" inputMode="numeric" min="0" value={draft.bathrooms} onChange={set("bathrooms")} />
              </Field>
              <Field f={byField.furnishing} gain={gains.fields.furnishing} htmlFor="furnishing">
                <select id="furnishing" value={draft.furnishing} onChange={set("furnishing")}>
                  <option value="">Choose</option>
                  <option value="unfurnished">Unfurnished</option>
                  <option value="partly furnished">Partly furnished</option>
                  <option value="fully furnished">Fully furnished</option>
                </select>
              </Field>
              <Field f={byField.nearest_station} gain={gains.fields.nearest_station} htmlFor="nearest_station"
                help="The nearest BTS or MRT station. Filled in from our building table when the building is known; type one to override it.">
                <input id="nearest_station" list="stations" value={draft.nearest_station} onChange={set("nearest_station")} autoComplete="off"
                  placeholder={result.matched.nearest_station && !draft.nearest_station ? result.matched.nearest_station : ""} />
              </Field>
            </div>
            <div className="card-foot"><button type="button" className="quiet" onClick={goTo("monthly_rent_thb")}>Next: Price and photos</button></div>
          </fieldset>

          <fieldset className="card">
            <legend><span className="marker" aria-hidden="true">03 · Price and photos</span>Price and photos</legend>
            <div className="row">
              <Field f={byField.monthly_rent_thb} gain={gains.fields.monthly_rent_thb} htmlFor="monthly_rent_thb" labelOverride="Monthly rent (THB)"
                help="The asking rent per month in Thai baht. The price check divides it by the size and compares it with similar listings.">
                <input id="monthly_rent_thb" type="number" inputMode="numeric" min="0" step="500" value={draft.monthly_rent_thb} onChange={set("monthly_rent_thb")} />
              </Field>
              <Field f={byField.photo_count} gain={gains.fields.photo_count} htmlFor="photo_count" labelOverride="Number of photos (5 or more)">
                <input id="photo_count" type="number" inputMode="numeric" min="0" value={draft.photo_count} onChange={set("photo_count")} />
              </Field>
            </div>
            <div className="terms">
              <div className="label-row">
                <span className="label">Lease terms <span className="optional">optional, not scored</span></span>
                <button type="button" className="quiet small" onClick={() => setDraft((d) => ({ ...d, ...USUAL_TERMS }))}>Use the usual terms</button>
              </div>
              <div className="row three">
                <div className="field">
                  <label htmlFor="contract_months" className="label">Contract (months)</label>
                  <input id="contract_months" type="number" inputMode="numeric" min="0" value={draft.contract_months} onChange={set("contract_months")} />
                </div>
                <div className="field">
                  <label htmlFor="deposit_months" className="label">Deposit (months)</label>
                  <input id="deposit_months" type="number" inputMode="numeric" min="0" value={draft.deposit_months} onChange={set("deposit_months")} />
                </div>
                <div className="field">
                  <label htmlFor="advance_months" className="label">Advance rent (months)</label>
                  <input id="advance_months" type="number" inputMode="numeric" min="0" value={draft.advance_months} onChange={set("advance_months")} />
                </div>
              </div>
              <p className="hint">Once set, the rewrite states them in both languages and they go into the export and the preview.</p>
            </div>
            <div className="card-foot"><button type="button" className="quiet" onClick={goTo("rewrite")}>Next: AI rewrite</button></div>
          </fieldset>

          <datalist id="buildings">{reference.buildings.map((b) => <option key={b.building_id} value={b.building_name} />)}</datalist>
          <datalist id="areas">{reference.areas.map((a) => <option key={a.area_id} value={a.area_name} />)}</datalist>
          <datalist id="stations">{[...new Set(reference.buildings.map((b) => b.nearest_station))].sort().map((s) => <option key={s} value={s} />)}</datalist>
        </form>

        <aside className="results" id="results">
          <section className="score card tinted">
            <div className="score-hero">
              <ScoreRing score={result.score} />
              <div>
                <p className="score-word" data-band={empty ? "empty" : scoreBand(result.score)}>{empty ? "Nothing to check yet" : scoreWord(result.score)}</p>
                <p className="score-sub">{empty ? "Start with the title, or load an example draft." : problems.length === 0 ? "Nothing missing." : `${problems.length} field${problems.length === 1 ? "" : "s"} to fix.`}</p>
              </div>
            </div>
            <ScoreBar fields={result.fields} />
            {empty ? null : problems.length === 0 ? (
              <p className="allgood">Every field is complete. Check the price below, then publish.</p>
            ) : (
              <ul className="problems">
                {problems.map((f) => (
                  <li key={f.field} data-status={f.status}>
                    <a href={`#${f.field}`}>{f.label}</a>
                    <span className="pts">{formatPts(f.earned)}/{f.points}</span>
                    <span className="msg">{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {empty ? null : (
              <div className="form-actions">
                <button type="button" className="quiet" id="preview-button-results" onClick={() => setPreview("preview-button-results")}>Preview as a listing</button>
              </div>
            )}
          </section>

          <BuildingCard building={matchedBuilding} />

          <section className="bench card tinted">
            <h2>Price check</h2>
            <Benchmark bench={bench} draft={draft} result={result} reference={reference} />
          </section>

          <p className="to-rewrite"><a href="#rewrite" onClick={goTo("rewrite")}>Rewrite with AI</a>, below the form.</p>
        </aside>
      </div>

      <div className="layout single">
        <RewritePanel key={session} draft={draft} setDraft={setDraft} onApplied={() => setApplied(true)} canRewrite={Boolean((draft.title.trim() || draft.description.trim()) && result.matched.building_id)} />
        <ExportPanel draft={draft} result={result} onExported={() => setExported(true)} onPreview={() => setPreview("preview-button")} bench={bench.status === "ready" && bench.data.n >= MIN_COMPARABLES ? bench.data : null} />
      </div>

      <PreviewOverlay open={preview !== null} onClose={() => setPreview(null)} returnFocusTo={preview ?? undefined}
        draft={draft} result={result} building={matchedBuilding} area={matchedArea} verdict={verdict} />

      <nav className="tabbar" aria-label="Sections">
        {TABS.map((t) => (
          <button type="button" key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => { setTab(t.id); window.scrollTo({ top: 0 }); }}>
            {t.label}
            {t.id === "check" && !empty && problems.length ? <span className="tab-count" aria-label={`${problems.length} to fix`}>{problems.length}</span> : null}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Field({ f, gain, htmlFor, children, hint, help, labelOverride }) {
  const [showHelp, setShowHelp] = useState(false);
  const label = labelOverride ?? f.label;
  return (
    <div className="field" data-status={f.status}>
      {/* The gain flash lives in the label, which is always there, so it never changes the layout. */}
      <div className="label-row">
        <label htmlFor={htmlFor} className="label">
          {label}
          {gain ? <span className="gain" key={gain.key} aria-live="polite"> +{formatPts(gain.amount)}</span> : null}
        </label>
        {help ? (
          <button type="button" className="help" aria-label={`About ${label}`} aria-expanded={showHelp} aria-controls={`${htmlFor}-help`} onClick={() => setShowHelp((v) => !v)}>?</button>
        ) : null}
      </div>
      {children}
      {help && showHelp ? <p id={`${htmlFor}-help`} className="hint">{help}</p> : null}
      <p className={f.status !== "ok" && f.message ? "fieldmsg" : "hint"}>
        {f.status !== "ok" && f.message ? f.message : f.status === "ok" && f.message ? f.message : hint ?? ""}
      </p>
    </div>
  );
}

// Five steps under the header. Done, current and to do come from lib/steps.js; a tap scrolls to the card.
function Stepper({ steps, goTo }) {
  const current = steps.find((s) => s.status === "current");
  return (
    <nav className="stepper-wrap" aria-label="Progress">
      <ol className="stepper">
        {steps.map((s) => (
          <li key={s.id} data-status={s.status}>
            <a href={`#${s.target}`} onClick={goTo(s.target)} aria-current={s.status === "current" ? "step" : undefined}>
              <span className="step-dot" aria-hidden="true">{s.status === "done" ? "✓" : s.n}</span>
              <span className="step-label">{s.label}</span>
              <span className="sr-only">, {s.status === "done" ? "done" : s.status === "current" ? "current step" : "to do"}</span>
            </a>
          </li>
        ))}
      </ol>
      <p className="stepper-now" aria-hidden="true">
        {current ? `Step ${current.n} of 5 · ${current.heading}` : "All five steps done"}
      </p>
    </nav>
  );
}

// Red under 60, amber 60 to 84, green 85 and over. The same three tones as the price verdict.
export const scoreBand = (s) => (s >= 85 ? "high" : s >= 60 ? "mid" : "low");
const scoreWord = (s) => (s >= 85 ? "Ready to publish" : s >= 60 ? "Nearly there" : "Needs work");

// What we know about the matched building, from our own tables only. Hidden until a building matches.
const TIER_WORD = { luxury: "Luxury", mid: "Mid-range", budget: "Budget" };

function BuildingCard({ building }) {
  if (!building) return null;
  const line = lineFor(building.nearest_station);
  const year = building.completed_year;
  const age = year ? new Date().getFullYear() - year : null;
  return (
    <section className="building-card card" aria-label={`About ${building.building_name}`}>
      <h2>{building.building_name}</h2>
      <p className="building-line">
        {line?.colour ? <span className="line-dot" style={{ background: line.colour }} aria-hidden="true" /> : null}
        <span>{building.nearest_station}</span>
      </p>
      <p className="building-facts muted">
        {[line?.name, building.walk_min ? `${building.walk_min} min walk` : null].filter(Boolean).join(" · ")}
      </p>
      <p className="building-facts muted">
        {[
          year ? `Completed ${year}${age !== null ? ` (${age} year${age === 1 ? "" : "s"} old)` : ""}` : null,
          building.tier ? TIER_WORD[building.tier] ?? building.tier : null,
          `${building.listing_count ?? 0} listing${building.listing_count === 1 ? "" : "s"} in our data`,
        ].filter(Boolean).join(" · ")}
      </p>
    </section>
  );
}

// The header compresses to one line once the page has scrolled past the intro. Hysteresis so
// the header shrinking (which shifts the page) cannot flip it straight back.
function useCompactHeader() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      setCompact((c) => (c ? window.scrollY > 24 : window.scrollY > 96));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return compact;
}

// A ring that fills by score, with the number inside. `small` is the 40px header version.
function ScoreRing({ score, small = false }) {
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

// Twelve segments, each as wide as the points it is worth, filled by what the draft earned.
function ScoreBar({ fields }) {
  return (
    <div className="bar" role="img" aria-label={fields.map((f) => `${f.label} ${formatPts(f.earned)} of ${f.points}`).join(", ")}>
      {fields.map((f) => (
        <div key={f.field} className="seg" style={{ flexGrow: f.points }} data-status={f.status} title={`${f.label}: ${formatPts(f.earned)} of ${f.points}`}>
          <div className="fill" style={{ width: `${(f.earned / f.points) * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

function Benchmark({ bench, draft, result, reference }) {
  if (bench.status === "bad_rent") return <p className="muted">Fix the rent first, then the price check will run.</p>;
  if (bench.status === "bad_size") return <p className="muted">Fix the size first, then the price check will run.</p>;
  if (bench.status === "idle") {
    return <p className="muted">Add the rent, the size and a known building or area to compare the price with the market.</p>;
  }
  if (bench.status === "loading") return <p className="muted">Comparing with the market…</p>;
  if (bench.status === "error") return <p className="muted">The price check is not available right now. {bench.error}</p>;

  const building = reference.buildings.find((b) => b.building_id === result.matched.building_id);
  const areaId = result.matched.area_id ?? building?.area_id;
  const area = reference.areas.find((a) => a.area_id === areaId);

  if (bench.status === "none" || bench.data.n < MIN_COMPARABLES) {
    return (
      <div className="bench-body" data-tone="none">
        <p className="verdict"><strong>Not enough similar listings to judge</strong></p>
        <dl className="bench-facts">
          {bench.status === "ready" ? <div><dt>This listing</dt><dd>{baht(bench.data.listing_rent_per_sqm)} per sqm</dd></div> : null}
          {area ? <div><dt>Rents in {area.area_name} usually run</dt><dd>{baht(area.rent_sqm_low)} to {baht(area.rent_sqm_high)} per sqm</dd></div> : null}
          {area ? <div><dt>Typical 1-bed rent in {area.area_name}</dt><dd>{baht(area.one_bed_typical)} a month</dd></div> : null}
        </dl>
        <p className="hint">A verdict needs at least {MIN_COMPARABLES} comparable listings. {bench.status === "ready" ? `There are ${bench.data.n}.` : "There are none yet."}</p>
      </div>
    );
  }

  const d = bench.data;
  const verdict = band(d.pct_diff);
  const pct = Number(d.pct_diff);
  const basis = basisLabel(d.basis, { buildingName: building?.building_name, areaName: area?.area_name, tier: building?.tier, bedrooms: num(draft.bedrooms) });

  return (
    <div className="bench-body" data-tone={verdict.tone}>
      <p className="verdict">
        <strong>{verdict.label[0].toUpperCase() + verdict.label.slice(1)}</strong>
        {Math.abs(pct) > 10 ? <span>, {Math.abs(pct).toFixed(0)}% {pct > 0 ? "above" : "below"} the median</span> : null}
      </p>
      {verdict.tone === "note" ? <p className="hint">Medians from a few hundred listings are rough. A difference this size is worth a look, not an alarm.</p> : null}
      <dl className="bench-facts">
        <div><dt>This listing</dt><dd>{baht(d.listing_rent_per_sqm)} per sqm</dd></div>
        <div><dt>Median for {basis}</dt><dd>{baht(d.median_rent_per_sqm)} per sqm, from {d.n} listings</dd></div>
        {area ? <div><dt>Typical 1-bed rent in {area.area_name}</dt><dd>{baht(area.one_bed_typical)} a month</dd></div> : null}
      </dl>
      {proximityNote(building) ? <p className="hint">{proximityNote(building)}</p> : null}
    </div>
  );
}

// Saves the form to localStorage 800 ms after it stops changing, offers a saved draft back when
// the page loads empty, and keeps a clock for the "Draft saved · 2 minutes ago" line.
const SAVE_DEBOUNCE_MS = 800;

function useAutosave(draft) {
  const [state, dispatch] = useReducer(autosaveReducer, autosaveInitial);
  const [now, setNow] = useState(() => Date.now());
  const skipNext = useRef(false);

  useEffect(() => {
    dispatch({ type: "init", stored: readDraft(), formEmpty: isEmptyDraft(draft) });
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isEmptyDraft(draft)) return;
    if (skipNext.current) { skipNext.current = false; return; }
    const t = setTimeout(() => {
      const at = Date.now();
      if (writeDraft(draft, at)) { dispatch({ type: "saved", at }); setNow(at); }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);

  return {
    offer: state.offer ? state.offered : null,
    savedAt: state.savedAt,
    now,
    restore() {
      const d = state.offered?.draft ?? null;
      skipNext.current = true; // the restored draft is already in storage; do not rewrite it as "just now"
      dispatch({ type: "restore" });
      return d;
    },
    discard() { removeDraft(); dispatch({ type: "discard" }); },
    forget() { removeDraft(); dispatch({ type: "cleared" }); },
  };
}

// Calls benchmark_listing when there is enough to compare, debounced, ignoring stale responses.
// Does not run while the rent or size fails its completeness range: a 5,000,000 rent would
// just produce a silly percentage.
function useBenchmark(draft, result, reference, byField) {
  const [bench, setBench] = useState({ status: "idle" });
  const seq = useRef(0);
  const rent = num(draft.monthly_rent_thb);
  const size = num(draft.size_sqm);
  const bedrooms = num(draft.bedrooms);
  const buildingId = result.matched.building_id;
  const areaId = result.matched.area_id ?? reference.buildings.find((b) => b.building_id === buildingId)?.area_id ?? null;
  const rentInvalid = byField.monthly_rent_thb.status === "invalid";
  const sizeInvalid = byField.size_sqm.status === "invalid";

  useEffect(() => {
    if (rentInvalid) { setBench({ status: "bad_rent" }); return; }
    if (sizeInvalid) { setBench({ status: "bad_size" }); return; }
    if (!rent || !size || size <= 0 || !areaId) {
      setBench({ status: "idle" });
      return;
    }
    const id = ++seq.current;
    setBench((b) => (b.status === "ready" ? b : { status: "loading" }));
    const timer = setTimeout(async () => {
      const { data, error } = await supabaseBrowser().rpc("benchmark_listing", {
        p_building_id: buildingId, p_area_id: areaId, p_bedrooms: bedrooms,
        p_rent: Math.round(rent), p_size: Math.round(size),
      });
      if (id !== seq.current) return;
      if (error) setBench({ status: "error", error: error.message });
      else if (!data || data.length === 0 || data[0].median_rent_per_sqm === null) setBench({ status: "none" });
      else setBench({ status: "ready", data: data[0] });
    }, 350);
    return () => clearTimeout(timer);
  }, [rent, size, bedrooms, buildingId, areaId, rentInvalid, sizeInvalid]);

  return bench;
}

// "+8" next to a field that gained points, and the same total in the phone strip, which is
// always on screen even when the keyboard hides the line under the input. Compared against
// the last settled state, 700 ms after the draft stops changing, so typing a title shows one
// "+6" rather than a flicker of "+0.3" per keystroke. Each gain clears itself after 3 s.
const GAIN_SHOW_MS = 3000;

function useGains(result) {
  const settled = useRef(null);
  const [gains, setGains] = useState({ fields: {}, total: null });

  useEffect(() => {
    const now = Object.fromEntries(result.fields.map((f) => [f.field, f.earned]));
    if (!settled.current) { settled.current = now; return; }
    const timer = setTimeout(() => {
      const prev = settled.current;
      settled.current = now;
      const fresh = {};
      let total = 0;
      for (const [field, earned] of Object.entries(now)) {
        const delta = earned - (prev[field] ?? 0);
        if (delta >= 0.5) fresh[field] = { amount: Math.round(delta * 10) / 10, key: Date.now() };
        total += delta;
      }
      if (Object.keys(fresh).length === 0) return;
      const key = Date.now();
      const totalGain = total >= 0.5 ? { amount: Math.round(total), key } : null;
      setGains((old) => ({ fields: { ...old.fields, ...fresh }, total: totalGain ?? old.total }));
      setTimeout(() => {
        setGains((old) => {
          const fields = { ...old.fields };
          for (const [field, g] of Object.entries(fresh)) if (fields[field]?.key === g.key) delete fields[field];
          return { fields, total: old.total?.key === key ? null : old.total };
        });
      }, GAIN_SHOW_MS);
    }, 700);
    return () => clearTimeout(timer);
  }, [result]);

  return gains;
}
