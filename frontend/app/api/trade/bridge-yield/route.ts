import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createEthersAdapterFromPrivateKey } from "@circle-fin/adapter-ethers-v6";
import { mustGetEnv } from "../../../../lib/env";
import { ARC_CONTRACTS, BASE_SEPOLIA_CONTRACTS } from "../../../../lib/constants";

type Body = {
  marketId: string; // arc_market_id (bytes32)
  amountWei: string; // Amount in wei (6 decimals for USDC)
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const logs: Array<{ step: string; message: string; explorerUrl?: string; txHash?: string }> = [];
  
  try {
    const arcRpcUrl = mustGetEnv("ARC_RPC_URL");
    const baseRpcUrl = mustGetEnv("BASE_SEPOLIA_RPC_URL");
    const adminPk = mustGetEnv("ADMIN_PRIVATE_KEY");
    const marketFactoryAddress = ARC_CONTRACTS.MARKET_FACTORY;
    const bridgeManagerAddress = ARC_CONTRACTS.BRIDGE_MANAGER;
    const circleUsdcAddress = BASE_SEPOLIA_CONTRACTS.CIRCLE_USDC;
    const aaveUsdcAddress = BASE_SEPOLIA_CONTRACTS.AAVE_USDC;
    const swapRouterAddress = BASE_SEPOLIA_CONTRACTS.SWAP_ROUTER;
    const yieldControllerAddress = BASE_SEPOLIA_CONTRACTS.YIELD_CONTROLLER;
    const baseSepoliaChainId = 84532;

    const amountWei = BigInt(body.amountWei);
    const amountDecimal = ethers.formatUnits(amountWei, 6);

    // Ensure marketId is properly formatted as bytes32 (add 0x prefix if missing)
    // In test_system.js, marketId comes from contract event and is already bytes32 with 0x prefix
    // In Supabase/frontend, it's stored as hex string without 0x prefix
    let marketIdBytes32 = body.marketId;
    if (!marketIdBytes32.startsWith("0x")) {
      marketIdBytes32 = "0x" + marketIdBytes32;
    }
    // Ensure it's exactly 66 characters (0x + 64 hex chars) for bytes32
    if (marketIdBytes32.length !== 66) {
      return NextResponse.json({ 
        error: `Invalid marketId length: ${marketIdBytes32.length}, expected 66 (0x + 64 hex chars). Value: ${marketIdBytes32}` 
      }, { status: 400 });
    }

    // Setup providers and signers
    const arcProvider = new ethers.JsonRpcProvider(arcRpcUrl);
    const baseProvider = new ethers.JsonRpcProvider(baseRpcUrl);
    const privateKey = adminPk.startsWith("0x") ? adminPk : `0x${adminPk}`;
    const arcSigner = new ethers.Wallet(privateKey, arcProvider);
    const baseSigner = new ethers.Wallet(privateKey, baseProvider);
    const adminAddress = await arcSigner.getAddress();

    logs.push({ step: "init", message: `Starting bridge and yield deployment for ${amountDecimal} USDC` });

    // ========================================================================
    // STEP 1: Withdraw USDC from MarketFactory to admin on Arc
    // ========================================================================
    logs.push({ step: "withdraw", message: "Withdrawing USDC from MarketFactory to admin on Arc..." });
    
    const marketFactory = new ethers.Contract(
      marketFactoryAddress,
      ["function emergencyWithdraw(address to, uint256 amount) external"],
      arcSigner
    );
    
    const withdrawTx = await marketFactory.emergencyWithdraw(adminAddress, amountWei);
    const withdrawReceipt = await withdrawTx.wait();
    
    const withdrawExplorerUrl = `https://testnet.arcscan.app/tx/${withdrawTx.hash}`;
    logs.push({ 
      step: "withdraw", 
      message: "✅ USDC withdrawn to admin on Arc", 
      explorerUrl: withdrawExplorerUrl,
      txHash: withdrawTx.hash
    });

    // ========================================================================
    // STEP 2: Bridge Arc → Base Sepolia using Circle Bridge Kit
    // ========================================================================
    logs.push({ step: "bridge", message: "Initiating Circle Bridge Kit (CCTP) transfer..." });
    
    const adapter = createEthersAdapterFromPrivateKey({
      privateKey,
      getProvider: ({ chain }) => {
        const rpcMap: Record<string, string> = {
          "Arc_Testnet": arcRpcUrl,
          "Arc Testnet": arcRpcUrl,
          "Base_Sepolia": baseRpcUrl,
          "Base Sepolia": baseRpcUrl,
        };
        const rpcUrl = rpcMap[chain.name || ""] || rpcMap[chain.chain || ""];
        if (!rpcUrl) {
          throw new Error(`RPC not configured for chain: ${chain.name || chain.chain}`);
        }
        return new ethers.JsonRpcProvider(rpcUrl);
      },
    });
    
    const bridgeKit = new BridgeKit();
    const result = await bridgeKit.bridge({
      from: { adapter, chain: "Arc_Testnet" },
      to: { adapter, chain: "Base_Sepolia" },
      amount: amountDecimal,
    });

    // Collect bridge step URLs
    if (result.steps && result.steps.length > 0) {
      result.steps.forEach((step: any, i: number) => {
        logs.push({
          step: "bridge",
          message: `Bridge step ${i + 1}: ${step.name} - ${step.state}`,
          explorerUrl: step.data?.explorerUrl,
        });
      });
    }

    if (result.state === "error") {
      const errStep = result.steps?.find((s: any) => s.state === "error");
      const errMsg = errStep
        ? (errStep.errorMessage || (errStep.error && String(errStep.error)) || JSON.stringify(errStep))
        : "Bridge failed";
      throw new Error(String(errMsg));
    }

    if (result.state === "pending") {
      logs.push({ step: "bridge", message: "⏳ Bridge in progress (attestation/mint may be pending). Waiting 60s..." });
      await sleep(60000);
    }

    // Record bridge in BridgeManager
    const attestationId = (result.config as any)?.attestationId || `cctp-${Date.now()}`;
    const bridgeManager = new ethers.Contract(
      bridgeManagerAddress,
      ["function initiateBridge(bytes32,uint256,uint256,string) external returns (bytes32)"],
      arcSigner
    );
    
    const bridgeRecordTx = await bridgeManager.initiateBridge(
      marketIdBytes32,
      amountWei,
      baseSepoliaChainId,
      attestationId
    );
    await bridgeRecordTx.wait();
    
    logs.push({
      step: "bridge",
      message: "✅ Bridge operation recorded in BridgeManager",
      explorerUrl: `https://testnet.arcscan.app/tx/${bridgeRecordTx.hash}`,
      txHash: bridgeRecordTx.hash,
    });
    logs.push({ step: "bridge", message: "✅ USDC bridged to Base Sepolia" });

    // ========================================================================
    // STEP 3: Swap Circle USDC → Aave USDC
    // ========================================================================
    logs.push({ step: "swap", message: "Swapping Circle USDC → Aave USDC..." });
    logs.push({ step: "swap", message: "Note: Bridge gives Circle USDC, but Aave needs Aave USDC" });
    
    const circleUsdcContract = new ethers.Contract(
      circleUsdcAddress,
      [
        "function balanceOf(address) external view returns (uint256)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function decimals() external view returns (uint8)",
        "function symbol() external view returns (string)",
      ],
      baseProvider
    );

    const aaveUsdcContract = new ethers.Contract(
      aaveUsdcAddress,
      [
        "function balanceOf(address) external view returns (uint256)",
        "function decimals() external view returns (uint8)",
        "function symbol() external view returns (string)",
      ],
      baseProvider
    );

    // Get decimals and symbols - matches test_system.js lines 1146-1147
    const circleDecimals = await circleUsdcContract.decimals();
    const circleSymbol = await circleUsdcContract.symbol();

    // Wait a bit for bridge to complete - matches test_system.js
    await sleep(5000);
    
    // Check Circle USDC balance - matches test_system.js lines 1149-1155
    const circleBalance = await circleUsdcContract.balanceOf(adminAddress);
    logs.push({ step: "swap", message: `Circle USDC balance (wallet total): ${ethers.formatUnits(circleBalance, circleDecimals)} ${circleSymbol}` });
    
    if (circleBalance === BigInt(0)) {
      throw new Error("No Circle USDC to swap! The bridge may not have completed yet.");
    }

    // Swap ONLY the amount that was bridged this run (not the whole wallet) - matches test_system.js lines 1157-1165
    const swapAmount = amountWei != null && amountWei > BigInt(0)
      ? (amountWei <= circleBalance ? amountWei : circleBalance)
      : circleBalance;
    
    logs.push({ step: "swap", message: `Amount bridged this run: ${ethers.formatUnits(amountWei, circleDecimals)} USDC` });
    logs.push({ step: "swap", message: `Swapping ONLY this amount: ${ethers.formatUnits(swapAmount, circleDecimals)} USDC → Aave USDC` });

    // Get Aave USDC balance before swap - matches test_system.js lines 1167-1171
    const aaveBalanceBefore = await aaveUsdcContract.balanceOf(adminAddress);
    const aaveDecimals = await aaveUsdcContract.decimals();
    const aaveSymbol = await aaveUsdcContract.symbol();
    logs.push({ step: "swap", message: `Aave USDC balance (before): ${ethers.formatUnits(aaveBalanceBefore, aaveDecimals)} ${aaveSymbol}` });

    // Approve Circle USDC for swap router - matches test_system.js lines 1173-1207
    logs.push({ step: "swap", message: "Approving Circle USDC for Uniswap SwapRouter..." });
    const allowance = await circleUsdcContract.allowance(adminAddress, swapRouterAddress);
    
    if (allowance < swapAmount) {
      logs.push({ step: "swap", message: `Current allowance: ${ethers.formatUnits(allowance, circleDecimals)} USDC` });
      logs.push({ step: "swap", message: `Required amount: ${ethers.formatUnits(swapAmount, circleDecimals)} USDC` });
      
      const gasOptions = {
        gasLimit: 100000,
        maxFeePerGas: ethers.parseUnits("2", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
      };
      
      if (allowance > BigInt(0)) {
        logs.push({ step: "swap", message: "Resetting existing allowance to 0..." });
        const resetTx = await (circleUsdcContract.connect(baseSigner) as any).approve(swapRouterAddress, BigInt(0), gasOptions);
        await resetTx.wait();
        logs.push({ step: "swap", message: "✅ Reset complete" });
        await sleep(2000);
      }

      logs.push({ step: "swap", message: "Setting new allowance..." });
      const approveTx = await (circleUsdcContract.connect(baseSigner) as any).approve(swapRouterAddress, swapAmount, gasOptions);
      await approveTx.wait();
      logs.push({ step: "swap", message: "✅ Approval confirmed" });
      logs.push({ step: "swap", message: "Waiting 3 seconds for confirmation to propagate..." });
      await sleep(3000);
    } else {
      logs.push({ step: "swap", message: `✅ Already approved (allowance: ${ethers.formatUnits(allowance, circleDecimals)} USDC)` });
    }

    // Prepare swap parameters (swap entire amount with 5% slippage tolerance) - matches test_system.js lines 1209-1220
    const minAmountOut = (swapAmount * BigInt(95)) / BigInt(100); // 5% slippage tolerance
    
    const swapParams = {
      tokenIn: circleUsdcAddress,
      tokenOut: aaveUsdcAddress,
      fee: 500, // 0.05% fee tier
      recipient: adminAddress,
      amountIn: swapAmount,
      amountOutMinimum: minAmountOut,
      sqrtPriceLimitX96: 0, // No price limit - matches test_system.js line 1219
    };

    logs.push({ step: "swap", message: `Swapping ${ethers.formatUnits(swapAmount, circleDecimals)} Circle USDC → Aave USDC...` });
    // DEBUG: Swap params - matches test_system.js lines 1223-1231
    logs.push({ 
      step: "swap", 
      message: `DEBUG: Swap params: ${JSON.stringify({
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        fee: swapParams.fee,
        recipient: swapParams.recipient,
        amountIn: swapParams.amountIn.toString(),
        amountOutMinimum: swapParams.amountOutMinimum.toString(),
        sqrtPriceLimitX96: swapParams.sqrtPriceLimitX96.toString(),
      }, null, 2)}`
    });

    const swapRouter = new ethers.Contract(
      swapRouterAddress,
      [
        "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
      ],
      baseSigner
    );

    // DEBUG: Check contract and function - matches test_system.js lines 1241-1253
    logs.push({ step: "swap", message: `DEBUG: SwapRouter address: ${swapRouter.target}` });
    logs.push({ step: "swap", message: `DEBUG: Signer address: ${adminAddress}` });
    logs.push({ step: "swap", message: `DEBUG: Function exists: ${typeof swapRouter.exactInputSingle === 'function'}` });
    
    // DEBUG: Try to populate transaction first to see the encoded data - matches test_system.js lines 1246-1253
    try {
      const populatedTx = await swapRouter.exactInputSingle.populateTransaction(swapParams);
      logs.push({ step: "swap", message: `DEBUG: Transaction data length: ${populatedTx.data.length}` });
      logs.push({ step: "swap", message: `DEBUG: Transaction data preview: ${populatedTx.data.substring(0, 66)}...` });
    } catch (err: any) {
      logs.push({ step: "swap", message: `DEBUG: Error populating transaction: ${err?.message || "Unknown error"}` });
    }

    const swapTx = await swapRouter.exactInputSingle(swapParams, {
      value: 0, // CRITICAL: Must explicitly set value: 0 for payable functions when not sending ETH - matches test_system.js line 1256
      gasLimit: 200000,
      maxFeePerGas: ethers.parseUnits("2", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
    });

    logs.push({ step: "swap", message: `Transaction hash: ${swapTx.hash}` });
    logs.push({ step: "swap", message: "Waiting for confirmation..." });

    const swapReceipt = await swapTx.wait();
    const swapExplorerUrl = `https://sepolia.basescan.org/tx/${swapTx.hash}`;
    
    logs.push({ step: "swap", message: `✅ Swap confirmed in block ${swapReceipt.blockNumber}` });
    logs.push({ step: "swap", message: `Gas used: ${swapReceipt.gasUsed?.toString() || "N/A"}` });

    // Verify swap results - matches test_system.js lines 1269-1280
    logs.push({ step: "swap", message: "Verifying swap results..." });
    await sleep(3000);

    const circleBalanceAfter = await circleUsdcContract.balanceOf(adminAddress);
    const aaveBalanceAfter = await aaveUsdcContract.balanceOf(adminAddress);

    logs.push({ step: "swap", message: `Circle USDC balance (after): ${ethers.formatUnits(circleBalanceAfter, circleDecimals)} ${circleSymbol}` });
    logs.push({ step: "swap", message: `Aave USDC balance (after): ${ethers.formatUnits(aaveBalanceAfter, aaveDecimals)} ${aaveSymbol}` });

    const aaveReceived = aaveBalanceAfter - aaveBalanceBefore;
    logs.push({
      step: "swap",
      message: `✅ Received: ${ethers.formatUnits(aaveReceived, aaveDecimals)} Aave USDC`,
      explorerUrl: swapExplorerUrl,
      txHash: swapTx.hash,
    });

    if (aaveReceived <= BigInt(0)) {
      throw new Error("Swap returned 0 USDC. Swap may have failed or still processing.");
    }

    // ========================================================================
    // STEP 4: Deploy to Aave V3
    // ========================================================================
    logs.push({ step: "deploy", message: "Deploying Aave USDC to Real Aave V3 (Base Sepolia)..." });
    logs.push({ step: "deploy", message: `Note: 'amount' parameter = ${ethers.formatUnits(aaveReceived, 6)} USDC (actual amount from swap, not original deposit)` });
    
    if (!yieldControllerAddress) {
      throw new Error("ETH_YIELD_CONTROLLER (baseSepolia.contracts.yieldController) is not set in config.");
    }

    const yieldController = new ethers.Contract(
      yieldControllerAddress,
      [
        "function deployToAave(bytes32,uint256) external returns (bytes32)",
        "function getCurrentYield(bytes32) external view returns (uint256)",
      ],
      baseSigner
    );

    // Use Aave USDC contract (after swap) - matches test_system.js lines 1305-1314
    const usdcContract = new ethers.Contract(
      aaveUsdcAddress,
      [
        "function balanceOf(address) external view returns (uint256)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function approve(address,uint256) external returns (bool)",
      ],
      baseProvider
    );

    // Check total balance (for information only) - matches test_system.js lines 1316-1325
    const totalBalance = await usdcContract.balanceOf(adminAddress);
    logs.push({ step: "deploy", message: `Total Aave USDC balance on Base Sepolia: ${ethers.formatUnits(totalBalance, 6)} USDC` });
    logs.push({ step: "deploy", message: `⚠️  Note: This includes leftover funds from previous test runs` });
    
    // Only deposit what came from THIS test run (the 'amount' parameter)
    // This is the actual amount received from the swap in the current flow - matches test_system.js lines 1321-1325
    const depositAmount = aaveReceived;
    logs.push({ step: "deploy", message: `Amount from current swap: ${ethers.formatUnits(depositAmount, 6)} USDC` });
    logs.push({ step: "deploy", message: `Will deposit ONLY this amount to Aave (not the entire balance)` });

    if (depositAmount <= BigInt(0)) {
      throw new Error("Swap returned 0 USDC. Swap may have failed or still processing.");
    }
    
    if (totalBalance < depositAmount) {
      throw new Error(
        `Insufficient balance! Have ${ethers.formatUnits(totalBalance, 6)}, need ${ethers.formatUnits(depositAmount, 6)}. This shouldn't happen.`
      );
    }

    // Approve Aave USDC for YieldController - matches test_system.js lines 1339-1371
    logs.push({ step: "deploy", message: "Approving Aave USDC for YieldController..." });
    const aaveAllowance = await usdcContract.allowance(adminAddress, yieldControllerAddress);
    
    if (aaveAllowance < depositAmount) {
      logs.push({ step: "deploy", message: `Current allowance: ${ethers.formatUnits(aaveAllowance, 6)} USDC` });
      logs.push({ step: "deploy", message: `Required amount: ${ethers.formatUnits(depositAmount, 6)} USDC` });
      
      const gasOptions = {
        gasLimit: 100000,
        maxFeePerGas: ethers.parseUnits("3", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("1.5", "gwei"),
      };
      
      if (aaveAllowance > BigInt(0)) {
        logs.push({ step: "deploy", message: "Resetting existing allowance to 0..." });
        const resetTx = await (usdcContract.connect(baseSigner) as any).approve(yieldControllerAddress, BigInt(0), gasOptions);
        await resetTx.wait();
        logs.push({ step: "deploy", message: "✅ Reset complete" });
        await sleep(3000);
      }

      logs.push({ step: "deploy", message: "Setting new allowance..." });
      const approveTx = await (usdcContract.connect(baseSigner) as any).approve(yieldControllerAddress, depositAmount, gasOptions);
      await approveTx.wait();
      logs.push({ step: "deploy", message: "✅ Approval confirmed" });
      await sleep(3000);
    } else {
      logs.push({ step: "deploy", message: `✅ Already approved (allowance: ${ethers.formatUnits(aaveAllowance, 6)} USDC)` });
    }

    // Deploy to Aave - matches test_system.js lines 1373-1379
    logs.push({ step: "deploy", message: `Deploying ${ethers.formatUnits(depositAmount, 6)} USDC to Aave V3...` });
    const deployTx = await yieldController.deployToAave(marketIdBytes32, depositAmount, {
      gasLimit: 500000,
      maxFeePerGas: ethers.parseUnits("3", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("1.5", "gwei"),
    });
    
    const deployReceipt = await deployTx.wait();
    const deployExplorerUrl = `https://sepolia.basescan.org/tx/${deployTx.hash}`;

    // Parse positionId only from logs emitted by the YieldController - matches test_system.js lines 1381-1406
    const yieldControllerInterface = new ethers.Interface([
      "event FundsDeployedToAave(bytes32 indexed positionId, bytes32 arcMarketId, uint256 amount)",
    ]);
    
    let positionId: string | null = null;
    for (const log of deployReceipt.logs) {
      if (log.address && log.address.toLowerCase() !== yieldControllerAddress.toLowerCase()) continue;
      try {
        const parsed = yieldControllerInterface.parseLog(log);
        if (parsed && parsed.name === "FundsDeployedToAave") {
          positionId = parsed.args.positionId;
          break;
        }
      } catch {}
    }

    if (!positionId) {
      throw new Error(
        "Could not read positionId from YieldController deploy event. " +
        "Ensure deploy receipt contains FundsDeployedToAave from " + yieldControllerAddress
      );
    }

    logs.push({
      step: "deploy",
      message: `✅ Deployed to Aave V3`,
      explorerUrl: deployExplorerUrl,
      txHash: deployTx.hash,
    });
    logs.push({ step: "deploy", message: `Position ID: ${positionId}` });
    logs.push({ step: "deploy", message: `Amount: ${ethers.formatUnits(depositAmount, 6)} USDC` });
    logs.push({ step: "deploy", message: `Status: Earning yield on Base Sepolia` });

    return NextResponse.json({
      success: true,
      positionId,
      logs,
      transactions: {
        withdraw: { hash: withdrawTx.hash, explorerUrl: withdrawExplorerUrl },
        bridge: result.steps?.map((s: any) => ({ name: s.name, explorerUrl: s.data?.explorerUrl })) || [],
        bridgeRecord: { hash: bridgeRecordTx.hash, explorerUrl: `https://testnet.arcscan.app/tx/${bridgeRecordTx.hash}` },
        swap: { hash: swapTx.hash, explorerUrl: swapExplorerUrl },
        deploy: { hash: deployTx.hash, explorerUrl: deployExplorerUrl },
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        success: false,
        error: e?.message || "Bridge/yield deployment failed",
        logs,
      },
      { status: 500 }
    );
  }
}
