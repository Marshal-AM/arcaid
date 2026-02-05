import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createEthersAdapterFromPrivateKey } from "@circle-fin/adapter-ethers-v6";
import { supabaseClient } from "../../../../lib/supabaseClient";
import { circleWalletClient } from "../../../../lib/circle";
import { mustGetEnv } from "../../../../lib/env";
import {
  CHAIN_TO_BRIDGE_NAME,
  CIRCLE_USDC_ADDRESSES,
  ARC_CONTRACTS,
  BASE_SEPOLIA_CONTRACTS,
  getCircleUsdcAddress as getCircleUsdcAddressFromConstants,
} from "../../../../lib/constants";

type Body = {
  marketId: string; // markets.id (uuid)
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

// Find ALL position IDs for a market by querying YieldController events
// Each trade may create its own position, so we need to find all of them
async function findAllPositionIds(
  marketId: string,
  yieldControllerAddress: string,
  baseProvider: ethers.Provider,
  fromBlock: number = 0
): Promise<Array<{ positionId: string; amount: bigint; blockNumber: number }>> {
  const yieldController = new ethers.Contract(
    yieldControllerAddress,
    ["event FundsDeployedToAave(bytes32 indexed positionId, bytes32 arcMarketId, uint256 amount)"],
    baseProvider
  );

  // Ensure marketId is properly formatted as bytes32 (add 0x prefix if missing)
  let marketIdBytes32 = marketId;
  if (!marketIdBytes32.startsWith("0x")) {
    marketIdBytes32 = "0x" + marketIdBytes32;
  }
  // Ensure it's exactly 66 characters (0x + 64 hex chars) for bytes32
  if (marketIdBytes32.length !== 66) {
    throw new Error(`Invalid marketId length: ${marketIdBytes32.length}, expected 66 (0x + 64 hex chars). Value: ${marketIdBytes32}`);
  }

  try {
    // Query events from the last 10000 blocks (or fromBlock if provided)
    // Note: arcMarketId is NOT indexed, so we can't filter by it directly
    const toBlock = await baseProvider.getBlockNumber();
    const from = fromBlock > 0 ? fromBlock : Math.max(0, toBlock - 10000);

    // Query all FundsDeployedToAave events
    const filter = yieldController.filters.FundsDeployedToAave();
    const events = await yieldController.queryFilter(filter, from, toBlock);

    // Filter events by arcMarketId in JavaScript (since it's not indexed)
    const matchingEvents = events
      .filter((event) => {
        if (!("args" in event) || !event.args) return false;
        // event.args[1] is arcMarketId (positionId is args[0], arcMarketId is args[1])
        const eventMarketId = event.args[1] || event.args.arcMarketId;
        if (!eventMarketId) return false;
        // Compare as hex strings (normalize both)
        const eventMarketIdHex = typeof eventMarketId === "string" 
          ? eventMarketId.toLowerCase() 
          : eventMarketId.toString().toLowerCase();
        const targetMarketIdHex = marketIdBytes32.toLowerCase();
        return eventMarketIdHex === targetMarketIdHex;
      })
      .map((event) => {
        if (!("args" in event) || !event.args) return null;
        const positionId = event.args[0] || event.args.positionId;
        const amount = event.args[2] || event.args.amount || BigInt(0);
        return {
          positionId: typeof positionId === "string" ? positionId : positionId.toString(),
          amount: typeof amount === "bigint" ? amount : BigInt(amount.toString()),
          blockNumber: event.blockNumber,
        };
      })
      .filter((item): item is { positionId: string; amount: bigint; blockNumber: number } => item !== null);

    // Sort by block number (oldest first) to maintain order
    matchingEvents.sort((a, b) => a.blockNumber - b.blockNumber);

    return matchingEvents;
  } catch (e: any) {
    console.error("Error finding position IDs:", e?.message);
    return [];
  }
}

export async function POST(req: Request) {
  console.log("=".repeat(80));
  console.log("EXECUTE PAYOUTS: Starting payout execution");
  console.log("=".repeat(80));

  const body = (await req.json().catch((err) => {
    console.error("Failed to parse request body:", err);
    return null;
  })) as Body | null;
  
  if (!body) {
    console.error("Invalid JSON body - missing or malformed");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  console.log(`Market ID: ${body.marketId}`);

  const sb = supabaseClient();

  try {
    // ========================================================================
    // STEP 1: Fetch market and related data
    // ========================================================================
    console.log("STEP 1: Fetching market and related data...");
    
    const { data: market, error: marketErr } = await sb
      .from("markets")
      .select("id, arc_market_id, arc_market_address, outcome, state, eligible_ngo_ids")
      .eq("id", body.marketId)
      .single();

    if (marketErr) {
      console.error("Market fetch error:", marketErr);
      return NextResponse.json({ error: marketErr.message }, { status: 500 });
    }
    if (!market) {
      console.error("Market not found for ID:", body.marketId);
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }
    
    console.log(`Market found: ${market.id}, state: ${market.state}, outcome: ${market.outcome}`);
    
    if (market.state !== "RESOLVED" || !market.outcome) {
      console.error(`Market validation failed: state=${market.state}, outcome=${market.outcome}`);
      return NextResponse.json({ error: "Market must be RESOLVED with an outcome" }, { status: 400 });
    }
    if (!market.arc_market_id || !market.arc_market_address) {
      console.error("Market missing onchain identifiers:", { arc_market_id: market.arc_market_id, arc_market_address: market.arc_market_address });
      return NextResponse.json({ error: "Market missing onchain identifiers" }, { status: 400 });
    }

    // Fetch all trades for this market
    console.log("Fetching trades for market...");
    const { data: trades, error: tradesErr } = await sb
      .from("trades")
      .select("id, trader_id, side, amount_usdc, traders(id, circle_wallet_id, wallet_address)")
      .eq("market_id", body.marketId);

    if (tradesErr) {
      console.error("Trades fetch error:", tradesErr);
      return NextResponse.json({ error: tradesErr.message }, { status: 500 });
    }
    
    console.log(`Found ${trades?.length || 0} trades`);

    // Calculate total deposit amount
    const depositAmount = trades?.reduce((sum, t) => sum + Number(t.amount_usdc || 0), 0) || 0;
    const depositAmountWei = ethers.parseUnits(depositAmount.toFixed(6), 6);
    console.log(`Total deposit amount: ${depositAmount} USDC`);

    // Fetch eligible NGOs
    // Note: eligible_ngo_ids contains arc_ngo_id values (bytes32 hex strings as text[])
    console.log("Fetching eligible NGOs...");
    let ngoIds = (market.eligible_ngo_ids || []) as string[];
    
    // Normalize arc_ngo_id values: ensure they have 0x prefix for consistent querying
    // The values might be stored with or without 0x prefix
    ngoIds = ngoIds.map((id) => {
      if (!id) return id;
      // If it doesn't start with 0x, add it
      return id.startsWith("0x") ? id : `0x${id}`;
    });
    
    console.log(`Eligible NGO IDs (arc_ngo_id):`, ngoIds);
    
    // Query by arc_ngo_id, not by id (UUID)
    // Try both with and without 0x prefix to handle any inconsistencies
    const { data: ngos, error: ngosErr } = await sb
      .from("ngos")
      .select("id, name, preferred_chain, wallet_type, circle_wallet_id, wallet_address, arc_ngo_id")
      .in("arc_ngo_id", ngoIds);

    if (ngosErr) {
      console.error("NGOs fetch error:", ngosErr);
      return NextResponse.json({ error: ngosErr.message }, { status: 500 });
    }
    
    console.log(`Found ${ngos?.length || 0} eligible NGOs`);

    // ========================================================================
    // STEP 2: Setup providers and signers
    // ========================================================================
    console.log("STEP 2: Setting up providers and signers...");
    
    let arcRpcUrl: string;
    let baseRpcUrl: string;
    let adminPk: string;
    
    try {
      arcRpcUrl = mustGetEnv("ARC_RPC_URL");
      baseRpcUrl = mustGetEnv("BASE_SEPOLIA_RPC_URL");
      adminPk = mustGetEnv("ADMIN_PRIVATE_KEY");
      console.log("Environment variables loaded successfully");
    } catch (envError: any) {
      console.error("Failed to load environment variables:", envError?.message);
      throw new Error(`Missing required environment variable: ${envError?.message}`);
    }
    const yieldControllerAddress = BASE_SEPOLIA_CONTRACTS.YIELD_CONTROLLER;
    const aaveUsdcAddress = BASE_SEPOLIA_CONTRACTS.AAVE_USDC;
    const circleUsdcAddress = BASE_SEPOLIA_CONTRACTS.CIRCLE_USDC;
    const swapRouterAddress = BASE_SEPOLIA_CONTRACTS.SWAP_ROUTER;
    const treasuryVaultAddress = ARC_CONTRACTS.TREASURY_VAULT;
    const payoutExecutorAddress = ARC_CONTRACTS.PAYOUT_EXECUTOR;

    const arcProvider = new ethers.JsonRpcProvider(arcRpcUrl);
    const baseProvider = new ethers.JsonRpcProvider(baseRpcUrl);
    const privateKey = adminPk.startsWith("0x") ? adminPk : `0x${adminPk}`;
    const arcSigner = new ethers.Wallet(privateKey, arcProvider);
    const baseSigner = new ethers.Wallet(privateKey, baseProvider);
    const adminAddress = await arcSigner.getAddress();

    // ========================================================================
    // STEP 3: Find Aave position ID
    // ========================================================================
    // Ensure marketId is properly formatted as bytes32 (add 0x prefix if missing)
    // In test_system.js, marketId comes from contract event and is already bytes32 with 0x prefix
    // In Supabase/frontend, it's stored as hex string without 0x prefix
    let marketIdBytes32 = market.arc_market_id;
    if (!marketIdBytes32.startsWith("0x")) {
      marketIdBytes32 = "0x" + marketIdBytes32;
    }
    // Ensure it's exactly 66 characters (0x + 64 hex chars) for bytes32
    if (marketIdBytes32.length !== 66) {
      return NextResponse.json({ 
        error: `Invalid marketId length: ${marketIdBytes32.length}, expected 66 (0x + 64 hex chars). Value: ${marketIdBytes32}` 
      }, { status: 400 });
    }

    console.log("STEP 3: Finding ALL Aave position IDs for this market...");
    console.log(`Market ID (bytes32): ${marketIdBytes32}`);
    console.log(`Note: Each trade may have created its own position, so we need to find all of them\n`);
    
    const positions = await findAllPositionIds(marketIdBytes32, yieldControllerAddress, baseProvider);
    if (positions.length === 0) {
      console.error("No position IDs found for market:", marketIdBytes32);
      return NextResponse.json(
        { error: "Could not find any Aave position IDs for this market. Ensure funds were deployed to Aave." },
        { status: 400 }
      );
    }
    
    console.log(`✅ Found ${positions.length} position(s) for this market:`);
    positions.forEach((pos, idx) => {
      console.log(`   Position ${idx + 1}: ${pos.positionId} (Amount: ${ethers.formatUnits(pos.amount, 6)} USDC, Block: ${pos.blockNumber})`);
    });
    console.log("");

    // ========================================================================
    // STEP 4: Withdraw from ALL Aave positions (Step 9 from test_system.js)
    // ========================================================================
    console.log("=".repeat(80));
    console.log("STEP 9: Withdraw from ALL Aave Positions with Yield");
    console.log("=".repeat(80));

    const yieldController = new ethers.Contract(
      yieldControllerAddress,
      ["function withdrawFromAave(bytes32) external returns (uint256 principal, uint256 yield)"],
      baseSigner
    );

    // Aggregate totals across all positions
    let totalPrincipal = BigInt(0);
    let totalYield = BigInt(0);
    const eventIface = new ethers.Interface([
      "event FundsWithdrawnFromAave(bytes32 indexed positionId, uint256 principal, uint256 yield)",
    ]);

    // Withdraw from each position
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i];
      console.log(`\nWithdrawing from Position ${i + 1}/${positions.length} (${position.positionId})...`);
      console.log(`   Deployed amount: ${ethers.formatUnits(position.amount, 6)} USDC`);
      
      const withdrawTx = await yieldController.withdrawFromAave(position.positionId);
      const withdrawReceipt = await withdrawTx.wait();

      let positionPrincipal = BigInt(0);
      let positionYield = BigInt(0);
      
      for (const log of withdrawReceipt.logs || []) {
        try {
          const parsed = eventIface.parseLog(log);
          if (parsed && parsed.name === "FundsWithdrawnFromAave") {
            positionPrincipal = parsed.args.principal;
            positionYield = parsed.args.yield;
            break;
          }
        } catch (_) {}
      }

      console.log(`   ✅ Position ${i + 1} withdrawn:`);
      console.log(`      Principal: ${ethers.formatUnits(positionPrincipal, 6)} USDC`);
      console.log(`      Yield: ${ethers.formatUnits(positionYield, 6)} USDC`);

      totalPrincipal += positionPrincipal;
      totalYield += positionYield;
    }

    console.log("\n" + "=".repeat(80));
    console.log("TOTAL ACROSS ALL POSITIONS:");
    console.log(`   Total Principal: ${ethers.formatUnits(totalPrincipal, 6)} USDC`);
    console.log(`   Total Yield: ${ethers.formatUnits(totalYield, 6)} USDC`);
    console.log(`   Total Amount: ${ethers.formatUnits(totalPrincipal + totalYield, 6)} USDC`);
    console.log("   Funds are now in YieldController on Base Sepolia\n");

    const totalAmount = totalPrincipal + totalYield;
    const realYieldFromAave = totalYield;

    // ========================================================================
    // STEP 5: Bridge back to Arc (Step 10 from test_system.js)
    // ========================================================================
    console.log("=".repeat(80));
    console.log("STEP 10: Transfer & Swap USDC, then Bridge Back to Arc");
    console.log("=".repeat(80));

    // Add 0.1 USDC as simulated yield (since real yield over 2 minutes is ~0)
    const simulatedYield = ethers.parseUnits("0.1", 6);

    console.log(`Total withdrawn from Aave: ${ethers.formatUnits(totalAmount, 6)} USDC`);
    console.log(`Real Aave yield earned: ${realYieldFromAave.toString()} wei (${ethers.formatUnits(realYieldFromAave, 6)} USDC)`);
    console.log(`Total deposits from traders: ${ethers.formatUnits(depositAmountWei, 6)} USDC`);
    console.log(
      `For payouts, we'll use: Real yield (${ethers.formatUnits(realYieldFromAave, 6)}) + Simulated yield (${ethers.formatUnits(simulatedYield, 6)}) = ${ethers.formatUnits(realYieldFromAave + simulatedYield, 6)} USDC`
    );
    console.log(`   Note: Principal deposits (${ethers.formatUnits(depositAmountWei, 6)} USDC) will be returned separately to traders\n`);

    // Check actual USDC balance in YieldController (Aave USDC)
    // Wait a bit for RPC/indexer to catch up after withdrawals (fix from test_withdraw_yield_controller.js)
    console.log("⏳ Waiting 5 seconds for RPC/indexer to sync after withdrawals...");
    await sleep(10000);
    
    const aaveUsdcContract = new ethers.Contract(
      aaveUsdcAddress,
      ["function balanceOf(address) external view returns (uint256)"],
      baseProvider
    );

    // Retry balance check with exponential backoff (RPC lag fix)
    let actualBalance = BigInt(0);
    let balanceRetries = 0;
    const maxBalanceRetries = 5;
    const expectedBalance = totalAmount; // We expect at least this much
    
    while (balanceRetries < maxBalanceRetries && actualBalance < expectedBalance) {
      actualBalance = await aaveUsdcContract.balanceOf(yieldControllerAddress);
      console.log(`   Balance check ${balanceRetries + 1}/${maxBalanceRetries}: ${ethers.formatUnits(actualBalance, 6)} USDC (expected: ${ethers.formatUnits(expectedBalance, 6)} USDC)`);
      
      if (actualBalance >= expectedBalance) {
        console.log(`   ✅ Balance confirmed!\n`);
        break;
      }
      
      if (balanceRetries < maxBalanceRetries - 1) {
        const waitTime = 3000 * (balanceRetries + 1); // 3s, 6s, 9s, 12s
        console.log(`   ⏳ Waiting ${waitTime / 1000}s for RPC/indexer to sync...`);
        await sleep(waitTime);
      }
      
      balanceRetries++;
    }

    console.log(`   YieldController Aave USDC balance: ${ethers.formatUnits(actualBalance, 6)} USDC\n`);

    if (actualBalance === BigInt(0)) {
      throw new Error(
        "YieldController has 0 USDC after withdraw. Withdrawal to YieldController failed. " +
          "This may be due to RPC/indexer lag. Try again in a few seconds. " +
          "Run the isolated test: node test_withdraw_yield_controller.js [positionId] to verify withdraw and approval flow."
      );
    }
    
    if (actualBalance < expectedBalance) {
      console.log(`   ⚠️  WARNING: Balance (${ethers.formatUnits(actualBalance, 6)}) is less than expected (${ethers.formatUnits(expectedBalance, 6)}).`);
      console.log(`   This may be due to RPC/indexer lag. Proceeding with available balance.\n`);
    }

    // 1. Transfer Aave USDC from YieldController to admin
    const yieldControllerTransfer = new ethers.Contract(
      yieldControllerAddress,
      ["function transferUSDC(address _to, uint256 _amount) external"],
      baseSigner
    );

    // Wait BEFORE transfer to avoid rate limiting
    console.log("   Waiting 60 seconds before transfer to avoid RPC rate limiting...");
    await sleep(60000);
    console.log("   ✅ Ready to transfer\n");

    console.log("Step 1: Transferring Aave USDC from YieldController to admin...");
    
    // Retry logic with exponential backoff (matching test_system.js)
    let transferFromYieldControllerTx;
    let transferRetries = 0;
    const maxTransferRetries = 5;
    while (transferRetries < maxTransferRetries) {
      try {
        transferFromYieldControllerTx = await yieldControllerTransfer.transferUSDC(adminAddress, actualBalance, {
          gasLimit: 200000,
          maxFeePerGas: ethers.parseUnits("2", "gwei"),
          maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
        });
        break; // Success, exit retry loop
      } catch (error: any) {
        if (error?.message && error.message.includes("in-flight transaction limit")) {
          transferRetries++;
          const waitTime = Math.min(30000 * Math.pow(2, transferRetries), 300000); // Exponential backoff, max 5 min
          console.log(`   ⚠️  Rate limit hit. Retry ${transferRetries}/${maxTransferRetries} after ${waitTime / 1000}s...`);
          await sleep(waitTime);
        } else {
          throw error; // Different error, throw immediately
        }
      }
    }

    if (!transferFromYieldControllerTx) {
      throw new Error("Failed to send transfer transaction after retries");
    }

    await transferFromYieldControllerTx.wait();
    console.log("   ✅ Aave USDC transferred to admin\n");

    // Wait AFTER transfer to avoid rate limiting
    console.log("   Waiting 60 seconds after transfer to avoid rate limiting...");
    await sleep(60000);
    console.log("   ✅ Ready to continue\n");

    // 2. Swap Aave USDC → Circle USDC (reverse of the earlier swap)
    console.log("Step 2: Swapping Aave USDC → Circle USDC for bridging...");
    const swapAmount = actualBalance; // Swap all of it

    const aaveUsdc = new ethers.Contract(
      aaveUsdcAddress,
      ["function approve(address,uint256) external returns (bool)", "function allowance(address,address) external view returns (uint256)"],
      baseProvider
    );

    // Approve swap router
    const currentAllowance = await aaveUsdc.allowance(adminAddress, swapRouterAddress);
    if (currentAllowance < swapAmount) {
      console.log("   Waiting 30 seconds before approval to avoid RPC rate limiting...");
      await sleep(30000);

      console.log("   Approving Aave USDC for swap router...");
      if (currentAllowance > BigInt(0)) {
        // Retry logic for reset approval
        let resetTx;
        let resetRetries = 0;
        while (resetRetries < 3) {
          try {
            resetTx = await (aaveUsdc.connect(baseSigner) as any).approve(swapRouterAddress, BigInt(0), {
              gasLimit: 100000,
              maxFeePerGas: ethers.parseUnits("2", "gwei"),
              maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
            });
            break;
          } catch (error: any) {
            if (error?.message && error.message.includes("in-flight transaction limit")) {
              resetRetries++;
              const waitTime = 30000 * Math.pow(2, resetRetries);
              console.log(`   ⚠️  Rate limit on reset. Retry ${resetRetries}/3 after ${waitTime / 1000}s...`);
              await sleep(waitTime);
            } else {
              throw error;
            }
          }
        }
        if (resetTx) {
          await resetTx.wait();
          await sleep(30000);
        }
      }

      // Retry logic for approval
      let approveTx;
      let approvalRetries = 0;
      const maxApprovalRetries = 5;
      while (approvalRetries < maxApprovalRetries) {
        try {
          approveTx = await (aaveUsdc.connect(baseSigner) as any).approve(swapRouterAddress, swapAmount, {
            gasLimit: 100000,
            maxFeePerGas: ethers.parseUnits("2", "gwei"),
            maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
          });
          break;
        } catch (error: any) {
          if (error?.message && error.message.includes("in-flight transaction limit")) {
            approvalRetries++;
            const waitTime = Math.min(30000 * Math.pow(2, approvalRetries), 300000);
            console.log(`   ⚠️  Rate limit on approval. Retry ${approvalRetries}/${maxApprovalRetries} after ${waitTime / 1000}s...`);
            await sleep(waitTime);
          } else {
            throw error;
          }
        }
      }

      if (!approveTx) {
        throw new Error("Failed to send approval transaction after retries");
      }

      await approveTx.wait();
      console.log("   ✅ Approved");
      console.log("   Waiting 60 seconds for approval to propagate and avoid rate limiting...");
      await sleep(60000);
      console.log("   ✅ Ready\n");
    }

    // Execute swap: Aave USDC → Circle USDC
    // Using the WORKING format from test_reverse_swap.js
    const minAmountOut = (swapAmount * BigInt(90)) / BigInt(100); // 10% slippage (tested and working)

    const swapParams = {
      tokenIn: aaveUsdcAddress,
      tokenOut: circleUsdcAddress,
      fee: 500, // 0.05% fee tier (same as working swap.js)
      recipient: adminAddress,
      amountIn: swapAmount,
      amountOutMinimum: minAmountOut,
      sqrtPriceLimitX96: BigInt(0),
      // NO DEADLINE - Base Sepolia SwapRouter02 doesn't use it
    };

    // Use the EXACT working ABI from test_reverse_swap.js
    const swapRouter = new ethers.Contract(
      swapRouterAddress,
      [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
      ],
      baseSigner
    );

    console.log(`   Waiting 30 seconds before swap to avoid RPC rate limiting...`);
    await sleep(30000);

    console.log(`   Swapping ${ethers.formatUnits(swapAmount, 6)} Aave USDC → Circle USDC...`);
    console.log(`   Swap params: recipient=${adminAddress}, amountIn=${swapAmount}, tokenOut=${circleUsdcAddress}`);

    // Retry logic for swap
    let swapTx;
    let swapRetries = 0;
    const maxSwapRetries = 5;
    while (swapRetries < maxSwapRetries) {
      try {
        swapTx = await swapRouter.exactInputSingle(swapParams, {
          gasLimit: 200000,
          maxFeePerGas: ethers.parseUnits("2", "gwei"),
          maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
        });
        break;
      } catch (error: any) {
        if (error?.message && error.message.includes("in-flight transaction limit")) {
          swapRetries++;
          const waitTime = Math.min(30000 * Math.pow(2, swapRetries), 300000);
          console.log(`   ⚠️  Rate limit on swap. Retry ${swapRetries}/${maxSwapRetries} after ${waitTime / 1000}s...`);
          await sleep(waitTime);
        } else {
          throw error;
        }
      }
    }

    if (!swapTx) {
      throw new Error("Failed to send swap transaction after retries");
    }

    console.log(`   Swap tx hash: ${swapTx.hash}`);
    const swapReceipt = await swapTx.wait();
    console.log(`   Swap confirmed in block: ${swapReceipt.blockNumber}`);
    console.log(`   Gas used: ${swapReceipt.gasUsed?.toString() ?? "N/A"}`);
    // exactInputSingle returns amountOut; try to get it from the receipt/logs if needed
    try {
      const swapRouterWithReturn = new ethers.Contract(
        swapRouterAddress,
        ["function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) external payable returns (uint256 amountOut)"],
        baseProvider
      );
      const amountOut = await swapRouterWithReturn.exactInputSingle.staticCall(swapParams);
      console.log(`   Swap amountOut (from call): ${ethers.formatUnits(amountOut, 6)} Circle USDC`);
    } catch (e: any) {
      console.log(`   (Could not read amountOut: ${e?.message})`);
    }
    console.log("   ✅ Swapped to Circle USDC\n");

    // Check Circle USDC balance
    const circleUsdcContract = new ethers.Contract(
      circleUsdcAddress,
      ["function balanceOf(address) external view returns (uint256)"],
      baseProvider
    );
    let circleBalance = await circleUsdcContract.balanceOf(adminAddress);
    console.log(`   Admin Circle USDC balance: ${ethers.formatUnits(circleBalance, 6)} USDC (recipient: ${adminAddress})`);
    if (circleBalance === BigInt(0)) {
      console.log("   ⚠️  Balance is 0 after swap; waiting 10s and rechecking (RPC/indexer lag)...");
      await sleep(10000);
      circleBalance = await circleUsdcContract.balanceOf(adminAddress);
      console.log(`   Admin Circle USDC balance (after recheck): ${ethers.formatUnits(circleBalance, 6)} USDC`);
    }
    console.log("");

    // 3. Bridge Circle USDC from Base Sepolia → Arc using Circle Bridge Kit (skip if 0)
    if (circleBalance === BigInt(0)) {
      console.log("Step 3: Skipping bridge (Circle USDC balance is 0). Recording yield only.");
      console.log("   Check swap tx on block explorer to confirm recipient and amount.\n");
    } else {
      console.log("Step 3: Bridging Circle USDC from Base Sepolia → Arc Testnet...");
      const adapter = createEthersAdapterFromPrivateKey({
        privateKey,
        getProvider: ({ chain }) => {
          const rpcMap: Record<string, string> = {
            Arc_Testnet: arcRpcUrl,
            "Arc Testnet": arcRpcUrl,
            Base_Sepolia: baseRpcUrl,
            "Base Sepolia": baseRpcUrl,
          };
          const rpcUrl = rpcMap[chain.name || ""] || rpcMap[chain.chain || ""];
          if (!rpcUrl) throw new Error(`RPC not configured for chain: ${chain.name || chain.chain}`);
          return new ethers.JsonRpcProvider(rpcUrl);
        },
      });
      const bridgeKit = new BridgeKit();
      const amountStr = ethers.formatUnits(circleBalance, 6);
      const result = await bridgeKit.bridge({
        from: { adapter, chain: "Base_Sepolia" },
        to: { adapter, chain: "Arc_Testnet" },
        amount: amountStr,
      });

      if (result.steps && result.steps.length > 0) {
        result.steps.forEach((step: any, i: number) => {
          console.log(`   ${i + 1}. ${step.name}: ${step.state}`);
        });
      }
      console.log(`   State: ${result.state}\n`);

      if (result.state === "error") {
        const errStep = result.steps?.find((s: any) => s.state === "error");
        throw new Error(errStep?.errorMessage || "Bridge back failed");
      }
      if (result.state === "pending") {
        console.log("   ⏳ Bridge in progress. Waiting 30s...");
        await sleep(30000);
      }

      console.log("✅ Funds bridged back to Arc (admin wallet on Arc)\n");
    }

    // 4. Record yield in treasury (bookkeeping on Arc)
    // Use simulated yield declared at function start
    const distributionAmount = realYieldFromAave + simulatedYield;

    console.log("Step 4: Recording yield in TreasuryVault...");
    console.log(`   Real Aave yield: ${realYieldFromAave.toString()} wei (${ethers.formatUnits(realYieldFromAave, 6)} USDC)`);
    console.log(`   Simulated yield (for testing): ${ethers.formatUnits(simulatedYield, 6)} USDC`);
    console.log(`   Total for distribution: ${ethers.formatUnits(distributionAmount, 6)} USDC`);
    console.log(`   Note: Principal deposits (${ethers.formatUnits(depositAmountWei, 6)} USDC) will be returned to traders separately\n`);

    const treasuryVault = new ethers.Contract(
      treasuryVaultAddress,
      ["function recordYield(bytes32,uint256) external"],
      arcSigner
    );
    const recordTx = await treasuryVault.recordYield(marketIdBytes32, distributionAmount);
    await recordTx.wait();
    console.log(`✅ Yield recorded in TreasuryVault: ${ethers.formatUnits(distributionAmount, 6)} USDC\n`);

    // ========================================================================
    // STEP 6: Ensure market is resolved on-chain
    // ========================================================================
    const marketFactoryAddress = ARC_CONTRACTS.MARKET_FACTORY;
    const marketContract = new ethers.Contract(
      market.arc_market_address,
      [
        "function getMarketInfo() view returns (tuple(bytes32 marketId, string question, string disasterType, string location, uint256 startTime, uint256 endTime, uint8 state, bytes32 policyId, bytes32[] eligibleNGOs))",
      ],
      arcProvider
    );

    const marketInfo = await marketContract.getMarketInfo();
    const marketState = Number(marketInfo.state);

    // Market state: 0=ACTIVE, 1=CLOSED, 2=RESOLVED, 3=PAID_OUT
    if (marketState < 2) {
      // Market is not RESOLVED, need to close and resolve it
      const marketFactory = new ethers.Contract(
        marketFactoryAddress,
        ["function forceCloseMarket(bytes32) external", "function resolveMarket(bytes32) external"],
        arcSigner
      );

      if (marketState === 0) {
        // Market is still ACTIVE, need to close it first
        const closeTx = await marketFactory.forceCloseMarket(marketIdBytes32);
        await closeTx.wait();
      }

      // Resolve market through MarketFactory
      const resolveTx = await marketFactory.resolveMarket(marketIdBytes32);
      await resolveTx.wait();
    }

    // ========================================================================
    // STEP 7: Calculate payouts (Step 11 from test_system.js)
    // ========================================================================
    console.log("=".repeat(80));
    console.log("STEP 11: Calculate Automated Payouts");
    console.log("=".repeat(80));

    const payoutExecutor = new ethers.Contract(
      payoutExecutorAddress,
      [
        "function calculatePayouts(address) external returns (bytes32)",
        "function getNGOPayouts(bytes32) external view returns (tuple(bytes32,string,uint256,uint256)[])",
        "function getWinnerPayouts(bytes32) external view returns (tuple(address,uint256,uint256)[])",
        "function admin() external view returns (address)",
      ],
      arcSigner
    );

    // Debug: Check admin before calling (matching test_system.js lines 1925-1931)
    const contractAdmin = await payoutExecutor.admin();
    const signerAddress = await arcSigner.getAddress();
    console.log("🔍 Admin Check:");
    console.log(`   Contract admin: ${contractAdmin}`);
    console.log(`   Signer address: ${signerAddress}`);
    console.log(`   Match? ${contractAdmin.toLowerCase() === signerAddress.toLowerCase() ? "✅ YES" : "❌ NO"}\n`);

    // Comprehensive diagnostics (matching test_system.js lines 1933-2021)
    console.log("🔍 Running Diagnostics...\n");

    // Check Market state (reuse marketInfo from STEP 6)
    // marketInfo already fetched in STEP 6, but we'll verify it here for diagnostics
    const marketContractForDiagnostics = new ethers.Contract(
      market.arc_market_address,
      [
        "function getMarketInfo() external view returns (tuple(bytes32 marketId, string question, string disasterType, string location, uint256 startTime, uint256 endTime, uint8 state, bytes32 policyId, bytes32[] eligibleNGOs))",
        "function getWinners() external view returns (address[], uint256[])",
      ],
      arcProvider
    );

    // Use existing marketInfo from STEP 6, but refresh if needed
    let marketInfoForDiagnostics = marketInfo;
    try {
      if (!marketInfoForDiagnostics) {
        marketInfoForDiagnostics = await marketContractForDiagnostics.getMarketInfo();
      }
      const stateValue = marketInfoForDiagnostics.state;
      const stateNum = Number(stateValue);

      console.log(`   Market State: ${stateNum} (0=ACTIVE, 1=CLOSED, 2=RESOLVED, 3=PAID_OUT)`);
      console.log(`   Policy ID: ${marketInfoForDiagnostics.policyId}`);
      console.log(`   Eligible NGOs: ${marketInfoForDiagnostics.eligibleNGOs.length}`);

      if (stateNum == 2) {
        console.log(`   Market Resolved: ✅ YES\n`);
      } else {
        console.log(`   Market Resolved: ❌ NO (State: ${stateNum}, expected 2)`);
        console.log(`   ⚠️  WARNING: Market must be RESOLVED (state 2) for calculatePayouts to work.\n`);
      }
    } catch (error: any) {
      console.log(`   ❌ Market check failed: ${error?.message}\n`);
      try {
        marketInfoForDiagnostics = await marketContractForDiagnostics.getMarketInfo();
      } catch (e: any) {
        console.log(`   ⚠️  Could not retrieve market info. Proceeding anyway...\n`);
      }
    }

    // Check TreasuryVault and PolicyEngine together
    const treasuryVaultForDiagnostics = new ethers.Contract(
      treasuryVaultAddress,
      ["function getTotalYield(bytes32) external view returns (uint256)"],
      arcProvider
    );

    const policyEngine = new ethers.Contract(
      ARC_CONTRACTS.POLICY_ENGINE,
      ["function validatePayout(bytes32, uint256, uint256) external view returns (uint256,uint256,uint256,uint256)"],
      arcProvider
    );

    try {
      if (!marketInfoForDiagnostics) {
        marketInfoForDiagnostics = await marketContractForDiagnostics.getMarketInfo();
      }
      const totalYield = await treasuryVaultForDiagnostics.getTotalYield(marketInfoForDiagnostics.marketId);
      console.log(`   Treasury Yield: ${totalYield > BigInt(0) ? "✅ YES" : "❌ NO"}`);
      console.log(`   Total Yield: ${ethers.formatUnits(totalYield, 6)} USDC`);

      if (totalYield === BigInt(0)) {
        throw new Error(`No yield recorded! Amount: ${totalYield}`);
      }

      // Test validatePayout to see if policy exists
      const policyResult = await policyEngine.validatePayout(marketInfoForDiagnostics.policyId, totalYield, marketInfoForDiagnostics.eligibleNGOs.length);
      console.log(`   Policy found: ✅`);
      console.log(`     NGO Amount: ${ethers.formatUnits(policyResult[0], 6)} USDC`);
      console.log(`     Winner Amount: ${ethers.formatUnits(policyResult[1], 6)} USDC`);
      console.log(`     Protocol Amount: ${ethers.formatUnits(policyResult[2], 6)} USDC\n`);
    } catch (error: any) {
      console.log(`   ❌ Check failed: ${error?.message}`);
      if (error.message?.includes("Policy not active")) {
        console.log(`   This is likely the issue - policy not set or not active for this market!\n`);
      } else if (error.message?.includes("No yield")) {
        console.log(`   This is likely the issue - yield not recorded!\n`);
      } else {
        console.log(`   Review the error above.\n`);
      }
      throw error;
    }

    // Try static call first to get better error message (matching test_system.js lines 2023-2038)
    console.log("🔍 Testing with static call (simulation)...\n");
    try {
      const result = await payoutExecutor.calculatePayouts.staticCall(market.arc_market_address);
      console.log(`   ✅ Static call succeeded! Result: ${result}\n`);
    } catch (staticError: any) {
      console.log(`   ❌ Static call failed: ${staticError.message}`);
      if (staticError.data) {
        console.log(`   Error data: ${staticError.data}`);
      }
      if (staticError.reason) {
        console.log(`   Reason: ${staticError.reason}`);
      }
      console.log(`\n   This is the actual error that will occur. Fix the issue above.\n`);
      throw staticError;
    }

    console.log("Calculating payouts based on policy...");
    const calcTx = await payoutExecutor.calculatePayouts(market.arc_market_address, { gasLimit: 2000000 });
    await calcTx.wait();

    console.log("✅ Payouts calculated\n");
    console.log("Payout Distribution:");
    console.log("   60% → NGOs");
    console.log("   30% → Winners (YES voters)");
    console.log("   10% → Protocol fees\n");

    // ========================================================================
    // STEP 8: Execute payouts (Step 12 from test_system.js)
    // ========================================================================
    console.log("=".repeat(80));
    console.log("STEP 12: Execute Automated Payouts via Circle Gateway");
    console.log("=".repeat(80));

    // Calculate payout amounts (60/30/10 split) - matching test_system.js lines 2062-2075
    const ngoAmount = (distributionAmount * BigInt(60)) / BigInt(100);
    const winnerAmount = (distributionAmount * BigInt(30)) / BigInt(100);
    const protocolAmount = (distributionAmount * BigInt(10)) / BigInt(100);

    const ngoAmountDecimal = ethers.formatUnits(ngoAmount, 6);
    const winnerAmountDecimal = ethers.formatUnits(winnerAmount, 6);
    const totalDepositDecimal = ethers.formatUnits(depositAmountWei, 6);

    console.log("\n💰 Payout Breakdown:");
    console.log(`   NGOs (60%): ${ngoAmountDecimal} USDC`);
    console.log(`   Winners (30%): ${winnerAmountDecimal} USDC`);
    console.log(`   Protocol (10%): ${ethers.formatUnits(protocolAmount, 6)} USDC`);
    console.log(`   Total deposits to return: ${totalDepositDecimal} USDC\n`);

    // Query PayoutExecutor for actual payout details (matching test_system.js lines 2077-2105)
    console.log("📋 Querying PayoutExecutor for individual payouts...\n");

    const payoutExecutorQuery = new ethers.Contract(
      payoutExecutorAddress,
      [
        "function getWinnerPayouts(bytes32) view returns (tuple(address user, uint256 principal, uint256 reward)[])",
        "function getLoserPayouts(bytes32) view returns (tuple(address user, uint256 principal)[])",
        "function getNGOPayouts(bytes32) view returns (tuple(bytes32 ngoId, string circleWalletId, uint256 amount, uint256 chainId)[])",
      ],
      arcProvider
    );

    // marketInfo already fetched in STEP 7
    const actualMarketId = marketInfo.marketId || marketInfo[0];

    const winnerPayouts = await payoutExecutorQuery.getWinnerPayouts(actualMarketId);
    const loserPayouts = await payoutExecutorQuery.getLoserPayouts(actualMarketId);
    const ngoPayouts = await payoutExecutorQuery.getNGOPayouts(actualMarketId);

    console.log(`✅ Found ${winnerPayouts.length} winner(s) and ${loserPayouts.length} loser(s)\n`);

    // Reward can be 0 from contract (e.g. hybrid formula rounding or ABI decode). Use by-index and fallback.
    // Matching test_system.js lines 2107-2118
    const winnerAmountTotal = (distributionAmount * BigInt(30)) / BigInt(100); // 30% for winners
    let totalRewardFromContract = BigInt(0);
    for (const w of winnerPayouts) {
      const r = w.reward !== undefined ? w.reward : w[2] !== undefined ? w[2] : BigInt(0);
      totalRewardFromContract += r;
    }
    const useFairShare = winnerPayouts.length > 0 && totalRewardFromContract === BigInt(0) && winnerAmountTotal > BigInt(0);
    const fairSharePerWinner = useFairShare ? winnerAmountTotal / BigInt(winnerPayouts.length) : BigInt(0);
    if (useFairShare) {
      console.log(`   ⚠️  Contract returned 0 reward for winners; using fair share: ${ethers.formatUnits(fairSharePerWinner, 6)} USDC each\n`);
    }

    // Create payout map for easy lookup (matching test_system.js lines 2120-2143)
    const payoutMap = new Map<string, { principal: bigint; reward: bigint; isWinner: boolean }>();

    for (const winner of winnerPayouts) {
      const rawReward = winner.reward !== undefined ? winner.reward : winner[2] !== undefined ? winner[2] : BigInt(0);
      const reward = useFairShare ? fairSharePerWinner : rawReward;
      const userAddr = winner.user !== undefined ? winner.user : winner[0];
      const principal = winner.principal !== undefined ? winner.principal : winner[1];
      payoutMap.set(userAddr.toLowerCase(), {
        principal,
        reward,
        isWinner: true,
      });
    }

    for (const loser of loserPayouts) {
      const userAddr = loser.user !== undefined ? loser.user : loser[0];
      const principal = loser.principal !== undefined ? loser.principal : loser[1];
      payoutMap.set(userAddr.toLowerCase(), {
        principal,
        reward: BigInt(0),
        isWinner: false,
      });
    }

    // Log individual trader payouts (matching test_system.js lines 2145-2160)
    console.log("💳 Individual Trader Payouts:");
    for (const trade of trades || []) {
      const trader = (trade as any).traders;
      if (!trader || !trader.wallet_address) continue;
      const payout = payoutMap.get(trader.wallet_address.toLowerCase());
      if (payout) {
        const total = payout.principal + payout.reward;
        console.log(`   ${trader.wallet_address}:`);
        console.log(`      Principal: ${ethers.formatUnits(payout.principal, 6)} USDC`);
        console.log(`      Reward: ${ethers.formatUnits(payout.reward, 6)} USDC`);
        console.log(`      Total: ${ethers.formatUnits(total, 6)} USDC`);
        console.log(`      Status: ${payout.isWinner ? "🎉 WINNER" : "💔 LOSER (gets refund)"}`);
      } else {
        console.log(`   ${trader.wallet_address}: No payout found`);
      }
    }
    console.log("");

    // ========================================================================
    // STEP 1: Create or get Treasury Circle Wallet (matching test_system.js lines 2162-2198)
    // ========================================================================
    console.log("🏦 Setting up Treasury Circle Wallet...\n");

    const circle = circleWalletClient();
    let treasuryWalletId: string;
    let treasuryWalletAddress: string;

    try {
      // Create wallet set for treasury (matching pattern from createCircleWallets)
      console.log("Creating treasury wallet set...");
      const treasuryWalletSetResp = await circle.createWalletSet({
        name: "Treasury Wallet Set",
      });
      const treasuryWalletSetId = treasuryWalletSetResp.data?.walletSet?.id;
      if (!treasuryWalletSetId) {
        throw new Error("Failed to create treasury wallet set");
      }
      console.log(`✅ Treasury Wallet Set Created: ${treasuryWalletSetId}\n`);

      // Create treasury wallet on Arc Testnet
      console.log("Creating treasury wallet on Arc Testnet...");
      const treasuryWalletsResp = await circle.createWallets({
        accountType: "SCA",
        blockchains: ["ARC-TESTNET" as any],
        count: 1,
        walletSetId: treasuryWalletSetId,
      });

      const treasuryWallet = treasuryWalletsResp.data?.wallets?.[0];
      if (!treasuryWallet?.id || !treasuryWallet?.address) {
        throw new Error("Failed to create treasury wallet");
      }

      treasuryWalletId = treasuryWallet.id;
      treasuryWalletAddress = treasuryWallet.address;
      console.log(`✅ Treasury Wallet Created: ${treasuryWalletId}`);
      console.log(`   Address: ${treasuryWalletAddress}\n`);
    } catch (error: any) {
      console.error("❌ Failed to create treasury wallet:", error?.message);
      if (error.response) {
        console.error("Response:", JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }

    // ========================================================================
    // STEP 2: Transfer USDC from admin wallet to treasury Circle wallet
    // (matching test_system.js lines 2200-2225)
    // ========================================================================
    // Treasury needs: yield split (NGO + winners + protocol) + all principals to return to traders
    const totalPayoutAmount = ngoAmount + winnerAmount + protocolAmount + depositAmountWei;

    console.log("💰 Transferring USDC to Treasury Circle Wallet...");
    console.log(`   From: Admin wallet (${adminAddress})`);
    console.log(`   To: Treasury Circle wallet (${treasuryWalletAddress})`);
    console.log(`   Amount: ${ethers.formatUnits(totalPayoutAmount, 6)} USDC (yield split + principal return)\n`);

    const arcUsdcAddress = ARC_CONTRACTS.USDC;
    const usdcContract = new ethers.Contract(
      arcUsdcAddress,
      ["function transfer(address,uint256) external returns (bool)", "function balanceOf(address) external view returns (uint256)"],
      arcSigner
    );

    // Check admin balance
    const adminBalance = await usdcContract.balanceOf(adminAddress);
    if (adminBalance < totalPayoutAmount) {
      throw new Error(
        `Insufficient USDC in admin wallet. Have: ${ethers.formatUnits(adminBalance, 6)}, Need: ${ethers.formatUnits(totalPayoutAmount, 6)}`
      );
    }

    // Transfer to treasury Circle wallet
    const transferToTreasuryTx = await usdcContract.transfer(treasuryWalletAddress, totalPayoutAmount);
    await transferToTreasuryTx.wait();
    console.log(`✅ USDC transferred to treasury Circle wallet\n`);

    // Wait for Circle to sync the balance (with retries) - matching test_system.js lines 2227-2276
    console.log("⏳ Waiting for Circle to sync treasury wallet balance...");
    let treasuryUsdcToken = null;
    let treasuryRetryCount = 0;
    const treasuryMaxRetries = 10; // Try up to 10 times (30 seconds total)

    while (!treasuryUsdcToken && treasuryRetryCount < treasuryMaxRetries) {
      await sleep(3000); // Wait 3 seconds between retries

      // Use getWalletTokenBalance to get balances (more reliable)
      const treasuryBalanceResponse = await circle.getWalletTokenBalance({
        id: treasuryWalletId,
      });

      const treasuryTokenBalances = (treasuryBalanceResponse.data as any)?.tokenBalances || (treasuryBalanceResponse.data as any)?.balances || [];

      // Try to find USDC by symbol OR by address
      const arcUsdcAddressLower = arcUsdcAddress?.toLowerCase();

      treasuryUsdcToken = treasuryTokenBalances.find((token: any) => {
        const tokenInfo = token.token || token;
        const symbol = (tokenInfo?.symbol || "").toUpperCase();
        const address = (tokenInfo?.tokenAddress || tokenInfo?.address || "").toLowerCase();

        // Match by symbol OR by Arc USDC address
        return symbol.includes("USDC") || (arcUsdcAddressLower && address === arcUsdcAddressLower);
      });

      if (!treasuryUsdcToken) {
        treasuryRetryCount++;
        console.log(`   Retry ${treasuryRetryCount}/${treasuryMaxRetries} - USDC not synced yet...`);
      }
    }

    if (!treasuryUsdcToken || !treasuryUsdcToken.token?.id) {
      // Debug: Show what tokens we found
      const treasuryBalanceResponse = await circle.getWalletTokenBalance({
        id: treasuryWalletId,
      });
      const treasuryTokenBalances = (treasuryBalanceResponse.data as any)?.tokenBalances || (treasuryBalanceResponse.data as any)?.balances || [];
      console.log(`\n   ⚠️  Found ${treasuryTokenBalances.length} token(s) in wallet:`);
      treasuryTokenBalances.forEach((token: any, idx: number) => {
        const tokenInfo = token.token || token;
        console.log(`   ${idx + 1}. ${tokenInfo?.symbol || "Unknown"} - ${tokenInfo?.tokenAddress || tokenInfo?.address || "N/A"}`);
      });
      throw new Error("USDC token not found in treasury wallet after syncing. Check token addresses.");
    }

    console.log(`   ✅ USDC found in treasury wallet\n`);

    const treasuryTokenInfo = treasuryUsdcToken.token || treasuryUsdcToken;
    const usdcTokenId = treasuryTokenInfo.id;

    // ========================================================================
    // 🔥 CIRCLE GATEWAY + BRIDGE KIT USAGE #2: NGO Payout (Cross-Chain)
    // (matching test_system.js lines 2278-2613)
    // ========================================================================
    // Execute NGO payouts (using their preferred chains)
    for (const ngoPayout of ngoPayouts) {
      const ngoId = ngoPayout.ngoId || ngoPayout[0];
      const ngoCircleWalletId = ngoPayout.circleWalletId || ngoPayout[1];
      const ngoPayoutAmount = ngoPayout.amount || ngoPayout[2];
      const ngoPreferredChain = ngoPayout.chainId || ngoPayout[3];

      // Find NGO in our database
      const ngo = ngos?.find((n) => n.circle_wallet_id === ngoCircleWalletId);
      if (!ngo) continue;

      const ngoAmountDecimal = ethers.formatUnits(ngoPayoutAmount, 6);
      const preferredChain = ngo.preferred_chain || "BASE-SEPOLIA";

      try {
        console.log("💸 Sending to NGO via Circle Gateway + Bridge Kit (CCTP)...");
        console.log(`   Amount: ${ngoAmountDecimal} USDC`);
        console.log(`   Source Chain: ARC-TESTNET (Arc Testnet)`);
        console.log(`   Destination Chain: ${preferredChain}`);
        console.log(`   Protocol: Circle CCTP (Cross-Chain Transfer Protocol)`);
        console.log(`   NGO Wallet: ${ngoCircleWalletId}\n`);

        // Get NGO wallet info
        const ngoWalletResp = await circle.getWallet({ id: ngoCircleWalletId });
        const ngoAddress = ngoWalletResp.data?.wallet?.address;
        if (!ngoAddress) {
          console.warn(`NGO wallet ${ngoCircleWalletId} not found, skipping`);
          continue;
        }
        console.log(`   NGO Address on ${preferredChain}: ${ngoAddress}\n`);

        // Bridge to NGO's preferred chain (supporting all chains from signup)
        const bridgeChainName = CHAIN_TO_BRIDGE_NAME[preferredChain];
        if (!bridgeChainName) {
          console.warn(`NGO ${ngo.name} has preferred chain ${preferredChain}, which is not supported. Skipping.`);
          continue;
        }

        const preferredChainRpcUrl = getRpcUrl(preferredChain);
        if (!preferredChainRpcUrl) {
          console.warn(`NGO ${ngo.name} has preferred chain ${preferredChain}, but RPC URL is not configured. Skipping.`);
          continue;
        }

        // Step 1: Bridge from Arc to preferred chain using Circle Bridge Kit
        console.log(`🌉 Step 1: Bridging USDC from Arc to ${preferredChain} using Circle Bridge Kit...`);

        const adapter = createEthersAdapterFromPrivateKey({
          privateKey,
          getProvider: ({ chain }) => {
            const rpcMap: Record<string, string> = {
              Arc_Testnet: arcRpcUrl,
              "Arc Testnet": arcRpcUrl,
              Base_Sepolia: baseRpcUrl,
              "Base Sepolia": baseRpcUrl,
              Arbitrum_Sepolia: getRpcUrl("ARB-SEPOLIA"),
              "Arbitrum Sepolia": getRpcUrl("ARB-SEPOLIA"),
              Avalanche_Fuji: getRpcUrl("AVAX-FUJI"),
              "Avalanche Fuji": getRpcUrl("AVAX-FUJI"),
              Ethereum_Sepolia: getRpcUrl("ETH-SEPOLIA"),
              "Ethereum Sepolia": getRpcUrl("ETH-SEPOLIA"),
              Optimism_Sepolia: getRpcUrl("OP-SEPOLIA"),
              "Optimism Sepolia": getRpcUrl("OP-SEPOLIA"),
              Polygon_Amoy: getRpcUrl("MATIC-AMOY"),
              "Polygon Amoy": getRpcUrl("MATIC-AMOY"),
              Unichain_Sepolia: getRpcUrl("UNI-SEPOLIA"),
              "Unichain Sepolia": getRpcUrl("UNI-SEPOLIA"),
              Aptos_Testnet: getRpcUrl("APTOS-TESTNET"),
              "Aptos Testnet": getRpcUrl("APTOS-TESTNET"),
              Monad_Testnet: getRpcUrl("MONAD-TESTNET"),
              "Monad Testnet": getRpcUrl("MONAD-TESTNET"),
              Solana_Devnet: getRpcUrl("SOL-DEVNET"),
              "Solana Devnet": getRpcUrl("SOL-DEVNET"),
            };
            const rpcUrl = rpcMap[chain.name || ""] || rpcMap[chain.chain || ""];
            if (!rpcUrl) throw new Error(`RPC not configured for chain: ${chain.name || chain.chain}`);
            return new ethers.JsonRpcProvider(rpcUrl);
          },
        });
        const bridgeKit = new BridgeKit();
        
        const bridgeResult = await bridgeKit.bridge({
          from: { adapter, chain: "Arc_Testnet" },
          to: { adapter, chain: bridgeChainName as any },
          amount: ngoAmountDecimal,
        });

        if (bridgeResult.state === "error") {
          const errStep = bridgeResult.steps?.find((s: any) => s.state === "error");
          throw new Error(`Bridge failed: ${errStep?.errorMessage || "Unknown error"}`);
        }

        console.log("   ✅ Bridge completed");
        if (bridgeResult.steps && bridgeResult.steps.length > 0) {
          bridgeResult.steps.forEach((step: any, i: number) => {
            console.log(`   ${i + 1}. ${step.name}: ${step.state}`);
          });
        }

      // Wait for bridge to complete
      if (bridgeResult.state === "pending") {
        console.log("   ⏳ Bridge in progress. Waiting 30s for completion...");
        await sleep(30000);
      }

        // Step 2: Create a treasury Circle wallet on preferred chain
        console.log(`\n🏦 Step 2: Creating Treasury Circle Wallet on ${preferredChain}...`);
        let preferredChainTreasuryWalletId: string;
        let preferredChainTreasuryWalletAddress: string;

        try {
          // Create wallet set for preferred chain treasury (matching pattern from createCircleWallets)
          console.log(`   Creating ${preferredChain} treasury wallet set...`);
          const preferredChainTreasuryWalletSetResp = await circle.createWalletSet({
            name: `${preferredChain} Treasury Wallet Set`,
          });
          const preferredChainTreasuryWalletSetId = preferredChainTreasuryWalletSetResp.data?.walletSet?.id;
          if (!preferredChainTreasuryWalletSetId) {
            throw new Error(`Failed to create ${preferredChain} treasury wallet set`);
          }
          console.log(`   ✅ ${preferredChain} Treasury Wallet Set Created: ${preferredChainTreasuryWalletSetId}\n`);

          // Create preferred chain treasury wallet
          console.log(`   Creating ${preferredChain} treasury wallet on ${preferredChain}...`);
          const preferredChainTreasuryWalletsResp = await circle.createWallets({
            accountType: "SCA",
            blockchains: [preferredChain as any],
            count: 1,
            walletSetId: preferredChainTreasuryWalletSetId,
          });

          const preferredChainTreasuryWallet = preferredChainTreasuryWalletsResp.data?.wallets?.[0];
          if (!preferredChainTreasuryWallet?.id || !preferredChainTreasuryWallet?.address) {
            throw new Error(`Failed to create ${preferredChain} treasury wallet`);
          }

          preferredChainTreasuryWalletId = preferredChainTreasuryWallet.id;
          preferredChainTreasuryWalletAddress = preferredChainTreasuryWallet.address;
          console.log(`   ✅ ${preferredChain} Treasury Wallet Created: ${preferredChainTreasuryWalletId}`);
          console.log(`   Address: ${preferredChainTreasuryWalletAddress}\n`);
        } catch (error: any) {
          console.error(`   ❌ Failed to create ${preferredChain} treasury wallet:`, error?.message);
          if (error.response) {
            console.error("   Response:", JSON.stringify(error.response.data, null, 2));
          }
          throw error;
        }

        // Get Circle USDC address for preferred chain
        const preferredChainCircleUsdcAddress = getCircleUsdcAddressFromConstants(preferredChain);
        if (!preferredChainCircleUsdcAddress) {
          throw new Error(`Circle USDC address not configured for chain: ${preferredChain}`);
        }

        // Create provider and signer for preferred chain
        const preferredChainProvider = new ethers.JsonRpcProvider(preferredChainRpcUrl);
        const preferredChainSigner = new ethers.Wallet(privateKey, preferredChainProvider);

        // Transfer USDC from admin to preferred chain treasury Circle wallet
        const preferredChainUsdcContract = new ethers.Contract(
          preferredChainCircleUsdcAddress,
          ["function transfer(address,uint256) external returns (bool)", "function balanceOf(address) external view returns (uint256)"],
          preferredChainSigner
        );

        const preferredChainAdminBalance = await preferredChainUsdcContract.balanceOf(adminAddress);
        if (preferredChainAdminBalance < ngoPayoutAmount) {
          await sleep(30000);
          const newBalance = await preferredChainUsdcContract.balanceOf(adminAddress);
          if (newBalance < ngoPayoutAmount) {
            throw new Error(`Insufficient USDC on ${preferredChain} after bridge. Have: ${ethers.formatUnits(newBalance, 6)}, Need: ${ngoAmountDecimal}`);
          }
        }

        // Transfer to preferred chain treasury Circle wallet
        console.log(`   Transferring ${ngoAmountDecimal} USDC...`);
        const transferToPreferredChainTreasuryTx = await preferredChainUsdcContract.transfer(preferredChainTreasuryWalletAddress, ngoPayoutAmount, {
          gasLimit: 100000,
          maxFeePerGas: ethers.parseUnits("2", "gwei"),
          maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
        });
        console.log(`   Transaction Hash: ${transferToPreferredChainTreasuryTx.hash}`);
        console.log(`   Waiting for confirmation...`);
        const receipt = await transferToPreferredChainTreasuryTx.wait();
        console.log(`   ✅ Transaction confirmed in block ${receipt.blockNumber}\n`);

        // Wait a moment for state to sync
        await sleep(2000);

        // Wait for Circle to sync the balance (with retries and on-chain verification)
        console.log(`⏳ Waiting for Circle to sync ${preferredChain} treasury wallet balance...`);
        console.log(`   Expected amount: ${ngoAmountDecimal} USDC`);
        console.log(`   Circle API may need time to index the token...\n`);

        let preferredChainUsdcToken = null;
        let retryCount = 0;
        const maxRetries = 20; // Increased to 20 retries (60 seconds total)

        // Verify on-chain balance first (reuse preferredChainUsdcContract declared above)
        // Retry the balance check a few times in case of RPC lag
        let onChainBalance = BigInt(0);
        let balanceRetries = 0;
        const maxBalanceRetries = 5;
        while (balanceRetries < maxBalanceRetries && onChainBalance < ngoPayoutAmount) {
          await sleep(1000);
          onChainBalance = await preferredChainUsdcContract.balanceOf(preferredChainTreasuryWalletAddress);
          balanceRetries++;
          if (onChainBalance < ngoPayoutAmount && balanceRetries < maxBalanceRetries) {
            console.log(`   Retry ${balanceRetries}/${maxBalanceRetries} - Checking on-chain balance...`);
          }
        }

        console.log(`   On-chain USDC balance: ${ethers.formatUnits(onChainBalance, 6)} USDC`);
        if (onChainBalance < ngoPayoutAmount) {
          throw new Error(
            `On-chain balance insufficient after transfer. Have: ${ethers.formatUnits(onChainBalance, 6)}, Need: ${ngoAmountDecimal}. Transaction hash: ${transferToPreferredChainTreasuryTx.hash}`
          );
        }
        console.log(`   ✅ On-chain balance confirmed\n`);

        while (!preferredChainUsdcToken && retryCount < maxRetries) {
          await sleep(3000); // Wait 3 seconds between retries

          try {
            // Use getWalletTokenBalance to get balances (more reliable)
            const preferredChainTreasuryBalanceResponse = await circle.getWalletTokenBalance({
              id: preferredChainTreasuryWalletId,
            });

            const preferredChainTokenBalances =
              (preferredChainTreasuryBalanceResponse.data as any)?.tokenBalances || (preferredChainTreasuryBalanceResponse.data as any)?.balances || [];

            // Try to find USDC by symbol OR by address
            const preferredChainCircleUsdcLower = preferredChainCircleUsdcAddress.toLowerCase();

            preferredChainUsdcToken = preferredChainTokenBalances.find((token: any) => {
              const tokenInfo = token.token || token;
              const symbol = (tokenInfo?.symbol || "").toUpperCase();
              const address = (tokenInfo?.tokenAddress || tokenInfo?.address || "").toLowerCase();

              // Match by symbol OR by known USDC addresses on preferred chain
              return symbol.includes("USDC") || address === preferredChainCircleUsdcLower;
            });

            if (!preferredChainUsdcToken) {
              retryCount++;
              if (retryCount % 5 === 0) {
                console.log(`   Retry ${retryCount}/${maxRetries} - Circle API still syncing... (found ${preferredChainTokenBalances.length} token(s))`);
              }
            } else {
              console.log(`   ✅ USDC token found in Circle API after ${retryCount} retries!`);
              const tokenInfo = preferredChainUsdcToken.token || preferredChainUsdcToken;
              console.log(`   Token ID: ${tokenInfo.id}`);
              console.log(`   Symbol: ${tokenInfo.symbol || "USDC"}`);
              console.log(`   Address: ${tokenInfo.tokenAddress || tokenInfo.address || "N/A"}`);
              console.log(`   Balance: ${preferredChainUsdcToken.amount || preferredChainUsdcToken.balance || "0"} ${tokenInfo.symbol || "USDC"}\n`);
            }
          } catch (error: any) {
            retryCount++;
            if (retryCount % 5 === 0) {
              console.log(`   Retry ${retryCount}/${maxRetries} - API error: ${error?.message}`);
            }
          }
        }

        if (!preferredChainUsdcToken || !preferredChainUsdcToken.token?.id) {
          // Debug: Show what tokens we found
          try {
            const preferredChainTreasuryBalanceResponse = await circle.getWalletTokenBalance({
              id: preferredChainTreasuryWalletId,
            });
            const preferredChainTokenBalances =
              (preferredChainTreasuryBalanceResponse.data as any)?.tokenBalances || (preferredChainTreasuryBalanceResponse.data as any)?.balances || [];
            console.log(`\n   ⚠️  Found ${preferredChainTokenBalances.length} token(s) in Circle API:`);
            preferredChainTokenBalances.forEach((token: any, idx: number) => {
              const tokenInfo = token.token || token;
              console.log(`   ${idx + 1}. ${tokenInfo?.symbol || "Unknown"} - ${tokenInfo?.tokenAddress || tokenInfo?.address || "N/A"}`);
            });
          } catch (error: any) {
            console.log(`   ⚠️  Could not fetch token list: ${error?.message}`);
          }

          console.log(`\n   💡 On-chain balance confirmed: ${ethers.formatUnits(onChainBalance, 6)} USDC`);
          console.log(`   ⚠️  Circle API hasn't synced yet. This is normal - Circle needs time to index tokens.`);
          console.log(`   💡 Recommendation: Wait 30-60 seconds and try again, or use on-chain transfer instead.\n`);
          throw new Error("USDC token not found in Circle API. On-chain balance exists but Circle API needs more time to sync.");
        }

        // Step 4: Use Circle Gateway to send from preferred chain treasury Circle wallet to NGO Circle wallet
        console.log("📤 Step 4: Sending USDC to NGO Circle Wallet via Circle Gateway...");
        console.log(`   From: ${preferredChain} Treasury Circle wallet (${preferredChainTreasuryWalletId})`);
        console.log(`   To: NGO Circle wallet (${ngoCircleWalletId})`);
        console.log(`   Amount: ${ngoAmountDecimal} USDC\n`);

        // Use safer token access pattern (matching test_ngo_payout.js)
        const preferredChainTokenInfo = preferredChainUsdcToken.token || preferredChainUsdcToken;
        const preferredChainUsdcTokenId = preferredChainTokenInfo.id;
        const preferredChainUsdcBalance = parseFloat(preferredChainUsdcToken.amount || preferredChainUsdcToken.balance || "0");

        if (preferredChainUsdcBalance < parseFloat(ngoAmountDecimal)) {
          throw new Error(`Insufficient USDC in ${preferredChain} treasury wallet. Have: ${preferredChainUsdcBalance}, Need: ${ngoAmountDecimal}`);
        }

        // Create Circle Gateway transaction from preferred chain treasury to NGO wallet
        const ngoTransactionParams = {
          walletId: preferredChainTreasuryWalletId,
          tokenId: preferredChainUsdcTokenId,
          destinationAddress: ngoAddress,
          amounts: [ngoAmountDecimal],
          fee: {
            type: "level",
            config: {
              feeLevel: "MEDIUM",
            },
          },
        } as any;

        const ngoTransferResponse = await circle.createTransaction(ngoTransactionParams);
        const ngoTxData = (ngoTransferResponse.data as any)?.transaction || ngoTransferResponse.data;
        const ngoTxId = (ngoTxData as any)?.id || (ngoTransferResponse.data as any)?.id;
        const ngoTxState = (ngoTxData as any)?.state || (ngoTransferResponse.data as any)?.state;

        // Extract transaction hash if available (may be in different fields)
        const ngoTxHash =
          (ngoTxData as any)?.txHash ||
          (ngoTxData as any)?.hash ||
          (ngoTxData as any)?.transactionHash ||
          (ngoTransferResponse.data as any)?.txHash ||
          (ngoTransferResponse.data as any)?.hash ||
          (ngoTxData as any)?.onchainTxHash ||
          (ngoTxData as any)?.blockchainTxHash;

        console.log(`   Transaction ID: ${ngoTxId}`);
        console.log(`   Status: ${ngoTxState}`);
        if (ngoTxHash) {
          console.log(`   Transaction Hash: ${ngoTxHash}`);
        }
        console.log("");

        // Wait for transaction confirmation
        console.log("⏳ Waiting for Circle Gateway transaction confirmation...");
        let ngoAttempts = 0;
        const ngoMaxAttempts = 60;
        let currentNgoTxState = ngoTxState; // Track current state
        let currentNgoTxHash = ngoTxHash; // Track transaction hash

        while (ngoTxId && currentNgoTxState && ["INITIATED", "PENDING", "QUEUED", "SENT"].includes(currentNgoTxState) && ngoAttempts < ngoMaxAttempts) {
          await sleep(3000);
          try {
            const ngoStatusCheck = await circle.getTransaction({ id: ngoTxId });
            const ngoTxStatusData = (ngoStatusCheck.data as any)?.transaction || ngoStatusCheck.data;
            const newState = (ngoTxStatusData as any)?.state || (ngoStatusCheck.data as any)?.state;

            // Check for transaction hash (may be populated after submission)
            const newHash =
              ngoTxStatusData?.txHash ||
              ngoTxStatusData?.hash ||
              ngoTxStatusData?.transactionHash ||
              ngoTxStatusData?.onchainTxHash ||
              ngoTxStatusData?.blockchainTxHash;
            if (newHash && newHash !== currentNgoTxHash) {
              currentNgoTxHash = newHash;
              console.log(`   Transaction Hash: ${currentNgoTxHash}`);
            }

            if (newState !== currentNgoTxState) {
              console.log(`   Status: ${newState} (${ngoAttempts * 3}s elapsed)`);
              currentNgoTxState = newState; // Update state
              if (!["INITIATED", "PENDING", "QUEUED", "SENT"].includes(newState)) {
                break; // Final state reached
              }
            }
          } catch (error: any) {
            console.log(`   Error checking status: ${error?.message}`);
          }
          ngoAttempts++;
        }

        // Log final transaction hash if available
        if (currentNgoTxHash) {
          console.log(`   Final Transaction Hash: ${currentNgoTxHash}`);
        }

        if (currentNgoTxState === "COMPLETE" || currentNgoTxState === "COMPLETED" || currentNgoTxState === "CONFIRMED") {
          console.log("✅ NGO payment sent via Circle Gateway\n");
        } else {
          console.log(`⚠️  Transaction status: ${currentNgoTxState || ngoTxState}. May still be processing...\n`);
        }

        // Store NGO payout in Supabase
        await sb.from("yield_payouts").insert({
          market_id: body.marketId,
          recipient_type: "NGO",
          recipient_ngo_id: ngo.id,
          principal_usdc: "0",
          yield_usdc: ethers.formatUnits(ngoPayoutAmount, 6),
          total_usdc: ethers.formatUnits(ngoPayoutAmount, 6),
          preferred_chain: preferredChain,
          circle_transaction_id: ngoTxId,
          circle_transaction_state: currentNgoTxState,
        });
      } catch (error: any) {
        console.error(`❌ NGO payout failed for ${ngo.name}:`, error?.message);
        if (error.response) {
          console.error("Response:", JSON.stringify(error.response.data, null, 2));
        }
        // Continue with winner payout even if NGO fails
      }
    }

    // ========================================================================
    // 🔥 CIRCLE GATEWAY USAGE #3: Trader Payouts (all traders)
    // (matching test_system.js lines 2615-2718)
    // ========================================================================
    console.log("💸 Sending payouts to all traders via Circle Gateway...\n");

    // Use the USDC token we already found during sync
    if (!treasuryUsdcToken) {
      throw new Error("USDC token not found in treasury wallet");
    }

    // Execute trader payouts
    for (const trade of trades || []) {
      const trader = (trade as any).traders;
      if (!trader || !trader.wallet_address) continue;

      const payout = payoutMap.get(trader.wallet_address.toLowerCase());
      if (!payout) continue;

      const traderTotal = payout.principal + payout.reward;
      const traderTotalDecimal = ethers.formatUnits(traderTotal, 6);

      console.log(`\n💸 Paying trader ${trader.wallet_address} (${payout.isWinner ? "WINNER" : "LOSER"}):`);
      console.log(`   Principal: ${ethers.formatUnits(payout.principal, 6)} USDC`);
      console.log(`   Reward: ${ethers.formatUnits(payout.reward, 6)} USDC`);
      console.log(`   Total: ${traderTotalDecimal} USDC`);
      console.log(`   Wallet: ${trader.wallet_address}`);

      try {
        // Create Circle Gateway transaction (matching test_system.js lines 2652-2673)
        console.log("   📤 Creating Circle Gateway transaction...");
        const transactionParams = {
          walletId: treasuryWalletId,
          tokenId: usdcTokenId,
          destinationAddress: trader.wallet_address,
          amounts: [traderTotalDecimal],
          fee: {
            type: "level",
            config: {
              feeLevel: "MEDIUM",
            },
          },
        } as any;

        const transferResponse = await circle.createTransaction(transactionParams);
        const txData = (transferResponse.data as any)?.transaction || transferResponse.data;
        const txId = (txData as any)?.id || (transferResponse.data as any)?.id;
        const txState = (txData as any)?.state || (transferResponse.data as any)?.state;

        console.log(`   Transaction ID: ${txId}`);
        console.log(`   Status: ${txState}\n`);

        // Wait for transaction confirmation (matching test_system.js lines 2675-2698)
        console.log("⏳ Waiting for transaction confirmation...");
        let attempts = 0;
        const maxAttempts = 60;
        let currentTxState = txState; // Track current state

        while (txId && currentTxState && ["INITIATED", "PENDING", "QUEUED", "SENT"].includes(currentTxState) && attempts < maxAttempts) {
          await sleep(3000);
          try {
            const statusCheck = await circle.getTransaction({ id: txId });
            const txStatusData = (statusCheck.data as any)?.transaction || statusCheck.data;
            const newState = (txStatusData as any)?.state || (statusCheck.data as any)?.state;
            if (newState !== currentTxState) {
              console.log(`   Status: ${newState} (${attempts * 3}s elapsed)`);
              currentTxState = newState; // Update state
              if (!["INITIATED", "PENDING", "QUEUED", "SENT"].includes(newState)) {
                break; // Final state reached
              }
            }
          } catch (error: any) {
            console.log(`   Error checking status: ${error?.message}`);
          }
          attempts++;
        }

        if (currentTxState === "COMPLETE" || currentTxState === "COMPLETED" || currentTxState === "CONFIRMED") {
          console.log(`   ✅ Payment sent to trader ${trader.wallet_address}\n`);
        } else {
          console.log(`   ⚠️  Transaction status: ${currentTxState || txState}. May still be processing...\n`);
        }

        // Store trader payout in Supabase
        await sb.from("yield_payouts").insert({
          market_id: body.marketId,
          recipient_type: payout.isWinner ? "WINNER" : "LOSER",
          recipient_trader_id: trader.id,
          principal_usdc: ethers.formatUnits(payout.principal, 6),
          yield_usdc: ethers.formatUnits(payout.reward, 6),
          total_usdc: traderTotalDecimal,
          circle_transaction_id: txId,
          circle_transaction_state: currentTxState,
        });
      } catch (error: any) {
        console.error(`   ❌ Payout to trader ${trader.wallet_address} failed:`, error?.message);
        if (error.response) {
          console.error("   Response:", JSON.stringify(error.response.data, null, 2));
        }
        // Continue with next trader
      }

      // Small delay between transfers
      if (trades && trades.indexOf(trade) < trades.length - 1) {
        await sleep(2000);
      }
    }

    console.log(`📊 Protocol fees collected: ${ethers.formatUnits(protocolAmount, 6)} USDC\n`);

    console.log("=".repeat(80));
    console.log("CIRCLE GATEWAY + BRIDGE KIT SUMMARY");
    console.log("=".repeat(80));
    console.log("✅ Transfer #1: User Deposit (Trader → Treasury)");
    console.log("   Method: Circle Gateway Transfer API");
    console.log("   Chain: ARC-TESTNET (same chain)");
    console.log("");
    console.log("✅ Transfer #2: NGO Payout (Arc → Preferred Chain)");
    console.log("   Method: Circle Gateway + Bridge Kit (CCTP)");
    console.log("   Source: ARC-TESTNET (Arc Testnet)");
    console.log("   Destination: Various (NGO preferred chains)");
    console.log("   Protocol: CCTP (Cross-Chain Transfer Protocol)");
    console.log("   Mechanism: Burn → Attestation → Mint");
    console.log("");
    console.log("✅ Transfer #3: Trader Payouts (Treasury → Traders)");
    console.log("   Method: Circle Gateway Transfer API");
    console.log("   Chain: ARC-TESTNET (same chain)");
    console.log("   Winners: Principal + yield reward");
    console.log("   Losers: Principal refund only");
    console.log("=".repeat(80) + "\n");

    // Update market state to PAID_OUT
    await sb.from("markets").update({ state: "PAID_OUT" }).eq("id", body.marketId);

    return NextResponse.json({
      success: true,
      message: "Payouts executed successfully",
      positions: positions.map((p) => ({
        positionId: p.positionId,
        amount: ethers.formatUnits(p.amount, 6),
        blockNumber: p.blockNumber,
      })),
      totalPrincipal: ethers.formatUnits(totalPrincipal, 6),
      totalYield: ethers.formatUnits(realYieldFromAave, 6),
      totalYieldDistributed: ethers.formatUnits(distributionAmount, 6),
    });
  } catch (e: any) {
    // Ensure errors are always logged, even if JSON.stringify fails
    try {
      console.error("=".repeat(80));
      console.error("EXECUTE PAYOUTS ERROR:");
      console.error("=".repeat(80));
      console.error("Error message:", e?.message || "Unknown error");
      console.error("Error stack:", e?.stack || "No stack trace");
      console.error("Error name:", e?.name || "Unknown");
      
      // Try to stringify error object safely
      try {
        const errorStr = JSON.stringify(e, Object.getOwnPropertyNames(e), 2);
        console.error("Full error object:", errorStr);
      } catch (stringifyErr) {
        console.error("Could not stringify error object:", stringifyErr);
        console.error("Error toString():", String(e));
      }
      
      // Log additional context if available
      if (e?.code) console.error("Error code:", e.code);
      if (e?.reason) console.error("Error reason:", e.reason);
      if (e?.data) {
        try {
          console.error("Error data:", JSON.stringify(e.data, null, 2));
        } catch {
          console.error("Error data:", String(e.data));
        }
      }
      
      // Log error type
      console.error("Error type:", typeof e);
      console.error("Is Error instance:", e instanceof Error);
    } catch (logError) {
      // Even if logging fails, try to output something
      console.error("CRITICAL: Failed to log error properly:", logError);
      console.error("Original error (raw):", e);
    }
    
    // Always return a response, even if logging failed
    const errorMessage = e?.message || String(e) || "Failed to execute payouts";
    
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === "development" ? {
          stack: e?.stack,
          name: e?.name,
          code: e?.code,
        } : undefined,
      },
      { status: 500 }
    );
  }
}
