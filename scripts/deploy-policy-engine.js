const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying PolicyEngine to Arc Testnet...\n");

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
    console.log("📦 Deploying PolicyEngine...");
    const PolicyEngine = await hre.ethers.getContractFactory("PolicyEngine");
    const policyEngine = await PolicyEngine.deploy();
    
    console.log("⏳ Waiting for deployment confirmation...");
    await policyEngine.waitForDeployment();
    
    const policyEngineAddress = await policyEngine.getAddress();
    const txHash = policyEngine.deploymentTransaction()?.hash;

    console.log("\n✅ PolicyEngine deployed successfully!");
    console.log("=" .repeat(60));
    console.log("Contract Address:", policyEngineAddress);
    console.log("Transaction Hash:", txHash);
    console.log("=" .repeat(60));

    // Save to file
    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    let addresses = {};
    if (fs.existsSync(addressesPath)) {
      addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    }
    addresses.policyEngine = policyEngineAddress;
    fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
    
    console.log("\n💾 Address saved to:", addressesPath);
    console.log("\n💡 Update your .env file:");
    console.log(`   ARC_POLICY_ENGINE=${policyEngineAddress}`);
    console.log("\n📋 Next steps:");
    console.log("   1. Update ProtocolRegistry with PolicyEngine address:");
    console.log(`      setPolicyEngine(${policyEngineAddress})`);

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
