const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying TreasuryVault to Arc Testnet...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  if (balance === 0n) {
    console.log("⚠️  WARNING: Account has no balance!");
    console.log("   Please fund your account with Arc testnet ETH.\n");
    process.exit(1);
  }

  // Get USDC address from environment
  const usdcAddress = process.env.ARC_USDC_ADDRESS;
  
  if (!usdcAddress || usdcAddress === "0x0000000000000000000000000000000000000000") {
    console.log("❌ ERROR: USDC token address not set!");
    console.log("\nPlease set ARC_USDC_ADDRESS in your .env file.");
    console.log("Example:");
    console.log("   ARC_USDC_ADDRESS=0x...");
    console.log("\nYou need to deploy or get the USDC token address on Arc testnet first.");
    process.exit(1);
  }

  // Validate address format
  if (!hre.ethers.isAddress(usdcAddress)) {
    console.log("❌ ERROR: Invalid USDC address format!");
    console.log("   Provided:", usdcAddress);
    process.exit(1);
  }

  console.log("💵 USDC Token Address:", usdcAddress);
  console.log("   (This will be used as the treasury token)\n");

  try {
    console.log("📦 Deploying TreasuryVault...");
    const TreasuryVault = await hre.ethers.getContractFactory("TreasuryVault");
    const treasuryVault = await TreasuryVault.deploy(usdcAddress);
    
    console.log("⏳ Waiting for deployment confirmation...");
    await treasuryVault.waitForDeployment();
    
    const treasuryVaultAddress = await treasuryVault.getAddress();
    const txHash = treasuryVault.deploymentTransaction()?.hash;

    console.log("\n✅ TreasuryVault deployed successfully!");
    console.log("=" .repeat(60));
    console.log("Contract Address:", treasuryVaultAddress);
    console.log("USDC Token:", usdcAddress);
    console.log("Transaction Hash:", txHash);
    console.log("=" .repeat(60));

    // Save to file
    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    let addresses = {};
    if (fs.existsSync(addressesPath)) {
      addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    }
    addresses.treasuryVault = treasuryVaultAddress;
    addresses.usdcToken = usdcAddress;
    fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
    
    console.log("\n💾 Address saved to:", addressesPath);
    console.log("\n💡 Update your .env file:");
    console.log(`   ARC_TREASURY_VAULT=${treasuryVaultAddress}`);
    console.log("\n📋 Next steps:");
    console.log("   1. Update ProtocolRegistry with TreasuryVault address:");
    console.log(`      setTreasuryVault(${treasuryVaultAddress})`);
    console.log("\n   2. After deploying MarketFactory and BridgeManager:");
    console.log("      - Call setMarketFactory(MARKET_FACTORY_ADDRESS)");
    console.log("      - Call setBridgeManager(BRIDGE_MANAGER_ADDRESS)");

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
