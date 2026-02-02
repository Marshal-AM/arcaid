const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔧 Configuring all deployed contracts...\n");

  // Read deployed addresses
  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.log("❌ ERROR: deployed-addresses.json not found!");
    console.log("   Please deploy contracts first.");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  
  // Validate all required addresses exist
  const required = [
    "protocolRegistry",
    "ngoRegistry",
    "policyEngine",
    "outcomeOracle",
    "treasuryVault",
    "bridgeManager",
    "marketFactory",
    "usdcToken",
    "ethereumYieldController"
  ];

  const missing = required.filter(addr => !addresses[addr]);
  if (missing.length > 0) {
    console.log("❌ ERROR: Missing required addresses:");
    missing.forEach(addr => console.log(`   - ${addr}`));
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Configuring with account:", deployer.address);
  console.log("🌐 Network: Arc Testnet\n");

  try {
    // Get contract instances
    const ProtocolRegistry = await hre.ethers.getContractAt(
      "ProtocolRegistry",
      addresses.protocolRegistry
    );

    const TreasuryVault = await hre.ethers.getContractAt(
      "TreasuryVault",
      addresses.treasuryVault
    );

    console.log("=" .repeat(60));
    console.log("STEP 1: Configuring ProtocolRegistry");
    console.log("=" .repeat(60));

    // Configure ProtocolRegistry
    const protocolCalls = [
      { name: "USDC Token", func: ProtocolRegistry.setUSDCToken, address: addresses.usdcToken },
      { name: "Outcome Oracle", func: ProtocolRegistry.setOutcomeOracle, address: addresses.outcomeOracle },
      { name: "Market Factory", func: ProtocolRegistry.setMarketFactory, address: addresses.marketFactory },
      { name: "Policy Engine", func: ProtocolRegistry.setPolicyEngine, address: addresses.policyEngine },
      { name: "NGO Registry", func: ProtocolRegistry.setNGORegistry, address: addresses.ngoRegistry },
      { name: "Bridge Manager", func: ProtocolRegistry.setBridgeManager, address: addresses.bridgeManager },
      { name: "Treasury Vault", func: ProtocolRegistry.setTreasuryVault, address: addresses.treasuryVault },
    ];

    // Add payoutExecutor if it exists
    if (addresses.payoutExecutor) {
      protocolCalls.push({
        name: "Payout Executor",
        func: ProtocolRegistry.setPayoutExecutor,
        address: addresses.payoutExecutor
      });
    }

    for (const call of protocolCalls) {
      try {
        console.log(`\n📝 Setting ${call.name}...`);
        const tx = await call.func(call.address);
        console.log(`   ⏳ Transaction sent: ${tx.hash}`);
        await tx.wait();
        console.log(`   ✅ ${call.name} configured successfully`);
      } catch (error) {
        console.error(`   ❌ Failed to set ${call.name}:`, error.message);
        // Check if it's already set
        if (error.message.includes("revert") || error.message.includes("execution reverted")) {
          console.log(`   ⚠️  ${call.name} may already be configured, skipping...`);
        } else {
          throw error;
        }
      }
    }

    // Set Ethereum/Base Sepolia config (YieldController on Base Sepolia; Ethereum Sepolia USDC supply cap reached)
    console.log(`\n📝 Setting Ethereum/Base Sepolia Config...`);
    try {
      const ethereumChainId = addresses.ethereumChainId ?? 84532; // Base Sepolia
      const tx = await ProtocolRegistry.setEthereumConfig(
        ethereumChainId,
        addresses.ethereumYieldController
      );
      console.log(`   ⏳ Transaction sent: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Config set (Chain ID: ${ethereumChainId}, YieldController on Base Sepolia)`);
    } catch (error) {
      console.error(`   ❌ Failed to set Ethereum config:`, error.message);
      if (!error.message.includes("revert")) {
        throw error;
      }
    }

    console.log("\n" + "=" .repeat(60));
    console.log("STEP 2: Configuring TreasuryVault");
    console.log("=" .repeat(60));

    // Configure TreasuryVault
    const treasuryCalls = [
      { name: "Market Factory", func: TreasuryVault.setMarketFactory, address: addresses.marketFactory },
      { name: "Bridge Manager", func: TreasuryVault.setBridgeManager, address: addresses.bridgeManager },
    ];

    for (const call of treasuryCalls) {
      try {
        console.log(`\n📝 Setting ${call.name}...`);
        const tx = await call.func(call.address);
        console.log(`   ⏳ Transaction sent: ${tx.hash}`);
        await tx.wait();
        console.log(`   ✅ ${call.name} configured successfully`);
      } catch (error) {
        console.error(`   ❌ Failed to set ${call.name}:`, error.message);
        if (error.message.includes("revert") || error.message.includes("execution reverted")) {
          console.log(`   ⚠️  ${call.name} may already be configured, skipping...`);
        } else {
          throw error;
        }
      }
    }

    console.log("\n" + "=" .repeat(60));
    console.log("✅ CONFIGURATION COMPLETE!");
    console.log("=" .repeat(60));

    // Verify configuration
    console.log("\n🔍 Verifying configuration...\n");

    const usdcToken = await ProtocolRegistry.usdcToken();
    const outcomeOracle = await ProtocolRegistry.outcomeOracle();
    const marketFactory = await ProtocolRegistry.marketFactory();
    const policyEngine = await ProtocolRegistry.policyEngine();
    const ngoRegistry = await ProtocolRegistry.ngoRegistry();
    const bridgeManager = await ProtocolRegistry.bridgeManager();
    const treasuryVault = await ProtocolRegistry.treasuryVault();
    const ethChainId = await ProtocolRegistry.ethereumChainId();
    const ethYieldController = await ProtocolRegistry.ethereumYieldController();

    const treasuryMarketFactory = await TreasuryVault.marketFactory();
    const treasuryBridgeManager = await TreasuryVault.bridgeManager();

    console.log("ProtocolRegistry Configuration:");
    console.log(`  ✅ USDC Token: ${usdcToken}`);
    console.log(`  ✅ Outcome Oracle: ${outcomeOracle}`);
    console.log(`  ✅ Market Factory: ${marketFactory}`);
    console.log(`  ✅ Policy Engine: ${policyEngine}`);
    console.log(`  ✅ NGO Registry: ${ngoRegistry}`);
    console.log(`  ✅ Bridge Manager: ${bridgeManager}`);
    console.log(`  ✅ Treasury Vault: ${treasuryVault}`);
    if (addresses.payoutExecutor) {
      const payoutExecutor = await ProtocolRegistry.payoutExecutor();
      console.log(`  ✅ Payout Executor: ${payoutExecutor}`);
    }
    console.log(`  ✅ Ethereum Chain ID: ${ethChainId}`);
    console.log(`  ✅ Ethereum Yield Controller: ${ethYieldController}`);

    console.log("\nTreasuryVault Configuration:");
    console.log(`  ✅ Market Factory: ${treasuryMarketFactory}`);
    console.log(`  ✅ Bridge Manager: ${treasuryBridgeManager}`);

    console.log("\n✨ All contracts are now fully configured!");
    console.log("\n📋 Next steps:");
    console.log("   1. Test creating a market using MarketFactory");
    console.log("   2. Register NGOs using NGORegistry");
    console.log("   3. Test the full system flow");

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
