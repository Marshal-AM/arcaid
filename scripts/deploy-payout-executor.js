const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying PayoutExecutor to Arc Testnet...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    console.log("⚠️  WARNING: Account has no balance!");
    console.log("   Please fund your account with Arc testnet ETH.\n");
    process.exit(1);
  }

  // Hardcoded addresses from deployed-addresses.json
  const policyEngineAddress = "0x14d42947929F1ECf882aA6a07dd4279ADb49345d";
  const ngoRegistryAddress = "0x1E491de1a08843079AAb4cFA516C717597344e50";
  const treasuryVaultAddress = "0x9F0BF4aE6BBfD51eDbff77eA0D17A7bec484bb97";

  // Validate addresses
  if (!hre.ethers.isAddress(policyEngineAddress)) {
    console.log("❌ ERROR: Invalid PolicyEngine address format!");
    console.log("   Provided:", policyEngineAddress);
    process.exit(1);
  }

  if (!hre.ethers.isAddress(ngoRegistryAddress)) {
    console.log("❌ ERROR: Invalid NGORegistry address format!");
    console.log("   Provided:", ngoRegistryAddress);
    process.exit(1);
  }

  if (!hre.ethers.isAddress(treasuryVaultAddress)) {
    console.log("❌ ERROR: Invalid TreasuryVault address format!");
    console.log("   Provided:", treasuryVaultAddress);
    process.exit(1);
  }

  console.log("⚙️  PolicyEngine Address:", policyEngineAddress);
  console.log("🏛️  NGORegistry Address:", ngoRegistryAddress);
  console.log("🏦 Treasury Vault Address:", treasuryVaultAddress);
  console.log("   (Hardcoded from deployed-addresses.json)\n");

  try {
    console.log("📦 Deploying PayoutExecutor...");
    const PayoutExecutor = await hre.ethers.getContractFactory("PayoutExecutor");
    const payoutExecutor = await PayoutExecutor.deploy(policyEngineAddress, ngoRegistryAddress, treasuryVaultAddress);
    
    console.log("⏳ Waiting for deployment confirmation...");
    await payoutExecutor.waitForDeployment();
    
    const payoutExecutorAddress = await payoutExecutor.getAddress();
    const txHash = payoutExecutor.deploymentTransaction()?.hash;

    console.log("\n✅ PayoutExecutor deployed successfully!");
    console.log("=" .repeat(60));
    console.log("Contract Address:", payoutExecutorAddress);
    console.log("PolicyEngine:", policyEngineAddress);
    console.log("NGORegistry:", ngoRegistryAddress);
    console.log("Treasury Vault:", treasuryVaultAddress);
    console.log("Transaction Hash:", txHash);
    console.log("=" .repeat(60));

    // Save to file
    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    let deployedAddresses = {};
    if (fs.existsSync(addressesPath)) {
      deployedAddresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    }
    deployedAddresses.payoutExecutor = payoutExecutorAddress;
    fs.writeFileSync(addressesPath, JSON.stringify(deployedAddresses, null, 2));
    
    console.log("\n💾 Address saved to:", addressesPath);
    console.log("\n💡 Update your .env file:");
    console.log(`   ARC_PAYOUT_EXECUTOR=${payoutExecutorAddress}`);
    console.log("\n📋 Next steps:");
    console.log("   1. Update ProtocolRegistry with PayoutExecutor address:");
    console.log(`      setPayoutExecutor(${payoutExecutorAddress})`);

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
