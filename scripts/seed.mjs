// Seed the Supabase project from the CSVs in /data.
// Usage: npm run seed   (reads .env.local via node --env-file)
//
// Upserts areas -> buildings -> listings so foreign keys resolve. Re-running is safe:
// rows are matched on their primary key and overwritten. Empty CSV cells become NULL.
// The same CSV handling (parseCsv, normaliseRow) is what the step 5 importer will reuse.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");
const CHUNK = 200;

export function parseCsv(text) {
  return parse(text, { columns: true, skip_empty_lines: true, bom: true });
}

// Empty strings mean "not provided". Postgres would reject '' for integer columns,
// and the completeness checker treats NULL as missing, so map every empty cell to null.
export function normaliseRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === "string" && v.trim() === "" ? null : v;
  }
  return out;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. Put it in .env.local (see .env.example).`);
    process.exit(1);
  }
  return v;
}

async function upsertTable(supabase, table, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(chunk);
    if (error) {
      console.error(`upsert into ${table} failed at row ${i}: ${error.message}`);
      process.exit(1);
    }
  }
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) {
    console.error(`count of ${table} failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`${table.padEnd(10)} upserted ${rows.length}, table now has ${count}`);
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  for (const table of ["areas", "buildings", "listings"]) {
    const rows = parseCsv(readFileSync(resolve(DATA_DIR, `${table}.csv`), "utf8")).map(normaliseRow);
    await upsertTable(supabase, table, rows);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
