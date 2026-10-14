// CSV handling shared by the seed script and the importer.
import { parse } from "csv-parse/sync";

export function parseCsv(text) {
  return parse(text, { columns: true, skip_empty_lines: true, bom: true, trim: true });
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
