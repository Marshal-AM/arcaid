const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying MarketFactory to Arc Testnet...\n");

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
  const outcomeOracleAddress = "0xC6Ffc4E56388fFa99EA18503a0Ea518e795ceCC8";
  const treasuryVaultAddress = "0x9F0BF4aE6BBfD51eDbff77eA0D17A7bec484bb97";

  // Get USDC address from env
  const usdcAddress = process.env.ARC_USDC_ADDRESS;
  
  if (!usdcAddress || usdcAddress === "0x0000000000000000000000000000000000000000") {
    console.log("❌ ERROR: USDC token address not set!");
    console.log("\nPlease set ARC_USDC_ADDRESS in your .env file.");
    process.exit(1);
  }

  // Validate addresses
  if (!hre.ethers.isAddress(usdcAddress)) {
    console.log("❌ ERROR: Invalid USDC address format!");
    console.log("   Provided:", usdcAddress);
    process.exit(1);
  }

  if (!hre.ethers.isAddress(outcomeOracleAddress)) {
    console.log("❌ ERROR: Invalid OutcomeOracle address format!");
    console.log("   Provided:", outcomeOracleAddress);
    process.exit(1);
  }

  if (!hre.ethers.isAddress(treasuryVaultAddress)) {
    console.log("❌ ERROR: Invalid TreasuryVault address format!");
    console.log("   Provided:", treasuryVaultAddress);
    process.exit(1);
  }

  console.log("💵 USDC Token Address:", usdcAddress);
  console.log("🔮 OutcomeOracle Address:", outcomeOracleAddress);
  console.log("🏦 Treasury Vault Address:", treasuryVaultAddress);
  console.log("   (Hardcoded from deployed-addresses.json)\n");

  try {
    console.log("📦 Deploying MarketFactory...");
    const MarketFactory = await hre.ethers.getContractFactory("MarketFactory");
    const marketFactory = await MarketFactory.deploy(usdcAddress, outcomeOracleAddress, treasuryVaultAddress);
    
    console.log("⏳ Waiting for deployment confirmation...");
    await marketFactory.waitForDeployment();
    
    const marketFactoryAddress = await marketFactory.getAddress();
    const txHash = marketFactory.deploymentTransaction()?.hash;

    console.log("\n✅ MarketFactory deployed successfully!");
    console.log("=" .repeat(60));
    console.log("Contract Address:", marketFactoryAddress);
    console.log("USDC Token:", usdcAddress);
    console.log("OutcomeOracle:", outcomeOracleAddress);
    console.log("Treasury Vault:", treasuryVaultAddress);
    console.log("Transaction Hash:", txHash);
    console.log("=" .repeat(60));

    // Save to file
    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    let deployedAddresses = {};
    if (fs.existsSync(addressesPath)) {
      deployedAddresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    }
    deployedAddresses.marketFactory = marketFactoryAddress;
    fs.writeFileSync(addressesPath, JSON.stringify(deployedAddresses, null, 2));
    
    console.log("\n💾 Address saved to:", addressesPath);
    console.log("\n💡 Update your .env file:");
    console.log(`   ARC_MARKET_FACTORY=${marketFactoryAddress}`);
    console.log("\n📋 Next steps:");
    console.log("   1. Update ProtocolRegistry with MarketFactory address:");
    console.log(`      setMarketFactory(${marketFactoryAddress})`);
    console.log("\n   2. Update TreasuryVault with MarketFactory address:");
    console.log(`      setMarketFactory(${marketFactoryAddress})`);

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
