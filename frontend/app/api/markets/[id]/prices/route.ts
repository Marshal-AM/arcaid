import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { supabaseClient } from "../../../../../lib/supabaseClient";
import { mustGetEnv } from "../../../../../lib/env";

const MARKET_ABI = [
  "function getYesPrice() view returns (uint256)",
  "function getNoPrice() view returns (uint256)",
];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: marketId } = await params;

  const sb = supabaseClient();

  // Fetch market to get arc_market_address
  const { data: market, error: marketErr } = await sb
    .from("markets")
    .select("arc_market_address, state")
    .eq("id", marketId)
    .single();

  if (marketErr) return NextResponse.json({ error: marketErr.message }, { status: 500 });
  if (!market) return NextResponse.json({ error: "market not found" }, { status: 404 });
  if (!market.arc_market_address) {
    return NextResponse.json({ error: "Market missing arc_market_address" }, { status: 400 });
  }

  try {
    const rpcUrl = mustGetEnv("ARC_RPC_URL");
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const marketContract = new ethers.Contract(market.arc_market_address, MARKET_ABI, provider);

    const [yesPrice, noPrice] = await Promise.all([
      marketContract.getYesPrice(),
      marketContract.getNoPrice(),
    ]);

    // USDC has 6 decimals
    const yesPriceFormatted = ethers.formatUnits(yesPrice, 6);
    const noPriceFormatted = ethers.formatUnits(noPrice, 6);

    return NextResponse.json({
      yesPrice: yesPriceFormatted,
      noPrice: noPriceFormatted,
      yesPriceWei: yesPrice.toString(),
      noPriceWei: noPrice.toString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to fetch prices" }, { status: 500 });
  }
}
