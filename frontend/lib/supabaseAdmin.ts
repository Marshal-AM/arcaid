import { createClient } from "@supabase/supabase-js";
import { mustGetEnv } from "./env";

export function supabaseAdmin() {
  return createClient(mustGetEnv("SUPABASE_URL"), mustGetEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

