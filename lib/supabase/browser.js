// Supabase client for the browser. Uses the anon key, which can only read (see RLS in the schema).
import { createClient } from "@supabase/supabase-js";

let client;

export function supabaseBrowser() {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}
