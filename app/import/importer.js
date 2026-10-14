"use client";

import { useState } from "react";

export default function Importer() {
  const [file, setFile] = useState(null);
  const [key, setKey] = useState("");
  const [state, setState] = useState({ status: "idle" });

  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    setState({ status: "loading" });
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/import", { method: "POST", headers: { "x-import-key": key }, body: form });
    let data;
    try { data = await res.json(); } catch { data = { error: `The server answered ${res.status} without details.` }; }
    setState(res.ok ? { status: "done", data } : { status: "error", error: data.error, data });
  }

  return (
    <>
      <header className="top">
        <h1><a href="/" className="plain">Listing check</a> · Import listings</h1>
        <p className="banner">Load your own listings and the checker and the price benchmark run on them instead of the sample.</p>
      </header>

      <div className="layout single">
        <form className="form import" onSubmit={submit}>
          <p>
            The file needs the same columns as <code>data/listings.csv</code>: listing_id, building_id, area_id, title, description_en,
            description_th, bedrooms, bathrooms, size_sqm, floor, monthly_rent_thb, furnishing, photo_count, nearest_station, listed_date,
            status, flaws. Building and area ids must match the buildings and areas tables. Blank cells are fine; that is what the checker is for.
            Rows with the same listing_id as an existing listing replace it.
          </p>

          <div className="field">
            <label className="label" htmlFor="file">CSV file</label>
            <input id="file" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>

          <div className="field">
            <label className="label" htmlFor="key">Import key</label>
            <input id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
            <p className="hint">Set as IMPORT_KEY on the server. Ask whoever deployed the app.</p>
          </div>

          <div className="form-actions">
            <button type="submit" disabled={!file || !key || state.status === "loading"}>
              {state.status === "loading" ? "Loading…" : "Load listings"}
            </button>
          </div>

          {state.status === "error" ? <p className="fieldmsg">{state.error}</p> : null}

          {state.status === "done" || (state.status === "error" && state.data?.skipped) ? (
            <div className="import-report">
              <p className="allgood">
                Loaded {state.data.loaded} of {state.data.total} row{state.data.total === 1 ? "" : "s"}.
                {state.data.skipped.length ? ` Skipped ${state.data.skipped.length}:` : " Nothing skipped."}
              </p>
              {state.data.skipped.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Row</th><th>listing_id</th><th>Why</th></tr></thead>
                    <tbody>
                      {state.data.skipped.map((s) => (
                        <tr key={s.row}><td>{s.row}</td><td>{s.listing_id ?? ""}</td><td>{s.reason}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <p><a href="/">Back to the checker</a></p>
            </div>
          ) : null}
        </form>
      </div>
    </>
  );
}
