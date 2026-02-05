import { NextResponse } from "next/server";
import { mustGetEnv } from "../../../../lib/env";

export async function POST(req: Request) {
  // Get base URL from RESOLUTION_SERVICE_URL and append /search
  const baseUrl = mustGetEnv("RESOLUTION_SERVICE_URL");
  const agentUrl = `${baseUrl}/search`;
  
  try {
    // Call agent's /search endpoint
    const agentRes = await fetch(agentUrl, {
      method: "GET",
      headers: { "content-type": "application/json" },
    });

    if (!agentRes.ok) {
      throw new Error(`Agent service returned ${agentRes.status}`);
    }

    // Agent handles everything (creates market on-chain and stores in Supabase)
    // Just return success
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to search for disaster" },
      { status: 500 }
    );
  }
}
