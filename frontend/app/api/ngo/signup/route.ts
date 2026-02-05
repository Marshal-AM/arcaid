import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { circleWalletClient } from "../../../../lib/circle";
import { supabaseClient } from "../../../../lib/supabaseClient";
import { mustGetEnv } from "../../../../lib/env";
import { ARC_CONTRACTS } from "../../../../lib/constants";
import * as crypto from "crypto";

type Body = {
  name: string;
  email: string;
  password: string;
  description?: string;
  location?: string;
  preferredChain: string;
  walletType: "CIRCLE_DEV" | "EVM_EXTERNAL";
  externalWalletAddress?: string;
};

// Simple password hashing (in production, use bcrypt or similar)
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

// Map preferred chain to chain ID (for registerNGO contract call)
// These are the destination chain IDs where the NGO wants to receive funds
function getChainId(preferredChain: string): number {
  const chainIdMap: Record<string, number> = {
    "BASE-SEPOLIA": 84532, // Base Sepolia
    "ARB-SEPOLIA": 421614, // Arbitrum Sepolia
    "AVAX-FUJI": 43113, // Avalanche Fuji
    "ETH-SEPOLIA": 11155111, // Ethereum Sepolia
    "OP-SEPOLIA": 11155420, // Optimism Sepolia
    "MATIC-AMOY": 80002, // Polygon Amoy
    "UNI-SEPOLIA": 1301, // Unichain Sepolia
    "MONAD-TESTNET": 10143, // Monad Testnet
    "APTOS-TESTNET": 0, // Aptos doesn't use EVM chain IDs - use 0 as placeholder
    "SOL-DEVNET": 0, // Solana doesn't use EVM chain IDs - use 0 as placeholder
    "ARC-TESTNET": 421614, // Arc Testnet (uses same chain ID as Arbitrum Sepolia)
  };
  return chainIdMap[preferredChain] || 0;
}

// Register NGO on-chain and return arc_ngo_id
async function registerNGOOnChain(
  name: string,
  ngoAddress: string,
  circleWalletId: string,
  preferredChain: string
): Promise<string> {
  const arcRpcUrl = mustGetEnv("ARC_RPC_URL");
  const adminPk = mustGetEnv("ADMIN_PRIVATE_KEY");
  const ngoRegistryAddress = ARC_CONTRACTS.NGO_REGISTRY;

  const provider = new ethers.JsonRpcProvider(arcRpcUrl);
  const privateKey = adminPk.startsWith("0x") ? adminPk : `0x${adminPk}`;
  const signer = new ethers.Wallet(privateKey, provider);

  const ngoRegistry = new ethers.Contract(
    ngoRegistryAddress,
    [
      "function registerNGO(string,address,string,uint256) external returns (bytes32)",
      "function verifyNGO(bytes32) external",
    ],
    signer
  );

  const chainId = getChainId(preferredChain);
  if (chainId === 0) {
    throw new Error(`Chain ID not found for preferred chain: ${preferredChain}`);
  }

  // Register NGO on-chain
  const tx = await ngoRegistry.registerNGO(name, ngoAddress, circleWalletId, chainId);
  const receipt = await tx.wait();

  // Parse NGO ID from event logs
  // Look for NGORegistered event: event NGORegistered(bytes32 indexed ngoId, string name, string circleWalletId);
  let ngoId: string | null = null;
  const ngoRegistryInterface = new ethers.Interface([
    "event NGORegistered(bytes32 indexed ngoId, string name, string circleWalletId)",
  ]);

  for (const log of receipt.logs || []) {
    try {
      const parsed = ngoRegistryInterface.parseLog(log);
      if (parsed && parsed.name === "NGORegistered") {
        ngoId = parsed.args.ngoId;
        break;
      }
    } catch (e) {
      // Not this log, continue
    }
  }

  if (!ngoId) {
    // Fallback: generate from name and timestamp
    ngoId = ethers.id(name + Date.now());
    console.warn("⚠️  Could not parse NGO ID from event, using generated ID");
  }

  // Verify NGO (as per test_system.js)
  const verifyTx = await ngoRegistry.verifyNGO(ngoId);
  await verifyTx.wait();

  return ngoId;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const preferredChain = (body.preferredChain || "").trim();
  const walletType = body.walletType;

  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "password is required and must be at least 6 characters" }, { status: 400 });
  }
  if (!preferredChain) return NextResponse.json({ error: "preferredChain is required" }, { status: 400 });
  if (walletType !== "CIRCLE_DEV" && walletType !== "EVM_EXTERNAL") {
    return NextResponse.json({ error: "walletType must be CIRCLE_DEV or EVM_EXTERNAL" }, { status: 400 });
  }

  const sb = supabaseClient();

  if (walletType === "EVM_EXTERNAL") {
    const addr = (body.externalWalletAddress || "").trim();
    if (!addr || !addr.startsWith("0x") || addr.length < 10) {
      return NextResponse.json({ error: "externalWalletAddress is required for EVM_EXTERNAL" }, { status: 400 });
    }

    // Register NGO on-chain FIRST (before Supabase insert)
    let arcNgoId: string;
    try {
      // For EVM_EXTERNAL, use the external wallet address as the circleWalletId parameter
      // (the contract accepts any string for this field)
      arcNgoId = await registerNGOOnChain(name, addr, addr, preferredChain);
    } catch (onChainError: any) {
      return NextResponse.json(
        { error: `Failed to register NGO on-chain: ${onChainError?.message || "Unknown error"}` },
        { status: 500 }
      );
    }

    const passwordHash = hashPassword(password);
    
    const { data, error } = await sb
      .from("ngos")
      .insert({
        name,
        email,
        password_hash: passwordHash,
        description: body.description ?? null,
        location: body.location ?? null,
        preferred_chain: preferredChain,
        wallet_type: "EVM_EXTERNAL",
        wallet_address: addr,
        arc_ngo_id: arcNgoId,
      })
      .select("id, name, email, preferred_chain, wallet_type, wallet_address, arc_ngo_id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ngo: data });
  }

  // CIRCLE_DEV
  const circle = circleWalletClient();

  const walletSetResp = await circle.createWalletSet({ name: "NGO Wallet Set" });
  const walletSetId = walletSetResp.data?.walletSet?.id;
  if (!walletSetId) return NextResponse.json({ error: "Failed to create wallet set" }, { status: 500 });

  const walletsResp = await circle.createWallets({
    accountType: "SCA",
    blockchains: [preferredChain as any], // Circle SDK expects specific Blockchain type, but we use string
    count: 1,
    walletSetId,
  });

  const wallet = walletsResp.data?.wallets?.[0];
  if (!wallet?.id || !wallet?.address) {
    return NextResponse.json({ error: "Failed to create Circle wallet" }, { status: 500 });
  }

  // Register NGO on-chain FIRST (before Supabase insert)
  let arcNgoId: string;
  try {
    arcNgoId = await registerNGOOnChain(name, wallet.address, wallet.id, preferredChain);
  } catch (onChainError: any) {
    return NextResponse.json(
      { error: `Failed to register NGO on-chain: ${onChainError?.message || "Unknown error"}` },
      { status: 500 }
    );
  }

  const passwordHash = hashPassword(password);
  
  const { data, error } = await sb
    .from("ngos")
    .insert({
      name,
      email,
      password_hash: passwordHash,
      description: body.description ?? null,
      location: body.location ?? null,
      preferred_chain: preferredChain,
      wallet_type: "CIRCLE_DEV",
      circle_wallet_set_id: walletSetId,
      circle_wallet_id: wallet.id,
      wallet_address: wallet.address,
      arc_ngo_id: arcNgoId,
    })
    .select("id, name, email, preferred_chain, wallet_type, circle_wallet_id, wallet_address, arc_ngo_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ngo: data,
    wallet: { id: wallet.id, address: wallet.address, blockchain: preferredChain },
  });
}

