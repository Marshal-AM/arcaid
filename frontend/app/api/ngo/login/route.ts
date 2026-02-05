import { NextResponse } from "next/server";
import { supabaseClient } from "../../../../lib/supabaseClient";
import * as crypto from "crypto";

type Body = {
  email: string;
  password: string;
};

// Simple password hashing (in production, use bcrypt or similar)
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const sb = supabaseClient();

  // Find NGO by email
  const { data: ngo, error } = await sb
    .from("ngos")
    .select("id, name, email, password_hash, wallet_type, wallet_address, preferred_chain, description, location")
    .eq("email", email)
    .single();

  if (error || !ngo) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Check password
  const passwordHash = hashPassword(password);
  if (ngo.password_hash !== passwordHash) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Return NGO data (excluding password)
  const { password_hash, ...ngoData } = ngo;
  return NextResponse.json({ ngo: ngoData });
}
