"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { reducer as autosaveReducer, initialState as autosaveInitial, isEmptyDraft, relativeTime } from "../lib/drafts/autosave.js";
import { readDraft, writeDraft, removeDraft } from "../lib/drafts/storage.js";
import { scoreListing } from "../lib/completeness/score.js";
import { num } from "../lib/completeness/rules.js";
import { band, MIN_COMPARABLES } from "../lib/benchmark/bands.js";
import { supabaseBrowser } from "../lib/supabase/browser.js";
import { STEPS, stepStatuses, fixCount } from "../lib/steps.js";
import { TABS, tabForTarget, tabStatuses } from "../lib/tabs.js";
import RewritePanel from "./rewrite.js";
import ExportPanel from "./export.js";
import ResultsPanel from "./results.js";
import CardHead from "./card-head.js";
import { ScoreRing } from "./score-ring.js";

const EMPTY = {
  title: "", description: "", description_th: "", title_th: "", building: "", area: "", size_sqm: "", floor: "",
  bedrooms: "", bathrooms: "", monthly_rent_thb: "", furnishing: "", photo_count: "", nearest_station: "",
  // Lease terms: optional, confirmed by the agent, not scored. The rewrite may state them once set.
  contract_months: "", deposit_months: "", advance_months: "",
};
const USUAL_TERMS = { contract_months: "12", deposit_months: "2", advance_months: "1" };
const LEASE_FIELDS = Object.keys(USUAL_TERMS);

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
  const gains = useGains(result, session);
  const filled = new Set(Object.entries(draft).filter(([, v]) => String(v ?? "").trim() !== "").map(([k]) => k));
  const steps = stepStatuses(result.fields, { applied, exported, filled });
  // Lease terms are not scored, so terms alone leave the results in their empty state.
  const empty = isEmptyDraft(draft, LEASE_FIELDS);

  const set = (field) => (e) => setDraft((d) => ({ ...d, [field]: e.target.value }));
  const problems = result.fields.filter((f) => f.status !== "ok");
  const verdict = bench.status === "ready" && bench.data.n >= MIN_COMPARABLES ? band(bench.data.pct_diff) : null;
  const matchedBuilding = result.matched.building_id ? reference.buildings.find((b) => b.building_id === result.matched.building_id) : null;
  const matchedArea = reference.areas.find((a) => a.area_id === (result.matched.area_id ?? matchedBuilding?.area_id)) ?? null;

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
      {/* One 56px line, never taller: name, the stepper (desktop), the score. The intro scrolls away under it. */}
      <header className="top">
        <div className="top-inner top-row">
          <h1>Listing Check</h1>
          <Stepper steps={steps} goTo={goTo} />
          <a className="top-score" href="#results" onClick={jumpToResults} aria-label={`Score ${result.score} of 100. Jump to the results.`}>
            <ScoreRing score={result.score} small />
            <span className="top-score-text">{empty ? "empty" : problems.length === 0 ? "complete" : `${problems.length} to fix`}</span>
          </a>
        </div>
      </header>


      <div className="layout">
        <div className="main-col">
        <p className="intro desktop-only">Check a Bangkok rental listing before it goes live. Sample data; <a href="/import">import yours</a> to run it on your own.</p>
        <form className="form" onSubmit={(e) => e.preventDefault()}>
          <div className="form-top">
            <div className="form-actions demo">
              <button type="button" onClick={() => loadDraft(EXAMPLE)}><span className="phone-only">Example</span><span className="desktop-only">Example draft</span></button>
              <button type="button" className="quiet" onClick={() => loadDraft(MISPRICED)}><span className="phone-only">Mispriced</span><span className="desktop-only">Mispriced draft</span></button>
              {isEmptyDraft(draft) ? null : <button type="button" className="quiet" onClick={() => loadDraft(EMPTY)}>Clear</button>}
            </div>

            {autosave.offer ? (
              <div className="restore-bar" role="status">
                <span>Unfinished draft from {relativeTime(autosave.offer.savedAt, autosave.now)}.</span>
                <span className="form-actions">
                  <button type="button" className="small" onClick={restoreDraft}>Restore</button>
                  <button type="button" className="quiet small" onClick={autosave.discard}>Discard</button>
                </span>
              </div>
            ) : (
              <p className="saved-line" aria-live="polite">
                <span className="phone-only"><a href="/import" className="plain">Sample data</a>{autosave.savedAt ? " · " : ""}</span>
                {autosave.savedAt ? <>Draft saved<span className="desktop-only"> ·</span> {relativeTime(autosave.savedAt, autosave.now)}</> : null}
              </p>
            )}
          </div>

          <fieldset className="card">
            <legend className="sr-only">The listing</legend>
            <CardHead n="01" title="The listing" purpose="What the tenant reads first." chip={empty ? null : fixCount(result.fields, STEPS[0].fields)} />
            <Field quiet={empty} f={byField.title} gain={gains.fields.title} htmlFor="title">
              <input id="title" value={draft.title} onChange={set("title")} autoComplete="off" />
            </Field>

            <Field quiet={empty} f={byField.description} gain={gains.fields.description} htmlFor="description" hint="English. At least 150 characters, and mention two of: floor, view, furnishing, nearest station.">
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
            <legend className="sr-only">The unit</legend>
            <CardHead n="02" title="The unit" purpose="Where it is and what it is." chip={empty ? null : fixCount(result.fields, STEPS[1].fields)} />
            <div className="row wide">
              <Field quiet={empty} f={byField.building} gain={gains.fields.building} htmlFor="building">
                <input id="building" list="buildings" value={draft.building} onChange={set("building")} autoComplete="off" />
              </Field>
              <Field quiet={empty} f={byField.area} gain={gains.fields.area} htmlFor="area">
                <input id="area" list="areas" value={draft.area} onChange={set("area")} autoComplete="off" />
              </Field>
            </div>

            <div className="row">
              <Field quiet={empty} f={byField.size_sqm} gain={gains.fields.size_sqm} htmlFor="size_sqm">
                <input id="size_sqm" type="number" inputMode="decimal" min="0" value={draft.size_sqm} onChange={set("size_sqm")} />
              </Field>
              <Field quiet={empty} f={byField.floor} gain={gains.fields.floor} htmlFor="floor">
                <input id="floor" type="number" inputMode="numeric" min="0" value={draft.floor} onChange={set("floor")} />
              </Field>
            </div>

            <div className="row">
              <Field quiet={empty} f={byField.bedrooms} gain={gains.fields.bedrooms} htmlFor="bedrooms">
                <select id="bedrooms" value={draft.bedrooms} onChange={set("bedrooms")}>
                  <option value="">Choose</option>
                  <option value="0">Studio</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
              <Field quiet={empty} f={byField.bathrooms} gain={gains.fields.bathrooms} htmlFor="bathrooms">
                <input id="bathrooms" type="number" inputMode="numeric" min="0" value={draft.bathrooms} onChange={set("bathrooms")} />
              </Field>
            </div>

            <div className="row wide">
              <Field quiet={empty} f={byField.furnishing} gain={gains.fields.furnishing} htmlFor="furnishing">
                <select id="furnishing" value={draft.furnishing} onChange={set("furnishing")}>
                  <option value="">Choose</option>
                  <option value="unfurnished">Unfurnished</option>
                  <option value="partly furnished">Partly furnished</option>
                  <option value="fully furnished">Fully furnished</option>
                </select>
              </Field>
              <Field quiet={empty} f={byField.nearest_station} gain={gains.fields.nearest_station} htmlFor="nearest_station"
                help="The nearest BTS or MRT station. Filled in from our building table when the building is known; type one to override it.">
                <input id="nearest_station" list="stations" value={draft.nearest_station} onChange={set("nearest_station")} autoComplete="off"
                  placeholder={result.matched.nearest_station && !draft.nearest_station ? result.matched.nearest_station : ""} />
              </Field>
            </div>
            <div className="card-foot"><button type="button" className="quiet" onClick={goTo("monthly_rent_thb")}>Next: Price and photos</button></div>
          </fieldset>

          <fieldset className="card">
            <legend className="sr-only">Price and photos</legend>
            <CardHead n="03" title="Price and photos" purpose="What it costs, and what the photos promise." chip={empty ? null : fixCount(result.fields, STEPS[2].fields)} />
            <div className="row">
              <Field quiet={empty} f={byField.monthly_rent_thb} gain={gains.fields.monthly_rent_thb} htmlFor="monthly_rent_thb" labelOverride={<><span className="phone-only">Rent (THB)</span><span className="desktop-only">Monthly rent (THB)</span></>}
                help="The asking rent per month in Thai baht. The price check divides it by the size and compares it with similar listings.">
                <input id="monthly_rent_thb" type="number" inputMode="numeric" min="0" step="500" value={draft.monthly_rent_thb} onChange={set("monthly_rent_thb")} />
              </Field>
              <Field quiet={empty} f={byField.photo_count} gain={gains.fields.photo_count} htmlFor="photo_count" labelOverride={<><span className="phone-only">Photos (5 or more)</span><span className="desktop-only">Number of photos (5 or more)</span></>}>
                <input id="photo_count" type="number" inputMode="numeric" min="0" value={draft.photo_count} onChange={set("photo_count")} />
              </Field>
            </div>
            <div className="terms">
              <div className="label-row">
                <span className="label">Lease terms <span className="optional">optional, not scored</span></span>
                <button type="button" className="quiet small" onClick={() => setDraft((d) => ({ ...d, ...USUAL_TERMS }))}>Use the usual terms</button>
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor="contract_months" className="label">Contract (months)</label>
                  <input id="contract_months" type="number" inputMode="numeric" min="0" value={draft.contract_months} onChange={set("contract_months")} />
                </div>
                <div className="field">
                  <label htmlFor="deposit_months" className="label">Deposit (months)</label>
                  <input id="deposit_months" type="number" inputMode="numeric" min="0" value={draft.deposit_months} onChange={set("deposit_months")} />
                </div>
              </div>
              <div className="row">
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

        <RewritePanel key={session} draft={draft} setDraft={setDraft} onApplied={() => setApplied(true)} result={result} onNext={goTo("export")} canRewrite={Boolean((draft.title.trim() || draft.description.trim()) && result.matched.building_id)} />
        <ExportPanel draft={draft} result={result} building={matchedBuilding} area={matchedArea} verdict={verdict} onExported={() => setExported(true)} onFix={goTo("results")} bench={bench.status === "ready" && bench.data.n >= MIN_COMPARABLES ? bench.data : null} />
        </div>

        <ResultsPanel result={result} problems={problems} empty={empty} gain={gains.total} bench={bench} draft={draft} reference={reference}
          building={matchedBuilding} byField={byField} goTo={goTo} />
      </div>


      <nav className="tabbar" aria-label="Sections">
        {TABS.map((t) => {
          const mark = empty ? "none" : tabStatuses(steps)[t.id];
          return (
            <button type="button" key={t.id} className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => { setTab(t.id); window.scrollTo({ top: 0 }); }}>
              {t.label}
              {mark === "done" ? <span className="tab-mark" data-tone="ok" aria-label="done">✓</span> : mark === "partial" ? <span className="tab-mark" data-tone="warn" aria-label="started" /> : null}
              {t.id === "check" && !empty && problems.length ? <span className="tab-count" aria-label={`${problems.length} to fix`}>{problems.length}</span> : null}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function Field({ f, gain, htmlFor, children, hint, help, labelOverride, quiet = false }) {
  const [showHelp, setShowHelp] = useState(false);
  const label = labelOverride ?? f.label;
  // A blank draft is not twelve mistakes. Messages wait until something has been typed anywhere,
  // then show for the whole form so an agent who types a title sees what else is missing.
  const message = f.status !== "ok" && f.message && !quiet ? f.message : f.status === "ok" && f.message ? f.message : null;
  return (
    <div className="field" data-status={f.status}>
      {/* The gain flash lives in the label, which is always there, so it never changes the layout. */}
      <div className="label-row">
        <label htmlFor={htmlFor} className="label">
          {label}
          {gain ? <span className="gain" key={gain.key} aria-live="polite"> +{formatPts(gain.amount)}</span> : null}
        </label>
        {help ? (
          <button type="button" className="help" aria-label={`About ${typeof label === "string" ? label : f.label}`} aria-expanded={showHelp} aria-controls={`${htmlFor}-help`} onClick={() => setShowHelp((v) => !v)}>?</button>
        ) : null}
      </div>
      {children}
      {help && showHelp ? <p id={`${htmlFor}-help`} className="hint">{help}</p> : null}
      <p className={message && f.status !== "ok" ? "fieldmsg" : "hint"}>{message ?? hint ?? ""}</p>
    </div>
  );
}


// Five steps under the header. Done, current and to do come from lib/steps.js; a tap scrolls to the card.
function Stepper({ steps, goTo }) {
  return (
    <nav className="stepper-wrap" aria-label="Progress">
      <ol className="stepper">
        {steps.map((s) => (
          <li key={s.id} data-status={s.status}>
            <a href={`#${s.target}`} onClick={goTo(s.target)} aria-current={s.status === "current" ? "step" : undefined}>
              <span className="step-dot" aria-hidden="true">{s.status === "done" ? "✓" : s.n}</span>
              <span className="step-label">{s.label}</span>
              <span className="sr-only">, {s.status === "done" ? "done" : s.status === "current" ? "current step" : s.status === "partial" ? "started, not complete" : "to do"}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
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

function useGains(result, session) {
  const settled = useRef(null);
  const [gains, setGains] = useState({ fields: {}, total: null });

  // A replaced draft (example, restore, clear) is a new baseline, not a gain. This effect is declared
  // first so it runs before the one below in the same render.
  useEffect(() => { settled.current = null; setGains({ fields: {}, total: null }); }, [session]);

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
      // The total chip only when there was a score to rise from: never on a first fill of a blank form.
      const prevTotal = Object.values(prev).reduce((a, b) => a + b, 0);
      const totalGain = total >= 0.5 && prevTotal > 0 ? { amount: Math.round(total), key } : null;
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
