"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { scoreListing } from "../lib/completeness/score.js";
import { num } from "../lib/completeness/rules.js";
import { band, basisLabel, shortVerdict, MIN_COMPARABLES } from "../lib/benchmark/bands.js";
import { supabaseBrowser } from "../lib/supabase/browser.js";
import RewritePanel from "./rewrite.js";

const EMPTY = {
  title: "", description: "", description_th: "", title_th: "", building: "", area: "", size_sqm: "", floor: "",
  bedrooms: "", bathrooms: "", monthly_rent_thb: "", furnishing: "", photo_count: "", nearest_station: "",
};

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
  const result = useMemo(() => scoreListing(draft, reference), [draft, reference]);
  const byField = Object.fromEntries(result.fields.map((f) => [f.field, f]));
  const bench = useBenchmark(draft, result, reference, byField);
  const gains = useGains(result);

  const set = (field) => (e) => setDraft((d) => ({ ...d, [field]: e.target.value }));
  const problems = result.fields.filter((f) => f.status !== "ok");
  const verdict = bench.status === "ready" && bench.data.n >= MIN_COMPARABLES ? band(bench.data.pct_diff) : null;

  const jumpToResults = (e) => {
    e.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("results")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <>
      <header className="top">
        <h1>Listing check</h1>
        <p className="banner">
          Sample data generated from public market averages. Point it at your listings table and it runs on real data.
        </p>
      </header>

      <div className="layout">
        <form className="form" onSubmit={(e) => e.preventDefault()}>
          <div className="form-actions">
            <button type="button" onClick={() => setDraft(EXAMPLE)}>Load an example draft</button>
            <button type="button" className="quiet" onClick={() => setDraft(MISPRICED)}>Load a mispriced draft</button>
            <button type="button" className="quiet" onClick={() => setDraft(EMPTY)}>Clear</button>
          </div>

          <Field f={byField.title} gain={gains.title} htmlFor="title">
            <input id="title" value={draft.title} onChange={set("title")} autoComplete="off" />
          </Field>

          <Field f={byField.description} gain={gains.description} htmlFor="description" hint="English. At least 150 characters, and mention two of: floor, view, furnishing, nearest station.">
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

          <div className="row">
            <Field f={byField.building} gain={gains.building} htmlFor="building">
              <input id="building" list="buildings" value={draft.building} onChange={set("building")} autoComplete="off" />
            </Field>
            <Field f={byField.area} gain={gains.area} htmlFor="area">
              <input id="area" list="areas" value={draft.area} onChange={set("area")} autoComplete="off" />
            </Field>
          </div>

          <div className="row three">
            <Field f={byField.size_sqm} gain={gains.size_sqm} htmlFor="size_sqm">
              <input id="size_sqm" type="number" inputMode="decimal" min="0" value={draft.size_sqm} onChange={set("size_sqm")} />
            </Field>
            <Field f={byField.floor} gain={gains.floor} htmlFor="floor">
              <input id="floor" type="number" inputMode="numeric" min="0" value={draft.floor} onChange={set("floor")} />
            </Field>
            <Field f={byField.monthly_rent_thb} gain={gains.monthly_rent_thb} htmlFor="monthly_rent_thb" labelOverride="Monthly rent (THB)">
              <input id="monthly_rent_thb" type="number" inputMode="numeric" min="0" step="500" value={draft.monthly_rent_thb} onChange={set("monthly_rent_thb")} />
            </Field>
          </div>

          <div className="row three">
            <Field f={byField.bedrooms} gain={gains.bedrooms} htmlFor="bedrooms">
              <select id="bedrooms" value={draft.bedrooms} onChange={set("bedrooms")}>
                <option value="">Choose</option>
                <option value="0">Studio</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field f={byField.bathrooms} gain={gains.bathrooms} htmlFor="bathrooms">
              <input id="bathrooms" type="number" inputMode="numeric" min="0" value={draft.bathrooms} onChange={set("bathrooms")} />
            </Field>
            <Field f={byField.photo_count} gain={gains.photo_count} htmlFor="photo_count">
              <input id="photo_count" type="number" inputMode="numeric" min="0" value={draft.photo_count} onChange={set("photo_count")} />
            </Field>
          </div>

          <div className="row">
            <Field f={byField.furnishing} gain={gains.furnishing} htmlFor="furnishing">
              <select id="furnishing" value={draft.furnishing} onChange={set("furnishing")}>
                <option value="">Choose</option>
                <option value="unfurnished">Unfurnished</option>
                <option value="partly furnished">Partly furnished</option>
                <option value="fully furnished">Fully furnished</option>
              </select>
            </Field>
            <Field f={byField.nearest_station} gain={gains.nearest_station} htmlFor="nearest_station">
              <input id="nearest_station" list="stations" value={draft.nearest_station} onChange={set("nearest_station")} autoComplete="off"
                placeholder={result.matched.nearest_station && !draft.nearest_station ? result.matched.nearest_station : ""} />
            </Field>
          </div>

          <datalist id="buildings">{reference.buildings.map((b) => <option key={b.building_id} value={b.building_name} />)}</datalist>
          <datalist id="areas">{reference.areas.map((a) => <option key={a.area_id} value={a.area_name} />)}</datalist>
          <datalist id="stations">{[...new Set(reference.buildings.map((b) => b.nearest_station))].sort().map((s) => <option key={s} value={s} />)}</datalist>
        </form>

        <aside className="results" id="results">
          <section className="score">
            <div className="score-head">
              <span className="score-number">{result.score}</span>
              <span className="score-of">of 100</span>
            </div>
            <ScoreBar fields={result.fields} />
            {problems.length === 0 ? (
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
          </section>

          <section className="bench">
            <h2>Price check</h2>
            <Benchmark bench={bench} draft={draft} result={result} reference={reference} />
          </section>

          <p className="to-rewrite"><a href="#rewrite">Rewrite with AI</a>, below the form.</p>
        </aside>
      </div>

      <div className="layout single">
        <RewritePanel draft={draft} setDraft={setDraft} canRewrite={Boolean((draft.title.trim() || draft.description.trim()) && result.matched.building_id)} />
      </div>

      <a className="bottombar" href="#results" onClick={jumpToResults}>
        <span className="bb-score">{result.score}</span>
        <span className="bb-text">
          {problems.length === 0 ? "complete" : `${problems.length} to fix`}
          {verdict ? ` · ${shortVerdict(verdict)}` : ""}
        </span>
      </a>
    </>
  );
}

function Field({ f, gain, htmlFor, children, hint, labelOverride }) {
  return (
    <div className="field" data-status={f.status}>
      <label htmlFor={htmlFor} className="label">{labelOverride ?? f.label}</label>
      {children}
      <p className={f.status !== "ok" && f.message ? "fieldmsg" : "hint"}>
        {f.status !== "ok" && f.message ? f.message : f.status === "ok" && f.message ? f.message : hint ?? ""}
        {gain ? <span className="gain" key={gain.key} aria-live="polite"> +{formatPts(gain.amount)}</span> : null}
      </p>
    </div>
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
      <dl className="bench-facts">
        <div><dt>This listing</dt><dd>{baht(d.listing_rent_per_sqm)} per sqm</dd></div>
        <div><dt>Median for {basis}</dt><dd>{baht(d.median_rent_per_sqm)} per sqm, from {d.n} listings</dd></div>
        {area ? <div><dt>Typical 1-bed rent in {area.area_name}</dt><dd>{baht(area.one_bed_typical)} a month</dd></div> : null}
      </dl>
    </div>
  );
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

// "+8" next to a field that gained points. Compared against the last settled state, 700 ms
// after the draft stops changing, so typing a title shows one "+6" rather than a flicker
// of "+0.3" per keystroke. Each gain clears itself after a couple of seconds.
function useGains(result) {
  const settled = useRef(null);
  const [gains, setGains] = useState({});

  useEffect(() => {
    const now = Object.fromEntries(result.fields.map((f) => [f.field, f.earned]));
    if (!settled.current) { settled.current = now; return; }
    const timer = setTimeout(() => {
      const prev = settled.current;
      settled.current = now;
      const fresh = {};
      for (const [field, earned] of Object.entries(now)) {
        const delta = earned - (prev[field] ?? 0);
        if (delta >= 0.5) fresh[field] = { amount: Math.round(delta * 10) / 10, key: Date.now() };
      }
      if (Object.keys(fresh).length === 0) return;
      setGains((old) => ({ ...old, ...fresh }));
      setTimeout(() => {
        setGains((old) => {
          const next = { ...old };
          for (const [field, g] of Object.entries(fresh)) if (next[field]?.key === g.key) delete next[field];
          return next;
        });
      }, 2200);
    }, 700);
    return () => clearTimeout(timer);
  }, [result]);

  return gains;
}
