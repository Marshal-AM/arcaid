const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying NGORegistry to Arc Testnet...\n");

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
    console.log("📦 Deploying NGORegistry...");
    const NGORegistry = await hre.ethers.getContractFactory("NGORegistry");
    const ngoRegistry = await NGORegistry.deploy();
    
    console.log("⏳ Waiting for deployment confirmation...");
    await ngoRegistry.waitForDeployment();
    
    const ngoRegistryAddress = await ngoRegistry.getAddress();
    const txHash = ngoRegistry.deploymentTransaction()?.hash;

    console.log("\n✅ NGORegistry deployed successfully!");
    console.log("=" .repeat(60));
    console.log("Contract Address:", ngoRegistryAddress);
    console.log("Transaction Hash:", txHash);
    console.log("=" .repeat(60));

    // Save to file
    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    let addresses = {};
    if (fs.existsSync(addressesPath)) {
      addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    }
    addresses.ngoRegistry = ngoRegistryAddress;
    addresses.network = "arcTestnet";
    addresses.deployer = deployer.address;
    fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
    
    console.log("\n💾 Address saved to:", addressesPath);
    console.log("\n💡 Update your .env file:");
    console.log(`   ARC_NGO_REGISTRY=${ngoRegistryAddress}`);
    console.log("\n💡 Next step:");
    console.log("   Update ProtocolRegistry with this address:");
    console.log(`   npx hardhat run scripts/update-registry.js --network arcTestnet`);
    console.log(`   Or call setNGORegistry(${ngoRegistryAddress}) on ProtocolRegistry`);

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
