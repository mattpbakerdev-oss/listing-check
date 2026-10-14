// CSV importer (SPEC section 8). Accepts a file with the same columns as data/listings.csv,
// validates every row, loads the good ones with the service role key, and reports the rest.
// Guarded by IMPORT_KEY, a shared secret the person importing types into the page. The
// service role key never leaves the server.

import { createClient } from "@supabase/supabase-js";
import { parseCsv } from "../../../lib/import/csv.js";
import { validateRows } from "../../../lib/import/validate.js";

export const runtime = "nodejs";

const CHUNK = 200;

export async function POST(req) {
  if (!process.env.IMPORT_KEY) return Response.json({ error: "Importing is switched off: IMPORT_KEY is not set on the server." }, { status: 503 });
  if (req.headers.get("x-import-key") !== process.env.IMPORT_KEY) return Response.json({ error: "Wrong import key." }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return Response.json({ error: "Choose a CSV file first." }, { status: 400 });

  let rows;
  try {
    rows = parseCsv(await file.text());
  } catch (e) {
    return Response.json({ error: `Could not read that as CSV: ${e.message}` }, { status: 400 });
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const [buildings, areas] = await Promise.all([
    admin.from("buildings").select("building_id, area_id"),
    admin.from("areas").select("area_id"),
  ]);
  if (buildings.error || areas.error) return Response.json({ error: "Could not load the reference tables." }, { status: 500 });

  const { ok, skipped, fileError } = validateRows(rows, { buildings: buildings.data, areas: areas.data });
  if (fileError) return Response.json({ error: fileError }, { status: 400 });

  let loaded = 0;
  for (let i = 0; i < ok.length; i += CHUNK) {
    const chunk = ok.slice(i, i + CHUNK);
    const { error } = await admin.from("listings").upsert(chunk);
    if (error) return Response.json({ error: `Loading stopped at row ${i + 2}: ${error.message}`, loaded, skipped, total: rows.length }, { status: 500 });
    loaded += chunk.length;
  }

  return Response.json({ loaded, skipped, total: rows.length });
}
