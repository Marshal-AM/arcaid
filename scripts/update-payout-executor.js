require('dotenv').config();
const hre = require("hardhat");

async function main() {
  console.log("🔄 Updating ProtocolRegistry with new PayoutExecutor...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Using account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  const protocolRegistryAddress = process.env.ARC_PROTOCOL_REGISTRY;
  const newPayoutExecutorAddress = process.env.ARC_PAYOUT_EXECUTOR;

  console.log("📍 ProtocolRegistry:", protocolRegistryAddress);
  console.log("📍 New PayoutExecutor:", newPayoutExecutorAddress);
  console.log("");

  try {
    const ProtocolRegistry = await hre.ethers.getContractFactory("ProtocolRegistry");
    const protocolRegistry = ProtocolRegistry.attach(protocolRegistryAddress);

    console.log("⚙️  Setting PayoutExecutor in ProtocolRegistry...");
    const tx = await protocolRegistry.setPayoutExecutor(newPayoutExecutorAddress);
    
    console.log("⏳ Waiting for confirmation...");
    console.log("   Transaction hash:", tx.hash);
    await tx.wait();

    console.log("\n✅ PayoutExecutor updated successfully!");
    console.log("=" .repeat(60));
    
    // Verify
    const currentPayoutExecutor = await protocolRegistry.payoutExecutor();
    console.log("Current PayoutExecutor:", currentPayoutExecutor);
    console.log("=" .repeat(60));

  } catch (error) {
    console.error("\n❌ Update failed!");
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
