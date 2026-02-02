const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Deploying DummyReceiver to Arc Testnet...\n");

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
    console.log("📦 Deploying DummyReceiver...");
    const DummyReceiver = await hre.ethers.getContractFactory("DummyReceiver");
    const dummyReceiver = await DummyReceiver.deploy();
    
    console.log("⏳ Waiting for deployment confirmation...");
    await dummyReceiver.waitForDeployment();
    
    const dummyReceiverAddress = await dummyReceiver.getAddress();
    const txHash = dummyReceiver.deploymentTransaction()?.hash;

    console.log("\n✅ DummyReceiver deployed successfully!");
    console.log("=" .repeat(60));
    console.log("Contract Address:", dummyReceiverAddress);
    console.log("Transaction Hash:", txHash);
    console.log("=" .repeat(60));

    // Save to file
    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    let deployedAddresses = {};
    if (fs.existsSync(addressesPath)) {
      deployedAddresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
    }
    deployedAddresses.dummyReceiver = dummyReceiverAddress;
    fs.writeFileSync(addressesPath, JSON.stringify(deployedAddresses, null, 2));
    
    console.log("\n💾 Address saved to:", addressesPath);
    console.log("\n💡 Use this address in test_circle_transfer.js:");
    console.log(`   DUMMY_RECEIVER_ADDRESS=${dummyReceiverAddress}`);

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
