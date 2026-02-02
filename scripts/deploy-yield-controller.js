const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying EthereumYieldController to Base Sepolia...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);

  try {
    const network = await hre.ethers.provider.getNetwork();
    console.log("🌐 Connected to network:", network.name, "(Chain ID:", network.chainId.toString() + ")");
  } catch (error) {
    console.log("❌ ERROR: Cannot connect to RPC endpoint!");
    console.log("   Current RPC:", process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");
    process.exit(1);
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    console.log("⚠️  WARNING: Account has no balance!");
    console.log("   Please fund your account with Base Sepolia ETH.\n");
    process.exit(1);
  }

  console.log("📋 Contract Details:");
  console.log("   Network: Base Sepolia (Aave; Ethereum Sepolia USDC supply cap reached)");
  console.log("   Chain ID: 84532");
  console.log("   Aave Pool: 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27");
  console.log("   USDC (Aave reserve): 0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f");
  console.log("   aUSDC: 0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC\n");

  try {
    console.log("📦 Deploying EthereumYieldController...");
    const EthereumYieldController = await hre.ethers.getContractFactory("EthereumYieldController");

    console.log("⏳ Sending deployment transaction...");
    const yieldController = await EthereumYieldController.deploy();

    console.log("⏳ Waiting for deployment confirmation...");
    await yieldController.waitForDeployment();

    const yieldControllerAddress = await yieldController.getAddress();
    const txHash = yieldController.deploymentTransaction()?.hash;

    console.log("\n✅ EthereumYieldController deployed successfully!");
    console.log("=".repeat(60));
    console.log("Contract Address:", yieldControllerAddress);
    console.log("Network: Base Sepolia");
    console.log("Transaction Hash:", txHash);
    console.log("=".repeat(60));

    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    let deployedAddresses = {};
    if (fs.existsSync(addressesPath)) {
      deployedAddresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    }
    deployedAddresses.ethereumYieldController = yieldControllerAddress;
    deployedAddresses.ethereumNetwork = "baseSepolia";
    deployedAddresses.ethereumChainId = 84532;
    fs.writeFileSync(addressesPath, JSON.stringify(deployedAddresses, null, 2));

    console.log("\n💾 Address saved to:", addressesPath);
    console.log("\n💡 Update your .env file:");
    console.log(`   ETH_YIELD_CONTROLLER=${yieldControllerAddress}`);
    console.log(`   BASE_SEPOLIA_RPC_URL=${process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"}`);
    console.log("\n📋 Next steps:");
    console.log("   1. Run configure-contracts on Arc to set Base Sepolia config:");
    console.log("      npx hardhat run scripts/configure-contracts.js --network arcTestnet");
    console.log("   2. Test bridge + Aave: npm run test:bridge");
  } catch (error) {
    console.error("\n❌ Deployment failed!");
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
