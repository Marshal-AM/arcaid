const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying OutcomeOracle to Arc Testnet...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    console.log("⚠️  WARNING: Account has no balance!");
    console.log("   Please fund your account with Arc testnet ETH.\n");
    process.exit(1);
  }

  // Get AI submitter address from environment or use deployer
  const aiSubmitter = process.env.AI_SUBMITTER_ADDRESS || deployer.address;
  
  console.log("🤖 AI Submitter Address:", aiSubmitter);
  console.log("   (This address will be authorized to submit market outcomes)\n");

  try {
    console.log("📦 Deploying OutcomeOracle...");
    const OutcomeOracle = await hre.ethers.getContractFactory("OutcomeOracle");
    const outcomeOracle = await OutcomeOracle.deploy(aiSubmitter);
    
    console.log("⏳ Waiting for deployment confirmation...");
    await outcomeOracle.waitForDeployment();
    
    const outcomeOracleAddress = await outcomeOracle.getAddress();
    const txHash = outcomeOracle.deploymentTransaction()?.hash;

    console.log("\n✅ OutcomeOracle deployed successfully!");
    console.log("=" .repeat(60));
    console.log("Contract Address:", outcomeOracleAddress);
    console.log("AI Submitter:", aiSubmitter);
    console.log("Transaction Hash:", txHash);
    console.log("=" .repeat(60));

    // Save to file
    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    let addresses = {};
    if (fs.existsSync(addressesPath)) {
      addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    }
    addresses.outcomeOracle = outcomeOracleAddress;
    addresses.aiSubmitter = aiSubmitter;
    fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
    
    console.log("\n💾 Address saved to:", addressesPath);
    console.log("\n💡 Update your .env file:");
    console.log(`   ARC_OUTCOME_ORACLE=${outcomeOracleAddress}`);
    console.log(`   AI_SUBMITTER_ADDRESS=${aiSubmitter}`);
    console.log("\n📋 Next steps:");
    console.log("   1. Update ProtocolRegistry with OutcomeOracle address:");
    console.log(`      setOutcomeOracle(${outcomeOracleAddress})`);
    console.log("\n   Note: The AI submitter can be changed later using:");
    console.log(`      updateAISubmitter(NEW_ADDRESS)`);

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
