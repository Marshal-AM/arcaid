require('dotenv').config();
const { ethers } = require('ethers');

// Addresses
const NONFUNGIBLE_POSITION_MANAGER = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2";
const CIRCLE_USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const AAVE_USDC = "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

const POSITION_MANAGER_ABI = [
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
];

const PERCENTAGE_TO_ADD = 80;

async function main() {
  const PUBLIC_RPC = "https://sepolia.base.org";
  const provider = new ethers.providers.JsonRpcProvider(PUBLIC_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║          Add Liquidity (FIXED TICK SPACING)               ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  
  console.log("Wallet:", wallet.address, "\n");
  
  // Sort tokens
  const [token0, token1] = CIRCLE_USDC.toLowerCase() < AAVE_USDC.toLowerCase() 
    ? [CIRCLE_USDC, AAVE_USDC] 
    : [AAVE_USDC, CIRCLE_USDC];
  
  const token0Contract = new ethers.Contract(token0, ERC20_ABI, wallet);
  const token1Contract = new ethers.Contract(token1, ERC20_ABI, wallet);
  const positionManager = new ethers.Contract(NONFUNGIBLE_POSITION_MANAGER, POSITION_MANAGER_ABI, wallet);
  
  const symbol0 = await token0Contract.symbol();
  const symbol1 = await token1Contract.symbol();
  const decimals0 = await token0Contract.decimals();
  const decimals1 = await token1Contract.decimals();
  
  console.log(`Token0: ${symbol0} - ${token0}`);
  console.log(`Token1: ${symbol1} - ${token1}\n`);
  
  // Get balances
  const balance0 = await token0Contract.balanceOf(wallet.address);
  const balance1 = await token1Contract.balanceOf(wallet.address);
  
  console.log("═══════════════════════════════════════════════════════════");
  console.log("CURRENT BALANCES:");
  console.log(`${symbol0}:`, ethers.utils.formatUnits(balance0, decimals0));
  console.log(`${symbol1}:`, ethers.utils.formatUnits(balance1, decimals1));
  console.log("═══════════════════════════════════════════════════════════\n");
  
  // Calculate 80%
  const amount0 = balance0.mul(PERCENTAGE_TO_ADD).div(100);
  const amount1 = balance1.mul(PERCENTAGE_TO_ADD).div(100);
  
  console.log(`ADDING ${PERCENTAGE_TO_ADD}%:`);
  console.log(`${symbol0}:`, ethers.utils.formatUnits(amount0, decimals0));
  console.log(`${symbol1}:`, ethers.utils.formatUnits(amount1, decimals1), "\n");
  
  // Check minimum
  const minAmount = ethers.utils.parseUnits("0.01", 6);
  if (amount0.lt(minAmount) || amount1.lt(minAmount)) {
    console.error("❌ Amounts too small!");
    process.exit(1);
  }
  
  // Check/Approve
  const allowance0 = await token0Contract.allowance(wallet.address, NONFUNGIBLE_POSITION_MANAGER);
  const allowance1 = await token1Contract.allowance(wallet.address, NONFUNGIBLE_POSITION_MANAGER);
  
  if (allowance0.lt(amount0)) {
    console.log(`🔐 Approving ${symbol0}...`);
    const tx = await token0Contract.approve(NONFUNGIBLE_POSITION_MANAGER, ethers.constants.MaxUint256);
    await tx.wait();
    console.log("✅ Approved");
    await new Promise(r => setTimeout(r, 5000));
  } else {
    console.log(`✅ ${symbol0} already approved`);
  }
  
  if (allowance1.lt(amount1)) {
    console.log(`🔐 Approving ${symbol1}...`);
    const tx = await token1Contract.approve(NONFUNGIBLE_POSITION_MANAGER, ethers.constants.MaxUint256);
    await tx.wait();
    console.log("✅ Approved");
    await new Promise(r => setTimeout(r, 5000));
  } else {
    console.log(`✅ ${symbol1} already approved`);
  }
  
  console.log();
  
  // CRITICAL FIX: For fee tier 500 (0.05%), tick spacing is 10
  // Ticks MUST be divisible by 10!
  // Full range for this fee tier: -887270 to 887270 (not -887272!)
  const tickLower = -887270;  // Divisible by 10 ✓
  const tickUpper = 887270;   // Divisible by 10 ✓
  
  console.log("═══════════════════════════════════════════════════════════");
  console.log("POSITION PARAMETERS:");
  console.log(`Fee tier: 0.05% (500)`);
  console.log(`Tick spacing: 10 (required for this fee tier)`);
  console.log(`Tick range: ${tickLower} to ${tickUpper}`);
  console.log(`Price range: Full range (all prices)`);
  console.log("═══════════════════════════════════════════════════════════\n");
  
  const mintParams = {
    token0: token0,
    token1: token1,
    fee: 500,
    tickLower: tickLower,
    tickUpper: tickUpper,
    amount0Desired: amount0,
    amount1Desired: amount1,
    amount0Min: 0, // Testnet - no slippage protection
    amount1Min: 0, // Testnet - no slippage protection
    recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 60 * 20
  };
  
  console.log("💧 ADDING LIQUIDITY...");
  
  try {
    const tx = await positionManager.mint(mintParams, {
      gasLimit: 5000000,
      maxFeePerGas: ethers.utils.parseUnits("3", "gwei"),
      maxPriorityFeePerGas: ethers.utils.parseUnits("1.5", "gwei")
    });
    
    console.log("📤 Transaction:", tx.hash);
    console.log("Waiting for confirmation (30-60 seconds)...\n");
    
    const receipt = await tx.wait();
    
    console.log("═══════════════════════════════════════════════════════════");
    console.log("                    ✅ SUCCESS!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("Gas used:", receipt.gasUsed.toString());
    console.log("Block:", receipt.blockNumber);
    
    // Find position NFT
    for (const log of receipt.logs) {
      try {
        if (log.address.toLowerCase() === NONFUNGIBLE_POSITION_MANAGER.toLowerCase()) {
          const transferEvent = new ethers.utils.Interface([
            "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
          ]).parseLog(log);
          
          if (transferEvent && transferEvent.args.to.toLowerCase() === wallet.address.toLowerCase()) {
            console.log("Position NFT ID:", transferEvent.args.tokenId.toString());
          }
        }
      } catch (e) {}
    }
    
    const finalBalance0 = await token0Contract.balanceOf(wallet.address);
    const finalBalance1 = await token1Contract.balanceOf(wallet.address);
    
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("FINAL BALANCES:");
    console.log(`${symbol0}:`, ethers.utils.formatUnits(finalBalance0, decimals0));
    console.log(`${symbol1}:`, ethers.utils.formatUnits(finalBalance1, decimals1));
    console.log("═══════════════════════════════════════════════════════════");
    
    console.log("\n🎉 LIQUIDITY POOL ACTIVE!");
    console.log(`   • Added ${PERCENTAGE_TO_ADD}% of your tokens`);
    console.log(`   • Kept ${100-PERCENTAGE_TO_ADD}% in wallet`);
    console.log(`   • You can now swap on Uniswap!`);
    console.log(`   • You'll earn 0.05% fees on all swaps\n`);
    
  } catch (error) {
    console.error("\n═══════════════════════════════════════════════════════════");
    console.error("❌ ERROR");
    console.error("═══════════════════════════════════════════════════════════");
    console.error(error.message);
    
    if (error.message.includes("TLU")) {
      console.error("\n💡 Tick Lower Used - ticks must be divisible by tick spacing");
    }
    if (error.message.includes("TUM")) {
      console.error("\n💡 Tick Upper Misaligned - ticks must be divisible by tick spacing");
    }
    if (error.message.includes("SPL")) {
      console.error("\n💡 Slippage protection - price moved too much");
    }
    
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });