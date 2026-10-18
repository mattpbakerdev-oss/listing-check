"use client";

import { num } from "../lib/completeness/rules.js";
import { band, basisLabel, MIN_COMPARABLES, proximityNote } from "../lib/benchmark/bands.js";
import { lineFor } from "../lib/stations.js";
import { verdictSentence, groupBars, barBand } from "../lib/results.js";
import { useEffect, useRef } from "react";
import { ScoreRing, scoreBand } from "./score-ring.js";

const baht = (n) => `฿${Math.round(Number(n)).toLocaleString("en-US")}`;
const formatPts = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// The results panel: the score with a gain chip when it has just risen, one sentence, then
// "What shaped it" as a bar per card, the fields to fix, the building card and the price check.
// One component: the desktop right column and the phone Check tab.
export default function ResultsPanel({ result, problems, empty, gain, bench, draft, reference, building, byField, goTo, onPreview }) {
  const bars = groupBars(result.fields);
  const needsRewrite = byField.title.earned < byField.title.points || byField.description.earned < byField.description.points;
  const sentence = verdictSentence({ empty, score: result.score, toFix: problems.length });
  const cut = sentence.indexOf(". ");
  const key = cut > 0 ? sentence.slice(0, cut + 1) : sentence, rest = cut > 0 ? sentence.slice(cut + 1) : "";
  const pane = useRef(null), inner = useRef(null);
  usePacedPane(pane, inner);
  return (
    <aside className="results" id="results">
      <div className="results-clip" ref={pane}>
      <div className="results-inner" ref={inner}>
      <div className="results-card card">
        <section className="rs" aria-label="Score">
          <div className="score-hero">
            <ScoreRing score={result.score} />
            <div>
              {gain ? <span className="gain-chip" key={gain.key} aria-live="polite">+{gain.amount}</span> : null}
              <p className="score-word"><strong className="verdict-key" data-band={empty ? "empty" : scoreBand(result.score)}>{key}</strong>{rest}</p>
            </div>
          </div>
        </section>

        {empty ? null : (
          <section className="rs" aria-label="What shaped it">
            <p className="rs-head">What shaped it</p>
            <ul className="bars">
              {bars.map((b) => (
                <li key={b.id}>
                  <a href={`#${b.target}`} onClick={goTo(b.target)}>{b.label}</a>
                  <span className="bar-track" aria-hidden="true"><span className="bar-fill" data-band={barBand((b.earned / b.points) * 100)} style={{ width: `${(b.earned / b.points) * 100}%` }} /></span>
                  <span className="bar-num">{formatPts(b.earned)}<span className="muted">/{b.points}</span></span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {empty ? null : (
          <section className="rs" aria-label="Fields to fix">
            <p className="rs-head">{problems.length === 0 ? "Complete" : "To fix"}</p>
            {problems.length === 0 ? (
              <p className="allgood">Every field is complete. Check the price below, then publish.</p>
            ) : (
              <ul className="fixes">
                {problems.map((f) => (
                  <li key={f.field} data-status={f.status}>
                    <span className="fix-row"><a href={`#${f.field}`} onClick={goTo(f.field)}>{f.label}</a><span className="pts">{formatPts(f.earned)}/{f.points}</span></span>
                    <span className="msg">{f.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <BuildingCard building={building} />

        <section className="rs bench" aria-label="Price check">
          <p className="rs-head">Price check</p>
          <Benchmark bench={bench} draft={draft} result={result} reference={reference} />
        </section>
      </div>

      {empty ? null : (
        <div className="form-actions results-next">
          <button type="button" className="quiet" id="preview-button-results" onClick={onPreview}>Preview as a listing</button>
          {needsRewrite ? <button type="button" onClick={goTo("rewrite")}>Next: Rewrite</button> : <button type="button" onClick={goTo("export")}>Next: Export</button>}
        </div>
      )}
      </div>
      </div>
    </aside>
  );
}

// From 1000px the pane is pinned under the header and its content moves with the page scroll at
// its own pace: at the top of the page the content is at the top, at the bottom of the page the
// content's end meets the pane's end, and in between it is proportional. One scrollbar, nothing
// unreachable. Focus inside the pane scrolls the page by the amount that brings the element into view.
function usePacedPane(pane, inner) {
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1000px)");
    let raf = 0;
    const metrics = () => {
      const paneH = pane.current.clientHeight;
      const overflow = Math.max(0, inner.current.scrollHeight - paneH);
      const range = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      return { overflow, range };
    };
    const place = () => {
      raf = 0;
      if (!pane.current || !inner.current) return;
      if (!mq.matches) { inner.current.style.transform = ""; return; }
      const { overflow, range } = metrics();
      const progress = Math.min(1, Math.max(0, window.scrollY / range));
      inner.current.style.transform = overflow ? `translateY(${-Math.round(progress * overflow)}px)` : "";
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
    const onFocus = (e) => {
      if (!mq.matches || !pane.current) return;
      const box = pane.current.getBoundingClientRect(), el = e.target.getBoundingClientRect();
      const need = el.bottom > box.bottom - 8 ? el.bottom - box.bottom + 8 : el.top < box.top + 8 ? el.top - box.top - 8 : 0;
      if (!need) return;
      const { overflow, range } = metrics();
      if (overflow) window.scrollBy({ top: (need * range) / overflow, behavior: "auto" });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(inner.current); ro.observe(pane.current); ro.observe(document.documentElement);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    pane.current.addEventListener("focusin", onFocus);
    place();
    const el = pane.current;
    return () => { ro.disconnect(); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); el?.removeEventListener("focusin", onFocus); if (raf) cancelAnimationFrame(raf); };
  }, [pane, inner]);
}

// What we know about the matched building, from our own tables only. Hidden until a building matches.
const TIER_WORD = { luxury: "Luxury", mid: "Mid-range", budget: "Budget" };

function BuildingCard({ building }) {
  if (!building) return null;
  const line = lineFor(building.nearest_station);
  const year = building.completed_year;
  return (
    <section className="rs building-card" aria-label={`About ${building.building_name}`}>
      <p className="rs-head">Building</p>
      <h2>{building.building_name}</h2>
      <p className="building-line">
        {line?.colour ? <span className="line-dot" style={{ background: line.colour }} aria-hidden="true" /> : null}
        <span>{building.nearest_station}</span>
      </p>
      <p className="building-facts muted">
        {building.walk_min
          ? `${building.walk_min} minute${building.walk_min === 1 ? "" : "s"}' walk${line?.name ? ` on the ${line.name}` : ""}.`
          : line?.name ? `On the ${line.name}.` : null}
      </p>
      <p className="building-facts muted">
        {[
          year ? `Built ${year}` : null,
          building.tier ? (TIER_WORD[building.tier] ?? building.tier).toLowerCase() : null,
          `${building.listing_count ?? 0} listing${building.listing_count === 1 ? "" : "s"} in our data`,
        ].filter(Boolean).join(", ")}.
      </p>
    </section>
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
