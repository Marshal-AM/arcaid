import { NextResponse } from "next/server";
import { supabaseClient } from "../../../../lib/supabaseClient";

type Body = {
  ngoId: string;
  name?: string;
  description?: string;
  location?: string;
  preferredChain?: string;
  walletAddress?: string; // For EVM_EXTERNAL wallets
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ngoId = searchParams.get("ngoId");

  if (!ngoId) {
    return NextResponse.json({ error: "ngoId is required" }, { status: 400 });
  }

  const sb = supabaseClient();

  const { data: ngo, error } = await sb
    .from("ngos")
    .select("id, name, email, description, location, preferred_chain, wallet_type, wallet_address, circle_wallet_id, created_at")
    .eq("id", ngoId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!ngo) return NextResponse.json({ error: "NGO not found" }, { status: 404 });

  return NextResponse.json({ ngo });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { ngoId, name, description, location, preferredChain, walletAddress } = body;

  if (!ngoId) {
    return NextResponse.json({ error: "ngoId is required" }, { status: 400 });
  }

  const sb = supabaseClient();

  const updateData: any = {};
  if (name !== undefined) updateData.name = name.trim() || null;
  if (description !== undefined) updateData.description = description?.trim() || null;
  if (location !== undefined) updateData.location = location?.trim() || null;
  if (preferredChain !== undefined) updateData.preferred_chain = preferredChain.trim() || null;
  if (walletAddress !== undefined) updateData.wallet_address = walletAddress?.trim() || null;

  const { data: ngo, error } = await sb
    .from("ngos")
    .update(updateData)
    .eq("id", ngoId)
    .select("id, name, email, description, location, preferred_chain, wallet_type, wallet_address, circle_wallet_id, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ngo });
}
