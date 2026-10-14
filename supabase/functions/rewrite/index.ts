// AI rewrite edge function (SPEC section 7).
//
// POST { listing: {...draft fields}, listing_id?: string }
//   -> { log_id, model, rewrite: { title_en, description_en, title_th, description_th, facts_used },
//        flagged: { field: [tokens] }, facts_added: [tokens] }
// POST { action: "accept", log_id, accepted: boolean }
//   -> { ok: true }
//
// The model only sees the structured draft and the building record. After the response, every
// number and amenity word in the output is checked against the input (factcheck.ts). Anything
// not in the input comes back flagged. Every prompt and response is written to rewrite_log.
// ANTHROPIC_API_KEY lives in Supabase secrets, never in the repo.

import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";
import { createClient } from "npm:@supabase/supabase-js@2";
import { factCheck, type ListingInput } from "../_shared/factcheck.ts";

// Default model, and the models a caller may ask for instead (used by scripts/rewrite-sample.mjs
// to compare). Anything else falls back to the default.
// Sonnet 5.5 chosen on 14 Oct 2026: on 20 sample listings it added nothing not in the input
// (Opus 5 added one fact) and answered in a median 6.0 s against 9.2 s. See BUILD_LOG.
const DEFAULT_MODEL = "claude-sonnet-5-5";
const ALLOWED_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-sonnet-5-5", "claude-haiku-4-5"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RewriteSchema = z.object({
  title_en: z.string(),
  description_en: z.string(),
  title_th: z.string(),
  description_th: z.string(),
  facts_used: z.array(z.string()),
});

const SYSTEM = `You rewrite condo rental listings for property agents in Bangkok.

You receive the agent's draft as JSON, plus the record we hold for the building (name, area, nearest station, walking minutes, year completed). Write four things:

- title_en: 20 to 80 characters, names the building, not in capitals.
- description_en: 150 to 400 characters of natural English. Mention the floor, the view, the furnishing and the nearest station when the input has them.
- title_th and description_th: natural Thai covering the same facts. Not a word-for-word translation. Keep building and station names as written in the input.

Rules:
- Use only facts that appear in the input. Never add amenities, facilities, views, distances, walking times, years, prices or any figure that is not there. If the input lacks something, leave it out rather than guess.
- Do not mention the photo count.
- Do not invent contract terms or deposits unless the draft states them.
- In facts_used, list every fact you relied on, quoted from the input.`;

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  if (body.action === "accept") {
    const { error } = await supabase.from("rewrite_log").update({ accepted: Boolean(body.accepted) }).eq("id", body.log_id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set in Supabase secrets" }, 500);

  const listing = (body.listing ?? {}) as ListingInput;
  const listingId = typeof body.listing_id === "string" ? body.listing_id : null;
  const model = ALLOWED_MODELS.includes(String(body.model)) ? String(body.model) : DEFAULT_MODEL;

  // Resolve the building the same way the completeness checker does: case-insensitive name or alias.
  let building: { building_name: string; area_name: string | null; nearest_station: string; walk_min: number | null; completed_year: number | null } | null = null;
  if (listing.building) {
    const { data: rows } = await supabase
      .from("buildings")
      .select("building_name, nearest_station, walk_min, completed_year, aliases, areas(area_name)");
    const q = norm(listing.building);
    const hit = (rows ?? []).find((b: any) => norm(b.building_name) === q || (b.aliases ?? []).some((a: string) => norm(a) === q));
    if (hit) {
      building = {
        building_name: hit.building_name,
        area_name: (hit as any).areas?.area_name ?? null,
        nearest_station: hit.nearest_station,
        walk_min: hit.walk_min,
        completed_year: hit.completed_year,
      };
    }
  }

  // Only pass fields the agent filled in, so the model cannot read an empty field as a fact.
  const draft: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(listing)) if (v !== null && v !== undefined && String(v).trim() !== "") draft[k] = v;
  const payload = { draft, building };

  const anthropic = new Anthropic({ apiKey });
  let response;
  try {
    response = await anthropic.messages.parse({
      model,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
      output_config: { format: zodOutputFormat(RewriteSchema), effort: "medium" },
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) return json({ error: `Model request failed (${err.status}): ${err.message}` }, 502);
    return json({ error: `Model request failed: ${(err as Error).message}` }, 502);
  }

  if (response.stop_reason === "refusal") return json({ error: "The model declined this request." }, 502);
  const rewrite = response.parsed_output;
  if (!rewrite) return json({ error: "The model did not return a usable rewrite." }, 502);

  const check = factCheck(rewrite, listing, building);

  const { data: logRow, error: logError } = await supabase
    .from("rewrite_log")
    .insert({
      listing_id: listingId,
      model: response.model,
      prompt: { system: SYSTEM, input: payload },
      response: { output: rewrite, usage: response.usage, stop_reason: response.stop_reason },
      facts_added: check.facts_added,
    })
    .select("id")
    .single();
  if (logError) console.error("rewrite_log insert failed:", logError.message);

  return json({
    log_id: logRow?.id ?? null,
    model: response.model,
    rewrite,
    flagged: check.flagged,
    facts_added: check.facts_added,
    building: building ? building.building_name : null,
    usage: response.usage,
  });
});
