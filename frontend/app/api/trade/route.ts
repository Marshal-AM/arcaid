import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { circleWalletClient } from "../../../lib/circle";
import { supabaseClient } from "../../../lib/supabaseClient";
import { mustGetEnv } from "../../../lib/env";
import { ARC_CONTRACTS } from "../../../lib/constants";

type Body = {
  traderId: string;
  traderCircleWalletId: string;
  marketId: string; // markets.id (uuid)
  side: "YES" | "NO";
  amountUsdc: number; // e.g. 0.1
};

const MARKET_FACTORY_ABI = [
  "function participateWithPreTransferredUSDC(bytes32 marketId,address user,uint256 amount,bool voteYes) external",
];

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const side = body.side;
  if (side !== "YES" && side !== "NO") {
    return NextResponse.json({ error: "side must be YES or NO" }, { status: 400 });
  }

  const amount = Number(body.amountUsdc);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amountUsdc must be > 0" }, { status: 400 });
  }

  const sb = supabaseClient();

  // Fetch market onchain identifiers
  const { data: market, error: marketErr } = await sb
    .from("markets")
    .select("id, arc_market_id, arc_market_address, question, state")
    .eq("id", body.marketId)
    .single();

  if (marketErr) return NextResponse.json({ error: marketErr.message }, { status: 500 });
  if (!market) return NextResponse.json({ error: "market not found" }, { status: 404 });
  if (market.state !== "OPEN") {
    return NextResponse.json({ error: `market is not OPEN (state=${market.state})` }, { status: 400 });
  }
  if (!market.arc_market_id) {
    return NextResponse.json(
      { error: "Market missing arc_market_id in Supabase. Populate it after onchain createMarket." },
      { status: 400 },
    );
  }

  // Get trader wallet address from Circle
  const circle = circleWalletClient();
  const traderWalletResp = await circle.getWallet({ id: body.traderCircleWalletId });
  const traderAddress = traderWalletResp.data?.wallet?.address;
  if (!traderAddress) return NextResponse.json({ error: "Could not load trader Circle wallet address" }, { status: 500 });

  // Get wallet balance to find the USDC token ID (UUID) - matches test_system.js lines 630-658
  const balResp = await circle.getWalletTokenBalance({ id: body.traderCircleWalletId });
  const tokenBalances = balResp.data?.tokenBalances || [];
  const arcUsdcAddress = ARC_CONTRACTS.USDC.toLowerCase();

  // Note: Arc testnet uses USDC as native token, so USDC balance covers both transfer and gas
  // Check for native token balance (for gas fees) - matches test_system.js lines 637-646
  const nativeToken = tokenBalances.find((t: any) => {
    const ti = t?.token || t;
    return ti?.isNative === true;
  });
  const nativeBalance = nativeToken ? parseFloat((nativeToken as any).amount || "0") : 0;
  // Note: nativeBalance logged but not used for validation (USDC is native on Arc)

  // Find USDC token - check by symbol (case-insensitive, including USDC-TESTNET) or by address
  const usdcToken = tokenBalances.find((t: any) => {
    const ti = t?.token || t;
    const symbol = String(ti?.symbol || "").toUpperCase();
    const tokenAddress = String(ti?.tokenAddress || ti?.address || "").toLowerCase();
    return symbol.includes("USDC") || (arcUsdcAddress && tokenAddress === arcUsdcAddress);
  });

  if (!usdcToken || !(usdcToken as any)?.token?.id) {
    // Log available tokens for debugging - matches test_system.js lines 660-669
    const availableTokens = tokenBalances.map((token: any, idx: number) => {
      const tokenInfo = token.token || token;
      const symbol = tokenInfo?.symbol || "Unknown";
      const amount = token.amount || "0";
      const isNative = tokenInfo?.isNative ? " (native)" : "";
      return `${idx + 1}. ${symbol}: ${amount}${isNative}`;
    }).join(", ");
    
    return NextResponse.json({ 
      error: `USDC token not found in wallet. Available tokens: ${availableTokens || "none"}` 
    }, { status: 400 });
  }

  const usdcTokenId = (usdcToken as any).token.id;
  const usdcBalance = parseFloat((usdcToken as any).amount || (usdcToken as any).balance || "0");
  
  // Convert amount to decimal string (USDC has 6 decimals) - matches test_system.js lines 626-628
  const amountWei = ethers.parseUnits(amount.toFixed(6), 6);
  const amountDecimal = ethers.formatUnits(amountWei, 6);
  const transferAmount = parseFloat(amountDecimal);

  // On Arc testnet, USDC is the native token, so gas is paid in USDC
  // Validate balance - need enough for transfer + gas reserve - matches test_system.js lines 679-690
  const minGasReserve = 0.01; // Reserve at least 0.01 USDC for gas
  if (usdcBalance < transferAmount + minGasReserve) {
    return NextResponse.json({ 
      error: `Insufficient balance: wallet has ${usdcBalance} USDC but needs ${transferAmount} USDC for transfer + ${minGasReserve} USDC for gas = ${transferAmount + minGasReserve} USDC total` 
    }, { status: 400 });
  }

  // Validate destination address - matches test_system.js lines 692-695
  const marketFactoryAddress = ARC_CONTRACTS.MARKET_FACTORY;
  if (!ethers.isAddress(marketFactoryAddress)) {
    return NextResponse.json({ 
      error: `Invalid MarketFactory address: ${marketFactoryAddress}` 
    }, { status: 400 });
  }

  // Verify MarketFactory contract exists on-chain - matches test_system.js lines 697-708
  const arcRpcUrl = mustGetEnv("ARC_RPC_URL");
  const provider = new ethers.JsonRpcProvider(arcRpcUrl);
  
  try {
    const code = await provider.getCode(marketFactoryAddress);
    if (code === "0x" || code === "0x0") {
      return NextResponse.json({ 
        error: `MarketFactory contract not found at ${marketFactoryAddress}. Contract may not be deployed.` 
      }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ 
      error: `Cannot verify MarketFactory contract: ${error?.message || "Unknown error"}` 
    }, { status: 500 });
  }

  // Check USDC token contract - matches test_system.js lines 710-724
  const usdcContractAddress = (usdcToken as any).token?.tokenAddress || ARC_CONTRACTS.USDC;
  if (usdcContractAddress) {
    try {
      const usdcCode = await provider.getCode(usdcContractAddress);
      if (usdcCode === "0x" || usdcCode === "0x0") {
        // Warning only, don't fail
      }
    } catch {
      // Warning only, don't fail
    }
  }

  // Build transaction parameters - matches test_system.js lines 735-746
  const transactionParams = {
    walletId: body.traderCircleWalletId,
    tokenId: usdcTokenId,
    destinationAddress: marketFactoryAddress,
    amounts: [amountDecimal],
    fee: {
      type: "level",
      config: {
        feeLevel: "MEDIUM",
      },
    },
  } as any;

  // Create Circle transfer transaction - matches test_system.js lines 748-750
  const transferResp = await circle.createTransaction(transactionParams);

  // Get transaction data - matches test_system.js lines 752-755
  const txData = (transferResp.data as any)?.transaction || transferResp.data;
  let circleTxId = txData?.id || (transferResp.data as any)?.id;
  let circleTxState = txData?.state || (transferResp.data as any)?.state;

  if (!circleTxId) {
    return NextResponse.json({ error: "Circle transaction id missing from response" }, { status: 500 });
  }

  // Wait for transaction confirmation - matches test_system.js lines 765-793
  let attempts = 0;
  const maxAttempts = 60; // Wait up to 3 minutes (60 * 3 seconds) - matches test_system.js line 768

  // Log initial state
  console.log(`[trade] Circle transaction created: ${circleTxId}, initial state: ${circleTxState}`);

  while (circleTxId && circleTxState && ["INITIATED", "PENDING", "QUEUED", "SENT"].includes(circleTxState) && attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const statusCheck = await circle.getTransaction({ id: circleTxId });
      const txStatusData = (statusCheck.data as any)?.transaction || statusCheck.data;
      const newState = txStatusData?.state || (statusCheck.data as any)?.state;
      
      if (newState !== circleTxState) {
        console.log(`[trade] Circle transaction state changed: ${circleTxState} → ${newState} (${attempts * 3}s elapsed)`);
        circleTxState = newState;
        
        // Break immediately if transaction completed - matches test_system.js behavior
        if (newState === "COMPLETE" || newState === "COMPLETED" || newState === "CONFIRMED") {
          console.log(`[trade] ✅ Circle transaction completed! Breaking polling loop.`);
          break;
        }
        
        // Break if transaction failed
        if (newState === "FAILED") {
          console.log(`[trade] ❌ Circle transaction failed! Breaking polling loop.`);
          break;
        }
      } else {
        // Show progress every 15 seconds (every 5 attempts) - matches test_system.js lines 784-787
        if (attempts % 5 === 0 && attempts > 0) {
          console.log(`[trade] Still waiting for Circle transaction confirmation... State: ${circleTxState} (${attempts * 3}s elapsed)`);
        }
      }
    } catch (error: any) {
      console.log(`[trade] Error checking Circle transaction status: ${error?.message || "Unknown error"}`);
      // Continue polling despite transient errors
    }
    attempts++;
  }

  console.log(`[trade] Circle transaction polling completed. Final state: ${circleTxState}, attempts: ${attempts}/${maxAttempts}`);

  // Handle transaction states - matches test_system.js lines 795-853
  if (circleTxState === "FAILED") {
    console.log(`[trade] ❌ Transaction failed! Getting failure details...`);
    // Get more details about the failure - matches test_system.js lines 801-845
    let txDetails = null;
    try {
      const failedTx = await circle.getTransaction({ id: circleTxId });
      txDetails = (failedTx.data as any)?.transaction || failedTx.data;
      
      console.log(`[trade] Error Reason: ${txDetails?.errorReason || "Unknown"}`);
      console.log(`[trade] Error Details: ${txDetails?.errorDetails || "None"}`);
      if (txDetails?.txHash) {
        console.log(`[trade] Transaction Hash: ${txDetails.txHash}`);
      }
      
      if (txDetails?.errorReason === "ESTIMATION_ERROR") {
        console.log(`[trade] 💡 ESTIMATION_ERROR means the transaction would revert on-chain.`);
        const errorMsg = `Transfer transaction failed: ${txDetails.errorReason || circleTxState} - ${txDetails.errorDetails || "execution reverted"}`;
        return NextResponse.json({ error: errorMsg }, { status: 500 });
      }
      
      const errorMsg = txDetails 
        ? `Transfer transaction failed: ${txDetails.errorReason || circleTxState} - ${txDetails.errorDetails || "See details above"}`
        : `Transfer transaction failed with state: ${circleTxState}`;
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    } catch (error: any) {
      console.log(`[trade] Could not get transaction details: ${error?.message || "Unknown error"}`);
      return NextResponse.json({ error: `Transfer transaction failed with state: ${circleTxState}` }, { status: 500 });
    }
  }

  if (!circleTxId) {
    return NextResponse.json({ error: "Transaction ID not found - cannot verify transfer" }, { status: 500 });
  }

  // Handle case where transaction is still pending after max attempts - matches test_system.js lines 848-853
  if (circleTxState && ["INITIATED", "PENDING", "QUEUED", "SENT"].includes(circleTxState) && attempts >= maxAttempts) {
    console.log(`[trade] ⚠️  Transaction status: ${circleTxState} after ${attempts * 3}s`);
    console.log(`[trade] Transaction may still be processing on-chain`);
    console.log(`[trade] You can check status manually with transaction ID: ${circleTxId}`);
    console.log(`[trade] Continuing anyway, but participation recording may fail if USDC hasn't arrived yet...`);
    // Don't return error - continue and let participation step handle it
  }

  // Additional wait to ensure on-chain confirmation - matches test_system.js lines 856-859
  if (circleTxState === "COMPLETE" || circleTxState === "COMPLETED" || circleTxState === "CONFIRMED") {
    console.log(`[trade] Circle transfer completed. Waiting additional 5 seconds for on-chain confirmation...`);
    await new Promise((r) => setTimeout(r, 5000));
    console.log(`[trade] On-chain confirmation wait complete`);
  }

  // STEP 2: Record participation in smart contract - matches test_system.js lines 869-1012
  // Note: The Circle transfer already moved USDC from trader wallet to MarketFactory
  // Now we call participateWithPreTransferredUSDC() to record the participation

  if (circleTxState !== "COMPLETE" && circleTxState !== "COMPLETED" && circleTxState !== "CONFIRMED") {
    return NextResponse.json({ 
      error: `Cannot record participation: Circle transfer not completed. Status: ${circleTxState}` 
    }, { status: 500 });
  }

  // Verify trader wallet address again - matches test_system.js lines 879-884
  const traderWalletInfo = await circle.getWallet({ id: body.traderCircleWalletId });
  const traderWalletAddress = traderWalletInfo.data?.wallet?.address;
  if (!traderWalletAddress) {
    return NextResponse.json({ error: "Could not get trader wallet address from Circle" }, { status: 500 });
  }

  // Create MarketFactory contract instance - matches test_system.js lines 890-899
  const adminPk = mustGetEnv("ADMIN_PRIVATE_KEY");
  const signer = new ethers.Wallet(adminPk.startsWith("0x") ? adminPk : `0x${adminPk}`, provider);

  const marketFactory = new ethers.Contract(
    marketFactoryAddress,
    [
      "function participateWithPreTransferredUSDC(bytes32,address,uint256,bool) external",
      "function getMarket(bytes32) external view returns (tuple(address,address,address,bytes32,bool))",
      "function usdcToken() external view returns (address)",
    ],
    signer
  );

  // Ensure marketId is properly formatted as bytes32 (add 0x prefix if missing)
  // In test_system.js, marketId comes from contract event and is already bytes32 with 0x prefix
  // In Supabase, it's stored as hex string without 0x prefix
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

  // Verify MarketFactory contract exists - matches test_system.js lines 901-913
  let marketInfo: any;
  try {
    marketInfo = await marketFactory.getMarket(marketIdBytes32);
    if (!marketInfo || marketInfo.marketAddress === ethers.ZeroAddress) {
      return NextResponse.json({ 
        error: `Market ${marketIdBytes32} not found in MarketFactory` 
      }, { status: 400 });
    }
  } catch (error: any) {
    if (error?.message?.includes("Market")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Warning only, continue
  }

  // Verify USDC balance in MarketFactory before calling participateWithPreTransferredUSDC
  // Matches test_system.js lines 915-948
  console.log(`[trade] Verifying USDC balance in MarketFactory before participation...`);
  try {
    const usdcTokenAddress = await marketFactory.usdcToken();
    const usdcContract = new ethers.Contract(
      usdcTokenAddress,
      ["function balanceOf(address) external view returns (uint256)"],
      provider
    );
    const marketFactoryBalance = await usdcContract.balanceOf(marketFactoryAddress);
    const expectedBalance = amountWei;

    // Log balances - matches test_system.js lines 926-927
    const marketFactoryBalanceFormatted = ethers.formatUnits(marketFactoryBalance, 6);
    const expectedBalanceFormatted = ethers.formatUnits(expectedBalance, 6);
    console.log(`[trade] MarketFactory USDC balance: ${marketFactoryBalanceFormatted} USDC`);
    console.log(`[trade] Expected balance (from transfer): ${expectedBalanceFormatted} USDC`);

    if (marketFactoryBalance < expectedBalance) {
      // Log warning and wait - matches test_system.js lines 929-933
      console.log(`[trade] WARNING: MarketFactory balance (${marketFactoryBalanceFormatted}) is less than expected (${expectedBalanceFormatted})`);
      console.log(`[trade] Circle transfer may still be processing on-chain. Waiting additional 10 seconds...`);
      await new Promise((r) => setTimeout(r, 10000));

      // Check again - matches test_system.js lines 935-941
      const newBalance = await usdcContract.balanceOf(marketFactoryAddress);
      const newBalanceFormatted = ethers.formatUnits(newBalance, 6);
      console.log(`[trade] MarketFactory USDC balance after wait: ${newBalanceFormatted} USDC`);
      
      if (newBalance < expectedBalance) {
        return NextResponse.json({ 
          error: `Insufficient USDC in MarketFactory. Have: ${newBalanceFormatted}, Need: ${expectedBalanceFormatted}` 
        }, { status: 500 });
      }
    } else {
      // Log success - matches test_system.js line 943
      console.log(`[trade] ✅ MarketFactory has sufficient USDC balance`);
    }
  } catch (error: any) {
    // Warning only, proceed anyway - matches test_system.js lines 945-948
    console.log(`[trade] ⚠️  Could not verify USDC balance: ${error?.message || "Unknown error"}`);
    console.log(`[trade] Proceeding anyway, but participation may fail if USDC hasn't arrived...`);
  }

  // Call participateWithPreTransferredUSDC - matches test_system.js lines 950-991
  let participationTxHash: string | null = null;
  let participateError: string | null = null;

  const voteType = side;
  console.log(`[trade] Calling participateWithPreTransferredUSDC...`);
  console.log(`[trade] Parameters:`);
  console.log(`[trade]   - Market ID: ${market.arc_market_id}`);
  console.log(`[trade]   - User Wallet: ${traderWalletAddress}`);
  console.log(`[trade]   - Amount: ${ethers.formatUnits(amountWei, 6)} USDC`);
  console.log(`[trade]   - Vote: ${voteType}`);

  try {
    const voteYes = side === "YES";

    const participateTx = await marketFactory.participateWithPreTransferredUSDC(
      marketIdBytes32,
      traderWalletAddress,
      amountWei,
      voteYes
    );
    participationTxHash = participateTx.hash;
    console.log(`[trade] Participation transaction hash: ${participationTxHash}`);
    console.log(`[trade] Waiting for confirmation...`);
    
    const receipt = await participateTx.wait();
    console.log(`[trade] ✅ Transaction confirmed in block ${receipt.blockNumber}`);

    // Log current YES/NO token prices (dynamic pricing) - matches test_system.js lines 973-986
    try {
      // Get market address - matches test_system.js line 975
      const marketAddr = marketInfo?.[0] || marketInfo?.marketAddress || market.arc_market_address;
      if (marketAddr) {
        const marketPriceContract = new ethers.Contract(
          marketAddr,
          ["function getYesPrice() view returns (uint256)", "function getNoPrice() view returns (uint256)"],
          provider
        );
        const [yesPrice, noPrice] = await Promise.all([
          marketPriceContract.getYesPrice(),
          marketPriceContract.getNoPrice(),
        ]);
        console.log(`[trade] 📊 Current market prices: YES = ${ethers.formatUnits(yesPrice, 6)} USDC, NO = ${ethers.formatUnits(noPrice, 6)} USDC`);
      }
    } catch (e: any) {
      // Ignore price fetch errors - matches test_system.js line 985
      console.log(`[trade] ⚠️  Could not read prices: ${e?.message || "Unknown error"}`);
    }

    console.log(`[trade] ✅ Participation recorded successfully`);
    console.log(`[trade] ✅ Trader ${traderWalletAddress} participated with ${ethers.formatUnits(amountWei, 6)} USDC`);
    console.log(`[trade] ✅ Received ${voteType} tokens`);
  } catch (e: any) {
    console.error(`[trade] ❌ Error recording participation: ${e?.message || "Unknown error"}`);
    participateError = e?.message ? String(e.message) : "participateWithPreTransferredUSDC failed";
    
    // Detailed error messages - matches test_system.js lines 994-1009
    if (e?.message?.includes("function") && e?.message?.includes("not found")) {
      console.log(`[trade] ⚠️  MarketFactory.participateWithPreTransferredUSDC() not found!`);
      console.log(`[trade] Contract may need redeployment.`);
      participateError = "MarketFactory.participateWithPreTransferredUSDC() not found! Contract may need redeployment.";
    } else if (e?.message?.includes("Insufficient USDC")) {
      console.log(`[trade] ⚠️  Insufficient USDC in MarketFactory contract.`);
      console.log(`[trade] Circle transfer may not have completed yet.`);
      participateError = "Insufficient USDC in MarketFactory contract. Circle transfer may not have completed yet.";
    } else if (e?.message?.includes("Only admin")) {
      console.log(`[trade] ⚠️  Only admin can call participateWithPreTransferredUSDC().`);
      participateError = "Only admin can call participateWithPreTransferredUSDC().";
    } else if (e?.message?.includes("Market not active")) {
      console.log(`[trade] ⚠️  Market is not active.`);
      participateError = "Market is not active.";
    }
  }

  // Record trade row in Supabase
  const { data: tradeRow, error: tradeErr } = await sb
    .from("trades")
    .insert({
      trader_id: body.traderId,
      market_id: body.marketId,
      side,
      amount_usdc: amountDecimal,
      circle_transaction_id: circleTxId,
      circle_transaction_state: circleTxState ?? null,
      arc_participation_tx_hash: participationTxHash,
    })
    .select("id")
    .single();

  if (tradeErr) return NextResponse.json({ error: tradeErr.message }, { status: 500 });

  return NextResponse.json({
    tradeId: tradeRow.id,
    circle: { id: circleTxId, state: circleTxState },
    participation: { txHash: participationTxHash, error: participateError },
  });
}

