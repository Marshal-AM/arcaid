require('dotenv').config();
const { ethers } = require('ethers');

// Contract addresses on Base Sepolia
const UNISWAP_V3_FACTORY = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";
const NONFUNGIBLE_POSITION_MANAGER = "0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2";

// YOUR TOKEN ADDRESSES - REPLACE THESE WITH YOUR ACTUAL ADDRESSES
const CIRCLE_USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const AAVE_USDC = "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f";

// Pool parameters
const FEE_TIER = 500; // 0.05% fee tier (good for stablecoin pairs)

// ABIs
const FACTORY_ABI = [
  "function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool)",
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address)"
];

const POOL_ABI = [
  "function initialize(uint160 sqrtPriceX96) external"
];

const POSITION_MANAGER_ABI = [
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)"
];

async function main() {
  // Setup provider and signer
  const provider = new ethers.providers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log("Using wallet:", wallet.address);
  const balance = await wallet.getBalance();
  console.log("ETH Balance:", ethers.utils.formatEther(balance), "ETH\n");
  
  // Connect to contracts
  const factory = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, wallet);
  const positionManager = new ethers.Contract(NONFUNGIBLE_POSITION_MANAGER, POSITION_MANAGER_ABI, wallet);
  
  // Sort tokens (Uniswap requires token0 < token1)
  const [token0, token1] = CIRCLE_USDC.toLowerCase() < AAVE_USDC.toLowerCase() 
    ? [CIRCLE_USDC, AAVE_USDC] 
    : [AAVE_USDC, CIRCLE_USDC];
  
  console.log("Token0:", token0);
  console.log("Token1:", token1);
  console.log("Fee Tier:", FEE_TIER, "(0.05%)\n");
  
  // Check if pool already exists
  const existingPool = await factory.getPool(token0, token1, FEE_TIER);
  console.log("Checking for existing pool...");
  console.log("Pool address:", existingPool);
  
  if (existingPool === ethers.constants.AddressZero) {
    console.log("\n=== Pool does not exist. Creating new pool ===\n");
    
    // Calculate sqrtPriceX96 for 1:1 price ratio
    // For USDC pairs, we want 1:1 ratio
    // sqrtPriceX96 = sqrt(price) * 2^96
    // For 1:1 ratio: sqrt(1) * 2^96 = 2^96
    const sqrtPriceX96 = ethers.BigNumber.from("79228162514264337593543950336");
    
    console.log("Creating and initializing pool with 1:1 price ratio...");
    console.log("sqrtPriceX96:", sqrtPriceX96.toString());
    
    try {
      const tx = await positionManager.createAndInitializePoolIfNecessary(
        token0,
        token1,
        FEE_TIER,
        sqrtPriceX96,
        { gasLimit: 5000000 }
      );
      
      console.log("\nTransaction submitted!");
      console.log("Transaction hash:", tx.hash);
      console.log("Waiting for confirmation...\n");
      
      const receipt = await tx.wait();
      console.log("✅ Pool created successfully!");
      console.log("Gas used:", receipt.gasUsed.toString());
      console.log("Block number:", receipt.blockNumber);
      
      const poolAddress = await factory.getPool(token0, token1, FEE_TIER);
      console.log("\n=== Pool Details ===");
      console.log("Pool address:", poolAddress);
      console.log("Token0:", token0);
      console.log("Token1:", token1);
      console.log("Fee:", FEE_TIER);
      
    } catch (error) {
      console.error("\n❌ Error creating pool:");
      console.error(error.message);
      throw error;
    }
  } else {
    console.log("\n✅ Pool already exists!");
    console.log("Pool address:", existingPool);
    console.log("\nYou can proceed to add liquidity using addLiquidity.js");
  }
  
  console.log("\n=== Next Steps ===");
  console.log("1. Make sure you have both USDC tokens in your wallet");
  console.log("2. Run addLiquidity.js to add liquidity to the pool");
  console.log("3. Once liquidity is added, you can swap between the tokens");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
