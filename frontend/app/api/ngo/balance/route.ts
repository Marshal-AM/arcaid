import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { circleWalletClient } from "../../../../lib/circle";
import { mustGetEnv } from "../../../../lib/env";
import { supabaseClient } from "../../../../lib/supabaseClient";
import { CIRCLE_USDC_ADDRESSES, getCircleUsdcAddress } from "../../../../lib/constants";

// Get RPC URL for a chain (from env variables)
function getRpcUrl(chain: string): string {
  const rpcMap: Record<string, string> = {
    "BASE-SEPOLIA": mustGetEnv("BASE_SEPOLIA_RPC_URL"),
    "ARB-SEPOLIA": mustGetEnv("ARB_SEPOLIA_RPC_URL") || "",
    "AVAX-FUJI": mustGetEnv("AVAX_FUJI_RPC_URL") || "",
    "ETH-SEPOLIA": mustGetEnv("ETH_SEPOLIA_RPC_URL") || "",
    "OP-SEPOLIA": mustGetEnv("OP_SEPOLIA_RPC_URL") || "",
    "MATIC-AMOY": mustGetEnv("MATIC_AMOY_RPC_URL") || "",
    "UNI-SEPOLIA": mustGetEnv("UNI_SEPOLIA_RPC_URL") || "",
    "APTOS-TESTNET": mustGetEnv("APTOS_TESTNET_RPC_URL") || "",
    "ARC-TESTNET": mustGetEnv("ARC_RPC_URL"),
    "MONAD-TESTNET": mustGetEnv("MONAD_TESTNET_RPC_URL") || "",
    "SOL-DEVNET": mustGetEnv("SOL_DEVNET_RPC_URL") || "",
  };
  return rpcMap[chain] || "";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ngoId = searchParams.get("ngoId");

  if (!ngoId) {
    return NextResponse.json({ error: "ngoId is required" }, { status: 400 });
  }

  try {
    const sb = supabaseClient();

    // Fetch NGO details
    const { data: ngo, error: ngoError } = await sb
      .from("ngos")
      .select("id, preferred_chain, wallet_type, wallet_address, circle_wallet_id")
      .eq("id", ngoId)
      .single();

    if (ngoError || !ngo) {
      return NextResponse.json({ error: "NGO not found" }, { status: 404 });
    }

    if (!ngo.preferred_chain) {
      return NextResponse.json({ error: "NGO has no preferred chain set" }, { status: 400 });
    }

    const preferredChain = ngo.preferred_chain;
    const usdcAddress = getCircleUsdcAddress(preferredChain);

    if (!usdcAddress) {
      return NextResponse.json({ error: `USDC address not configured for chain: ${preferredChain}` }, { status: 400 });
    }

    let balance = "0";
    let walletAddress = ngo.wallet_address;

    // If Circle wallet, get balance from Circle API
    if (ngo.wallet_type === "CIRCLE_DEV" && ngo.circle_wallet_id) {
      try {
        const circle = circleWalletClient();
        const balanceResponse = await circle.getWalletTokenBalance({
          id: ngo.circle_wallet_id,
        });

        const tokenBalances = (balanceResponse.data as any)?.tokenBalances || (balanceResponse.data as any)?.balances || [];
        
        // Find USDC token by symbol or address
        const usdcAddressLower = usdcAddress.toLowerCase();
        const usdcToken = tokenBalances.find((token: any) => {
          const tokenInfo = token.token || token;
          const symbol = (tokenInfo?.symbol || "").toUpperCase();
          const address = (tokenInfo?.tokenAddress || tokenInfo?.address || "").toLowerCase();
          return symbol.includes("USDC") || (usdcAddressLower && address === usdcAddressLower);
        });

        if (usdcToken) {
          balance = usdcToken.amount || usdcToken.balance || "0";
        }

        // Get wallet address from Circle
        const walletResp = await circle.getWallet({ id: ngo.circle_wallet_id });
        walletAddress = walletResp.data?.wallet?.address || ngo.wallet_address;
      } catch (error: any) {
        console.error("Error fetching Circle wallet balance:", error?.message);
        // Fall through to on-chain check
      }
    }

    // If balance is still 0 or Circle API failed, try on-chain check
    if (balance === "0" && walletAddress) {
      try {
        const rpcUrl = getRpcUrl(preferredChain);
        if (!rpcUrl) {
          return NextResponse.json({ error: `RPC URL not configured for chain: ${preferredChain}` }, { status: 400 });
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const usdcContract = new ethers.Contract(
          usdcAddress,
          ["function balanceOf(address) view returns (uint256)"],
          provider
        );

        const checksummedAddress = ethers.getAddress(walletAddress);
        const balanceWei = await usdcContract.balanceOf(checksummedAddress);
        balance = ethers.formatUnits(balanceWei, 6); // USDC has 6 decimals
      } catch (error: any) {
        console.error("Error fetching on-chain balance:", error?.message);
        // Return 0 if both methods fail
      }
    }

    return NextResponse.json({
      ngoId,
      preferredChain,
      walletAddress,
      usdcBalance: balance,
      usdcAddress,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Failed to fetch balance: ${error?.message || "Unknown error"}` },
      { status: 500 }
    );
  }
}
