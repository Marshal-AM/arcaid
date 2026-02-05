import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { circleWalletClient } from "../../../../lib/circle";
import { supabaseClient } from "../../../../lib/supabaseClient";
import { mustGetEnv } from "../../../../lib/env";
import { ARC_CONTRACTS } from "../../../../lib/constants";

// Creates a Circle developer-controlled wallet on ARC-TESTNET and stores a `traders` record.
// Also funds the wallet with 0.08 USDC from admin (atomic step).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string };
  const username = typeof body.username === "string" ? body.username.trim() : null;

  const circle = circleWalletClient();

  const walletSetResp = await circle.createWalletSet({ name: "Trader Wallet Set" });
  const walletSetId = walletSetResp.data?.walletSet?.id;
  if (!walletSetId) {
    return NextResponse.json({ error: "Failed to create wallet set" }, { status: 500 });
  }

  const walletsResp = await circle.createWallets({
    accountType: "SCA",
    blockchains: ["ARC-TESTNET" as any],
    count: 1,
    walletSetId,
  });

  const wallet = walletsResp.data?.wallets?.[0];
  if (!wallet?.id || !wallet?.address) {
    return NextResponse.json({ error: "Failed to create wallet" }, { status: 500 });
  }

  // ========================================================================
  // ATOMIC STEP: Fund the new wallet with 0.08 USDC from admin
  // ========================================================================
  try {
    const arcRpcUrl = mustGetEnv("ARC_RPC_URL");
    const adminPk = mustGetEnv("ADMIN_PRIVATE_KEY");
    const usdcAddress = ARC_CONTRACTS.USDC;

    const provider = new ethers.JsonRpcProvider(arcRpcUrl);
    const adminWallet = new ethers.Wallet(adminPk.startsWith("0x") ? adminPk : `0x${adminPk}`, provider);

    const usdcContract = new ethers.Contract(
      usdcAddress,
      [
        "function transfer(address to, uint256 amount) returns (bool)",
        "function balanceOf(address) view returns (uint256)",
      ],
      adminWallet
    );

    const fundAmount = ethers.parseUnits("0.08", 6); // 0.08 USDC
    
    // Check admin balance
    const adminBalance = await usdcContract.balanceOf(adminWallet.address);
    const adminBalanceFormatted = ethers.formatUnits(adminBalance, 6);

    if (adminBalance < fundAmount) {
      return NextResponse.json(
        { error: `Insufficient admin balance. Have: ${adminBalanceFormatted} USDC, Need: 0.08 USDC` },
        { status: 500 }
      );
    }

    // Transfer USDC from admin to new wallet
    const fundTx = await usdcContract.transfer(wallet.address, fundAmount);
    const receipt = await fundTx.wait();

    // Verify funding succeeded
    const walletBalance = await usdcContract.balanceOf(wallet.address);
    const walletBalanceFormatted = ethers.formatUnits(walletBalance, 6);

    if (walletBalance < fundAmount) {
      return NextResponse.json(
        { error: "Wallet funding transaction completed but balance verification failed" },
        { status: 500 }
      );
    }
  } catch (fundError: any) {
    return NextResponse.json(
      { error: `Failed to fund wallet: ${fundError?.message || "Unknown error"}` },
      { status: 500 }
    );
  }

  const sb = supabaseClient();
  const { data: trader, error } = await sb
    .from("traders")
    .insert({
      username,
      circle_wallet_set_id: walletSetId,
      circle_wallet_id: wallet.id,
      wallet_address: wallet.address,
      blockchain: "ARC-TESTNET",
    })
    .select("id, username, circle_wallet_id, wallet_address, blockchain")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    trader,
    wallet: { id: wallet.id, address: wallet.address, blockchain: "ARC-TESTNET" },
    funded: true,
    fundAmount: "0.08",
  });
}

