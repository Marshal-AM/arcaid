import { NextResponse } from "next/server";
import { supabaseClient } from "../../../lib/supabaseClient";

export async function GET() {
  const sb = supabaseClient();
  const { data, error } = await sb
    .from("markets")
    .select("id, question, category, location, duration_days, policy_id, outcome, state, arc_market_id, arc_market_address, eligible_ngo_ids, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ markets: data ?? [] });
}

