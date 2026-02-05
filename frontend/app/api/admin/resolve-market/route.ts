import { NextResponse } from "next/server";
import { supabaseClient } from "../../../../lib/supabaseClient";
import { mustGetEnv } from "../../../../lib/env";

type Body = {
  marketId: string; // markets.id (uuid)
};

type ResolutionResponse = {
  marketId: string;
  outcome: number; // 1 = YES, 2 = NO, 0 = PENDING, 3 = INVALID
  confidence: number; // basis points (e.g., 9500 = 95%)
  evidence_string: string;
  market_resolved?: boolean;
  resolution_tx_hash?: string | null;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const sb = supabaseClient();

  // Fetch market details
  const { data: market, error: marketErr } = await sb
    .from("markets")
    .select("id, arc_market_id, arc_market_address, state, outcome, question")
    .eq("id", body.marketId)
    .single();

  if (marketErr) return NextResponse.json({ error: marketErr.message }, { status: 500 });
  if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 });
  if (market.state !== "OPEN") {
    return NextResponse.json({ error: `Market is not OPEN (state=${market.state})` }, { status: 400 });
  }
  if (market.outcome) {
    return NextResponse.json({ error: "Market already has an outcome" }, { status: 400 });
  }
  if (!market.arc_market_id) {
    return NextResponse.json({ error: "Market missing arc_market_id" }, { status: 400 });
  }
  if (!market.question) {
    return NextResponse.json({ error: "Market missing question" }, { status: 400 });
  }

  // Call external resolution service (/verify endpoint)
  const baseUrl = mustGetEnv("RESOLUTION_SERVICE_URL");
  const verifyUrl = `${baseUrl}/verify`;
  
  try {
    const resolutionRes = await fetch(verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: market.arc_market_id, question: market.question }),
    });

    if (!resolutionRes.ok) {
      throw new Error(`Resolution service returned ${resolutionRes.status}`);
    }

    const resolution = (await resolutionRes.json()) as ResolutionResponse;

    // Map outcome number to string
    let outcomeStr: string | null = null;
    if (resolution.outcome === 1) outcomeStr = "YES";
    else if (resolution.outcome === 2) outcomeStr = "NO";
    else if (resolution.outcome === 3) outcomeStr = "INVALID";
    // outcome === 0 means PENDING, keep as null

    // Update market with outcome in Supabase
    const { error: updateErr } = await sb
      .from("markets")
      .update({
        outcome: outcomeStr,
        resolved_at: new Date().toISOString(),
        state: outcomeStr ? "RESOLVED" : "OPEN",
      })
      .eq("id", body.marketId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // If outcome is YES or NO, trigger payout process
    if (outcomeStr === "YES" || outcomeStr === "NO") {
      // Trigger payout process asynchronously (don't wait for it)
      // Construct absolute URL for internal API call
      const url = new URL(req.url);
      const baseUrl = `${url.protocol}//${url.host}`;
      const executePayoutsUrl = `${baseUrl}/api/admin/execute-payouts`;
      
      fetch(executePayoutsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketId: body.marketId }),
      }).catch((err) => {
        console.error("Failed to trigger payout process:", err);
      });
    }

    return NextResponse.json({
      success: true,
      outcome: outcomeStr,
      confidence: resolution.confidence,
      evidence: resolution.evidence_string,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to resolve market" },
      { status: 500 }
    );
  }
}
