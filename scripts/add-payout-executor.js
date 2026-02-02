const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔧 Adding PayoutExecutor to ProtocolRegistry...\n");

  // Read deployed addresses
  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.log("❌ ERROR: deployed-addresses.json not found!");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  
  if (!addresses.payoutExecutor) {
    console.log("❌ ERROR: payoutExecutor not found in deployed-addresses.json!");
    process.exit(1);
  }

  if (!addresses.protocolRegistry) {
    console.log("❌ ERROR: protocolRegistry not found in deployed-addresses.json!");
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Configuring with account:", deployer.address);
  console.log("🌐 Network: Arc Testnet\n");

  try {
    const ProtocolRegistry = await hre.ethers.getContractAt(
      "ProtocolRegistry",
      addresses.protocolRegistry
    );

    console.log("📝 Setting PayoutExecutor...");
    console.log(`   Address: ${addresses.payoutExecutor}\n`);

    const tx = await ProtocolRegistry.setPayoutExecutor(addresses.payoutExecutor);
    console.log(`   ⏳ Transaction sent: ${tx.hash}`);
    await tx.wait();
    console.log(`   ✅ PayoutExecutor configured successfully\n`);

    // Verify
    const configuredAddress = await ProtocolRegistry.payoutExecutor();
    console.log("🔍 Verification:");
    console.log(`   Configured: ${configuredAddress}`);
    console.log(`   Expected: ${addresses.payoutExecutor}`);
    
    if (configuredAddress.toLowerCase() === addresses.payoutExecutor.toLowerCase()) {
      console.log("   ✅ Address matches!\n");
    } else {
      console.log("   ⚠️  Address mismatch!\n");
    }

  } catch (error) {
    console.error("\n❌ Configuration failed!");
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
