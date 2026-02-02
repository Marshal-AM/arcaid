const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting deployment to Arc Testnet...\n");

  // Get the deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying contracts with account:", deployer.address);
  
  // Check balance
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    console.log("⚠️  WARNING: Account has no balance! Please fund your account with Arc testnet ETH.");
    console.log("   Get testnet ETH from Arc faucet.\n");
  }

  const deployedAddresses = {};

  try {
    // Deploy ProtocolRegistry
    console.log("📦 Deploying ProtocolRegistry...");
    const ProtocolRegistry = await hre.ethers.getContractFactory("ProtocolRegistry");
    const protocolRegistry = await ProtocolRegistry.deploy();
    await protocolRegistry.waitForDeployment();
    const protocolRegistryAddress = await protocolRegistry.getAddress();
    deployedAddresses.protocolRegistry = protocolRegistryAddress;
    console.log("✅ ProtocolRegistry deployed to:", protocolRegistryAddress);
    console.log("   Transaction hash:", protocolRegistry.deploymentTransaction()?.hash, "\n");

    // Save addresses to a JSON file
    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    fs.writeFileSync(
      addressesPath,
      JSON.stringify(deployedAddresses, null, 2)
    );
    console.log("💾 Deployed addresses saved to:", addressesPath);
    console.log("\n📋 Deployment Summary:");
    console.log("=" .repeat(60));
    console.log("ProtocolRegistry:", protocolRegistryAddress);
    console.log("=" .repeat(60));
    console.log("\n✨ Deployment complete!");
    console.log("\n💡 Next steps:");
    console.log("   1. Update your .env file with the deployed addresses");
    console.log("   2. Deploy other contracts using: npx hardhat run scripts/deploy-all.js --network arcTestnet");

  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
