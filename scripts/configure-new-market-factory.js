require('dotenv').config();
const hre = require("hardhat");

async function main() {
  console.log("🔧 Configuring New MarketFactory in System...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Using account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  const protocolRegistryAddress = process.env.ARC_PROTOCOL_REGISTRY;
  const treasuryVaultAddress = process.env.ARC_TREASURY_VAULT;
  const newMarketFactoryAddress = process.env.ARC_MARKET_FACTORY;

  console.log("📍 ProtocolRegistry:", protocolRegistryAddress);
  console.log("📍 TreasuryVault:", treasuryVaultAddress);
  console.log("📍 New MarketFactory:", newMarketFactoryAddress);
  console.log("");

  try {
    // ========================================================================
    // Step 1: Update TreasuryVault
    // ========================================================================
    console.log("=" .repeat(80));
    console.log("STEP 1: Update TreasuryVault");
    console.log("=" .repeat(80));
    
    const TreasuryVault = await hre.ethers.getContractFactory("TreasuryVault");
    const treasuryVault = TreasuryVault.attach(treasuryVaultAddress);

    console.log("⚙️  Setting MarketFactory in TreasuryVault...");
    const tx1 = await treasuryVault.setMarketFactory(newMarketFactoryAddress);
    
    console.log("⏳ Waiting for confirmation...");
    console.log("   Transaction hash:", tx1.hash);
    await tx1.wait();

    console.log("✅ TreasuryVault updated!\n");

    // ========================================================================
    // Step 2: Update ProtocolRegistry
    // ========================================================================
    console.log("=" .repeat(80));
    console.log("STEP 2: Update ProtocolRegistry");
    console.log("=" .repeat(80));
    
    const ProtocolRegistry = await hre.ethers.getContractFactory("ProtocolRegistry");
    const protocolRegistry = ProtocolRegistry.attach(protocolRegistryAddress);

    console.log("⚙️  Setting MarketFactory in ProtocolRegistry...");
    const tx2 = await protocolRegistry.setMarketFactory(newMarketFactoryAddress);
    
    console.log("⏳ Waiting for confirmation...");
    console.log("   Transaction hash:", tx2.hash);
    await tx2.wait();

    console.log("✅ ProtocolRegistry updated!\n");

    // ========================================================================
    // Verification
    // ========================================================================
    console.log("=" .repeat(80));
    console.log("VERIFICATION");
    console.log("=" .repeat(80));
    
    const vaultMarketFactory = await treasuryVault.marketFactory();
    const registryMarketFactory = await protocolRegistry.marketFactory();
    
    console.log("TreasuryVault.marketFactory:", vaultMarketFactory);
    console.log("ProtocolRegistry.marketFactory:", registryMarketFactory);
    
    if (vaultMarketFactory === newMarketFactoryAddress && 
        registryMarketFactory === newMarketFactoryAddress) {
      console.log("\n✅ ALL CONFIGURATIONS SUCCESSFUL!");
      console.log("=" .repeat(80));
      console.log("\n🎉 The system is now using the updated MarketFactory!");
      console.log("   New markets will include the loser refund mechanism.\n");
    } else {
      console.log("\n⚠️  Warning: Addresses don't match expected values");
    }

  } catch (error) {
    console.error("\n❌ Configuration failed!");
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
