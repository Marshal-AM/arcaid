const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying ProtocolRegistry to Arc Testnet...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    console.log("⚠️  WARNING: Account has no balance!");
    console.log("   Please fund your account with Arc testnet ETH.\n");
    process.exit(1);
  }

  try {
    console.log("📦 Deploying ProtocolRegistry...");
    const ProtocolRegistry = await hre.ethers.getContractFactory("ProtocolRegistry");
    const protocolRegistry = await ProtocolRegistry.deploy();
    
    console.log("⏳ Waiting for deployment confirmation...");
    await protocolRegistry.waitForDeployment();
    
    const protocolRegistryAddress = await protocolRegistry.getAddress();
    const txHash = protocolRegistry.deploymentTransaction()?.hash;

    console.log("\n✅ ProtocolRegistry deployed successfully!");
    console.log("=" .repeat(60));
    console.log("Contract Address:", protocolRegistryAddress);
    console.log("Transaction Hash:", txHash);
    console.log("=" .repeat(60));

    // Save to file
    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    let addresses = {};
    if (fs.existsSync(addressesPath)) {
      addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    }
    addresses.protocolRegistry = protocolRegistryAddress;
    addresses.network = "arcTestnet";
    addresses.deployer = deployer.address;
    fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
    
    console.log("\n💾 Address saved to:", addressesPath);
    console.log("\n💡 Update your .env file:");
    console.log(`   ARC_PROTOCOL_REGISTRY=${protocolRegistryAddress}`);

  } catch (error) {
    console.error("\n❌ Deployment failed!");
    console.error("Error:", error.message);
    if (error.transaction) {
      console.error("Transaction:", error.transaction);
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
