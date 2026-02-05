import { NextResponse } from "next/server";
import { supabaseClient } from "../../../../lib/supabaseClient";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ngoId = searchParams.get("ngoId");

  if (!ngoId) {
    return NextResponse.json({ error: "ngoId is required" }, { status: 400 });
  }

  const sb = supabaseClient();

  // Fetch payouts for this NGO
  const { data: payouts, error } = await sb
    .from("yield_payouts")
    .select(`
      id,
      market_id,
      principal_usdc,
      yield_usdc,
      total_usdc,
      preferred_chain,
      circle_transaction_id,
      circle_transaction_state,
      onchain_tx_hash,
      created_at,
      markets (
        id,
        question,
        category,
        location,
        outcome,
        resolved_at
      )
    `)
    .eq("recipient_ngo_id", ngoId)
    .eq("recipient_type", "NGO" as any)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ payouts: payouts || [] });
}
