import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { circleWalletClient } from "../../../../lib/circle";
import { mustGetEnv } from "../../../../lib/env";

const ARC_USDC = "0x3600000000000000000000000000000000000000"; // Arc testnet native USDC

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { circleWalletId?: string };
  const walletId = typeof body.circleWalletId === "string" ? body.circleWalletId : null;
  if (!walletId) {
    return NextResponse.json({ error: "circleWalletId is required" }, { status: 400 });
  }

  try {
    const circle = circleWalletClient();
    const walletResp = await circle.getWallet({ id: walletId });
    const walletAddress = walletResp.data?.wallet?.address;
    
    if (!walletAddress) {
      return NextResponse.json({ error: "Could not retrieve wallet address" }, { status: 500 });
    }

    // Ensure address is checksummed
    const checksummedAddress = ethers.getAddress(walletAddress);

    const arcRpcUrl = mustGetEnv("ARC_RPC_URL");
    const provider = new ethers.JsonRpcProvider(arcRpcUrl);
    const usdcContract = new ethers.Contract(
      ARC_USDC,
      ["function balanceOf(address) view returns (uint256)"],
      provider
    );

    const balance = await usdcContract.balanceOf(checksummedAddress);
    const usdcAmount = ethers.formatUnits(balance, 6); // USDC has 6 decimals

    return NextResponse.json({
      walletId,
      walletAddress: checksummedAddress,
      usdcAmount,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: `Failed to check balance: ${error?.message || "Unknown error"}` },
      { status: 500 }
    );
  }
}

