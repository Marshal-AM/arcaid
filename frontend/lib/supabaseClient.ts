import { createClient } from "@supabase/supabase-js";
import { mustGetEnv } from "./env";

export function supabaseClient() {
  const url = mustGetEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = mustGetEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, anonKey);
}
