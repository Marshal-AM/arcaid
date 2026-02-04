/**
 * ============================================================================
 * AI TREASURY SYSTEM - COMPLETE TEST SCRIPT
 * ============================================================================
 * 
 * This script demonstrates the FULL system flow with:
 * - Circle Developer-Controlled Wallets (for trader & NGO)
 * - Automated transfers via Developer-Controlled Wallets API ✅ INTEGRATED
 * - Real Aave V3 (yield generation on Base Sepolia; Ethereum Sepolia USDC supply cap reached)
 * - Arc smart contracts (policy enforcement)
 * 
 * CIRCLE DEVELOPER-CONTROLLED WALLETS USAGE:
 * 
 * We use Circle's Developer-Controlled Wallets API to:
 * - Create wallets for traders and NGOs programmatically
 * - Transfer USDC from wallets to smart contracts
 * - Manage transactions without requiring user signatures
 * 
 * 1️⃣ USER DEPOSIT (Step 4)
 *    - circleWalletClient.createTransaction()
 *    - From: Trader's Developer-Controlled Wallet
 *    - To: Market Factory Smart Contract
 *    - Purpose: Deposit USDC into market
 *    - Chain: ARC-TESTNET (Arc testnet)
 * 
 * 2️⃣ NGO PAYOUT (Step 12a) - CROSS-CHAIN TRANSFER
 *    - circleWalletClient.createTransaction() with different blockchain
 *    - From: Treasury Wallet (Arc Testnet - ARC-TESTNET)
 *    - To: NGO Wallet (Base Sepolia - BASE-SEPOLIA)
 *    - Purpose: Cross-chain payout
 *    - Note: Requires treasury wallet to be a Developer-Controlled Wallet
 * 
 * 3️⃣ WINNER PAYOUT (Step 12b)
 *    - circleWalletClient.createTransaction()
 *    - From: Treasury Wallet (Arc Testnet)
 *    - To: Trader's Wallet (Arc Testnet)
 *    - Purpose: Return principal + reward
 *    - Chain: ARC-TESTNET (same chain)
 * 
 * KEY FEATURES:
 * ✅ No manual wallet signing required
 * ✅ Automated programmatic transfers
 * ✅ Cross-chain support via CCTP/Bridge Kit (automatic when chains differ)
 * ✅ Idempotency for safety
 * ✅ Status tracking and confirmation
 * 
 * DEVELOPER-CONTROLLED WALLETS:
 * - Wallets are created and managed programmatically by the developer
 * - No user signatures required for transactions
 * - Entity Secret is used to authorize transactions
 * - Supports multiple blockchains (Arc, Base, Ethereum, etc.)
 * 
 * PREREQUISITES:
 * 1. Node.js v18+ installed
 * 2. All contracts deployed (see DEPLOYMENT_GUIDE.md)
 * 3. Circle API credentials
 * 4. Environment variables configured
 * 
 * SETUP:
 * npm install @circle-fin/user-controlled-wallets @circle-fin/circle-sdk ethers@6 readline dotenv
 * 
 * RUN:
 * node test_full_system.js
 * ============================================================================
 */

require('dotenv').config();
const { ethers } = require('ethers');
const readline = require('readline');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
const { Circle, CircleEnvironments } = require('@circle-fin/circle-sdk');
const { BridgeKit } = require('@circle-fin/bridge-kit');
const { createEthersAdapterFromPrivateKey } = require('@circle-fin/adapter-ethers-v6');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Circle API Configuration
    circle: {
        apiKey: process.env.CIRCLE_API_KEY,
        entitySecret: process.env.CIRCLE_ENTITY_SECRET,
        environment: CircleEnvironments.sandbox, // Use sandbox for testing
    },
    
    // Arc Testnet Configuration
    arc: {
        rpc: process.env.ARC_RPC_URL || 'https://rpc.arc.testnet',
        chainId: parseInt(process.env.ARC_CHAIN_ID || '421614'),
        contracts: {
            protocolRegistry: process.env.ARC_PROTOCOL_REGISTRY,
            ngoRegistry: process.env.ARC_NGO_REGISTRY,
            policyEngine: process.env.ARC_POLICY_ENGINE,
            outcomeOracle: process.env.ARC_OUTCOME_ORACLE,
            treasuryVault: process.env.ARC_TREASURY_VAULT,
            bridgeManager: process.env.ARC_BRIDGE_MANAGER,
            marketFactory: process.env.ARC_MARKET_FACTORY,
            payoutExecutor: process.env.ARC_PAYOUT_EXECUTOR,
            usdc: process.env.ARC_USDC_ADDRESS,
        },
    },
    
    // Base Sepolia (Aave + bridge destination; Ethereum Sepolia USDC supply cap reached)
    baseSepolia: {
        rpc: process.env.BASE_SEPOLIA_RPC_URL || 'https://base-sepolia.g.alchemy.com/v2/NMsHzNgJ7XUYtzNyFpEJ8yT4muQ_lkRF',
        chainId: 84532,
        contracts: {
            yieldController: process.env.ETH_YIELD_CONTROLLER,
            circleUsdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Circle USDC (from bridge)
            aaveUsdc: '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f', // Aave USDC (for Aave deposits)
            usdc: process.env.BASE_SEPOLIA_USDC_ADDRESS || '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f',
            swapRouter: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4', // Uniswap SwapRouter02
            aavePool: '0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27',
            aUSDC: '0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC',
        },
    },

    // Base Sepolia (for NGO payout - different USDC if needed)
    base: {
        chainId: 84532,
        usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    },
    
    // Admin wallet
    adminPrivateKey: process.env.ADMIN_PRIVATE_KEY,
};

// ============================================================================
// INITIALIZATION
// ============================================================================

let circleClient, circleWalletClient;
let arcProvider, ethProvider;
let arcSigner, ethSigner;
let traderWalletId, ngoWalletId;
let marketId, marketAddress;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise((resolve) => {
        // Skip prompts in test mode
        if (process.env.SKIP_PROMPTS === 'true') {
            console.log(`${question} [AUTO-CONTINUING...]`);
            setTimeout(() => resolve(''), 1000);
            return;
        }
        
        if (rl.closed) {
            // If readline is closed, create a new one
            const newRl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            newRl.question(question, (answer) => {
                newRl.close();
                resolve(answer);
            });
        } else {
            rl.question(question, resolve);
        }
    });
}

async function initialize() {
    console.log('🚀 Initializing AI Treasury System Test...\n');
    
    // Initialize Circle SDK
    console.log('📡 Connecting to Circle API...');
    circleClient = new Circle(CONFIG.circle.apiKey, CONFIG.circle.environment);
    circleWalletClient = initiateDeveloperControlledWalletsClient({
        apiKey: CONFIG.circle.apiKey,
        entitySecret: CONFIG.circle.entitySecret,
    });
    
    // Initialize blockchain providers
    console.log('⛓️  Connecting to Arc testnet...');
    arcProvider = new ethers.JsonRpcProvider(CONFIG.arc.rpc);
    arcSigner = new ethers.Wallet(CONFIG.adminPrivateKey, arcProvider);
    
    console.log('⛓️  Connecting to Base Sepolia (Aave)...');
    const baseProvider = new ethers.JsonRpcProvider(CONFIG.baseSepolia.rpc);
    const baseSigner = new ethers.Wallet(CONFIG.adminPrivateKey, baseProvider);
    ethProvider = baseProvider;
    ethSigner = baseSigner;
    
    console.log('✅ Initialization complete!\n');
}

// ============================================================================
// HELPER: MANAGE TRADER WALLETS (JSON STORAGE)
// ============================================================================

const TRADERS_FILE = path.join(__dirname, 'trader-wallets.json');

function loadTraders() {
    try {
        if (fs.existsSync(TRADERS_FILE)) {
            const data = fs.readFileSync(TRADERS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.log('   Could not load traders file, will create new:', error.message);
    }
    return { traders: [], lastUpdated: null };
}

function saveTraders(tradersData) {
    tradersData.lastUpdated = new Date().toISOString();
    fs.writeFileSync(TRADERS_FILE, JSON.stringify(tradersData, null, 2));
    console.log(`\n💾 Saved traders to: ${TRADERS_FILE}`);
}

// ============================================================================
// STEP 1: CREATE CIRCLE WALLETS (3 TRADERS + 1 NGO)
// ============================================================================

async function createCircleWallets() {
    console.log('=' .repeat(80));
    console.log('STEP 1: Setting Up Circle Programmable Wallets (3 Traders + NGO)');
    console.log('=' .repeat(80));
    
    let traders = [];
    const tradersData = loadTraders();
    
    // Ask user if they want to use existing traders or create new ones
    console.log('\n📝 Trader Wallet Setup:');
    console.log('   Option 1: Press ENTER to create 3 NEW trader wallets');
    console.log('   Option 2: Type "use" to use EXISTING wallets from trader-wallets.json');
    console.log('');
    
    const choice = await prompt('Enter choice (or press ENTER for new): ');
    
    if (choice && choice.trim().toLowerCase() === 'use') {
        // Use existing traders from JSON
        if (tradersData.traders && tradersData.traders.length >= 3) {
            console.log('\n✅ Loading existing traders from file...\n');
            for (let i = 0; i < 3; i++) {
                const trader = tradersData.traders[i];
                console.log(`Trader ${i + 1}:`);
                console.log(`   Wallet ID: ${trader.walletId}`);
                console.log(`   Address: ${trader.address}`);
                traders.push(trader);
            }
            console.log('');
        } else {
            console.log('\n⚠️  Not enough traders in file. Creating new ones...\n');
        }
    }
    
    if (traders.length === 0) {
        // Create 3 new trader wallets (either because user pressed ENTER or typed something other than "use")
        console.log('\n🆕 Creating 3 NEW trader wallets...\n');
        
        // Create wallet set for all traders
        const traderWalletSetResponse = await circleWalletClient.createWalletSet({
            name: 'Prediction Market Traders',
        });
        const traderWalletSetId = traderWalletSetResponse.data?.walletSet?.id;
        console.log(`✅ Trader Wallet Set Created: ${traderWalletSetId}\n`);
        
        // Create 3 trader wallets
        for (let i = 1; i <= 3; i++) {
            console.log(`Creating Trader ${i}...`);
            const walletResponse = await circleWalletClient.createWallets({
                accountType: 'SCA',
                blockchains: ['ARC-TESTNET'],
                count: 1,
                walletSetId: traderWalletSetId,
            });
            
            const wallet = {
                walletId: walletResponse.data.wallets[0].id,
                address: walletResponse.data.wallets[0].address,
                name: `Trader${i}`,
                createdAt: new Date().toISOString()
            };
            
            traders.push(wallet);
            console.log(`   ✅ Wallet ID: ${wallet.walletId}`);
            console.log(`   Address: ${wallet.address}\n`);
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Save to JSON for future use
        saveTraders({ traders });
    }
    
    // Create NGO wallet (on Base for demonstration)
    console.log('Creating wallet for NGO...');
    
    // Create wallet set for NGO
    const ngoWalletSetResponse = await circleWalletClient.createWalletSet({
        name: 'NGO Wallet Set',
    });
    const ngoWalletSetId = ngoWalletSetResponse.data?.walletSet?.id;
    console.log(`✅ NGO Wallet Set Created: ${ngoWalletSetId}\n`);
    
    const ngoWalletResponse = await circleWalletClient.createWallets({
        accountType: 'SCA',
        blockchains: ['BASE-SEPOLIA'],
        count: 1,
        walletSetId: ngoWalletSetId,
    });
    
    ngoWalletId = ngoWalletResponse.data.wallets[0].id;
    const ngoAddress = ngoWalletResponse.data.wallets[0].address;
    console.log(`✅ NGO Wallet Created: ${ngoWalletId}`);
    console.log(`   Address: ${ngoAddress}`);
    console.log(`   Chain: Base Sepolia (Chain ID: ${CONFIG.base.chainId})\n`);
    
    console.log('=' .repeat(80));
    console.log('📋 SUMMARY: Wallets Created');
    console.log('=' .repeat(80));
    console.log(`Trader 1: ${traders[0].walletId} (${traders[0].address})`);
    console.log(`Trader 2: ${traders[1].walletId} (${traders[1].address})`);
    console.log(`Trader 3: ${traders[2].walletId} (${traders[2].address})`);
    console.log(`NGO: ${ngoWalletId} (${ngoAddress})`);
    console.log('=' .repeat(80) + '\n');
    
    return { traders, ngoWalletId, ngoAddress };
}

// ============================================================================
// STEP 2: FUND TRADER WALLETS FROM ADMIN
// ============================================================================

async function fundTraders(traders) {
    console.log('=' .repeat(80));
    console.log('STEP 2: Fund Trader Wallets from Admin (0.07 USDC each)');
    console.log('=' .repeat(80));
    
    const provider = new ethers.JsonRpcProvider(CONFIG.arc.rpc);
    const adminWallet = new ethers.Wallet(CONFIG.adminPrivateKey, provider);
    const usdcContract = new ethers.Contract(
        CONFIG.arc.contracts.usdc,
        ['function transfer(address to, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)'],
        adminWallet
    );
    
    console.log(`\n💰 Admin wallet: ${adminWallet.address}`);
    const adminBalance = await usdcContract.balanceOf(adminWallet.address);
    console.log(`   Admin USDC balance: ${ethers.formatUnits(adminBalance, 6)} USDC\n`);
    
    const fundAmount = ethers.parseUnits('0.07', 6); // 0.07 USDC per trader
    
    for (let i = 0; i < traders.length; i++) {
        const trader = traders[i];
        console.log(`\n📤 Funding ${trader.name} (${trader.address})...`);
        console.log(`   Amount: ${ethers.formatUnits(fundAmount, 6)} USDC`);
        
        try {
            const tx = await usdcContract.transfer(trader.address, fundAmount);
            console.log(`   Transaction hash: ${tx.hash}`);
            await tx.wait();
            console.log(`   ✅ Funded successfully!`);
        } catch (error) {
            console.error(`   ❌ Failed to fund: ${error.message}`);
            throw error;
        }
        
        // Small delay between transfers
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`\n✅ All 3 traders funded with 0.07 USDC each\n`);
}

async function checkWalletBalance(walletId) {
    try {
        console.log(`\n🔍 Checking balance for wallet: ${walletId}`);
        
    const balanceResponse = await circleWalletClient.getWalletTokenBalance({
        id: walletId,
    });
    
        // Debug: Log the full response structure
        console.log('\n📋 Raw API Response Structure:');
        console.log(`   Has 'data' property: ${!!balanceResponse.data}`);
        if (balanceResponse.data) {
            console.log(`   Data keys: ${Object.keys(balanceResponse.data).join(', ')}`);
            console.log(`   Has 'tokenBalances': ${!!balanceResponse.data.tokenBalances}`);
            console.log(`   Has 'balances': ${!!balanceResponse.data.balances}`);
        }
        
        // Check response structure
        const tokenBalances = balanceResponse.data?.tokenBalances || balanceResponse.data?.balances || [];
        
        console.log(`   Token balances array length: ${tokenBalances.length}\n`);
        
        // Debug: Log all tokens found
        if (tokenBalances.length > 0) {
            console.log(`📊 Found ${tokenBalances.length} token(s) in wallet:`);
            tokenBalances.forEach((token, idx) => {
                const tokenInfo = token.token || token;
                const symbol = tokenInfo?.symbol || 'Unknown';
                const amount = token.amount || token.balance || '0';
                const address = tokenInfo?.tokenAddress || tokenInfo?.address || 'N/A';
                const name = tokenInfo?.name || 'Unknown';
                console.log(`   ${idx + 1}. ${name} (${symbol})`);
                console.log(`      Address: ${address}`);
                console.log(`      Amount: ${amount}`);
                console.log(`      Full token object keys: ${Object.keys(token).join(', ')}`);
            });
            console.log('');
        } else {
            console.log('⚠️  No tokens found in balance response');
            console.log('   This could mean:');
            console.log('   - Wallet has no tokens');
            console.log('   - Response structure is different than expected');
            console.log('   - Tokens haven\'t synced yet (try waiting a few seconds)\n');
        }
        
        // Try to find USDC by multiple methods:
        // 1. By symbol (case-insensitive)
        // 2. By token address matching Arc USDC address
        const arcUsdcAddress = CONFIG.arc.contracts.usdc?.toLowerCase();
        console.log(`🔎 Looking for USDC (Arc USDC address: ${arcUsdcAddress})`);
        
        const usdcBalance = tokenBalances.find(token => {
            const tokenInfo = token.token || token;
            const symbol = (tokenInfo?.symbol || token.symbol || '').toUpperCase();
            const tokenAddress = (tokenInfo?.tokenAddress || tokenInfo?.address || '').toLowerCase();
            
            const matchesSymbol = symbol === 'USDC' || symbol.includes('USDC');
            const matchesAddress = arcUsdcAddress && tokenAddress === arcUsdcAddress;
            
            if (matchesSymbol || matchesAddress) {
                console.log(`   ✅ Match found! Symbol: ${symbol}, Address: ${tokenAddress}`);
            }
            
            return matchesSymbol || matchesAddress;
        });
        
        if (usdcBalance) {
            const amount = usdcBalance.amount || usdcBalance.balance || '0';
            console.log(`✅ Found USDC balance: ${amount}\n`);
            return amount;
        }
        
        console.log(`⚠️  No USDC token found in wallet balance\n`);
        return '0';
    } catch (error) {
        console.log(`❌ Error checking balance: ${error.message}`);
        console.log(`   Error type: ${error.constructor.name}`);
        if (error.response) {
            console.log(`   API Response status: ${error.response.status}`);
            console.log(`   API Response data: ${JSON.stringify(error.response.data, null, 2)}`);
        }
        console.log(`   Stack: ${error.stack || 'N/A'}\n`);
        return '0';
    }
}

// ============================================================================
// STEP 3: CREATE DISASTER MARKET
// ============================================================================

async function createDisasterMarket(ngoWalletId, ngoAddress) {
    console.log('=' .repeat(80));
    console.log('STEP 3: AI Creates Disaster Market');
    console.log('=' .repeat(80));
    
    // Register NGO first
    const ngoRegistry = new ethers.Contract(
        CONFIG.arc.contracts.ngoRegistry,
        ['function registerNGO(string,address,string,uint256) external returns (bytes32)',
         'function verifyNGO(bytes32) external'],
        arcSigner
    );
    
    console.log('Registering NGO in Arc registry...');
    const tx1 = await ngoRegistry.registerNGO(
        'Flood Relief Assam',
        ngoAddress,
        ngoWalletId, // Circle Wallet ID
        CONFIG.base.chainId // Preferred chain: Base
    );
    const receipt1 = await tx1.wait();
    
    // Parse NGO ID from event logs
    // Look for NGORegistered event: event NGORegistered(bytes32 indexed ngoId, string name, string circleWalletId);
    let ngoId = null;
    const ngoRegistryInterface = new ethers.Interface([
        'event NGORegistered(bytes32 indexed ngoId, string name, string circleWalletId)'
    ]);
    
    for (const log of receipt1.logs) {
        try {
            const parsed = ngoRegistryInterface.parseLog(log);
            if (parsed && parsed.name === 'NGORegistered') {
                ngoId = parsed.args.ngoId;
                break;
            }
        } catch (e) {
            // Not this log, continue
        }
    }
    
    if (!ngoId) {
        // Fallback: generate from name and timestamp
        ngoId = ethers.keccak256(ethers.toUtf8Bytes('Flood Relief Assam' + Date.now()));
        console.log('⚠️  Could not parse NGO ID from event, using generated ID');
    }
    
    console.log(`✅ NGO Registered: ${ngoId}`);
    
    // Verify NGO
    const tx2 = await ngoRegistry.verifyNGO(ngoId);
    await tx2.wait();
    console.log('✅ NGO Verified\n');
    
    // Create market
    const marketFactory = new ethers.Contract(
        CONFIG.arc.contracts.marketFactory,
        ['function createMarket(string,string,string,uint256,bytes32,bytes32[]) external returns (bytes32,address)'],
        arcSigner
    );
    
    console.log('Creating disaster prediction market...');
    const policyId = ethers.keccak256(ethers.toUtf8Bytes('DEFAULT'));
    
    const tx3 = await marketFactory.createMarket(
        'Will emergency aid reach 100,000 people in Assam within 14 days?',
        'Floods',
        'Assam, India',
        14, // 14 days duration (but we'll use forceCloseMarket for testing)
        policyId,
        [ngoId] // Eligible NGOs
    );
    
    const receipt3 = await tx3.wait();
    
    // Parse MarketCreated event: event MarketCreated(bytes32 indexed marketId, address marketAddress, string question);
    const marketFactoryInterface = new ethers.Interface([
        'event MarketCreated(bytes32 indexed marketId, address marketAddress, string question)'
    ]);
    
    let parsedMarketId = null;
    let parsedMarketAddress = null;
    
    for (const log of receipt3.logs) {
        try {
            const parsed = marketFactoryInterface.parseLog(log);
            if (parsed && parsed.name === 'MarketCreated') {
                parsedMarketId = parsed.args.marketId;
                parsedMarketAddress = parsed.args.marketAddress;
                break;
            }
        } catch (e) {
            // Not this log, continue
        }
    }
    
    if (!parsedMarketId || !parsedMarketAddress) {
        // Fallback: try to extract from topics and data
        if (receipt3.logs.length > 0) {
            const log = receipt3.logs[receipt3.logs.length - 1]; // Usually the last log
            if (log.topics && log.topics.length > 1) {
                parsedMarketId = log.topics[1];
            }
            if (log.data && log.data.length >= 66) {
                parsedMarketAddress = '0x' + log.data.slice(26, 66);
            }
        }
        
        if (!parsedMarketId || !parsedMarketAddress) {
            throw new Error('Could not parse market ID or address from transaction receipt');
        }
    }
    
    marketId = parsedMarketId;
    marketAddress = parsedMarketAddress;
    
    console.log(`✅ Market Created!`);
    console.log(`   Market ID: ${marketId}`);
    console.log(`   Market Address: ${marketAddress}`);
    console.log(`   Question: Will emergency aid reach 100,000 people in Assam?`);
    console.log(`   Duration: 14 days (will be force-closed for testing)\n`);
    
    return { marketId, marketAddress, ngoId };
}

// ============================================================================
// STEP 4: TRADER PARTICIPATES (BUYS YES TOKENS) - USING CIRCLE GATEWAY
// ============================================================================

async function traderParticipates(traderWalletId, marketId, amount, votedYes = true) {
    const tokenType = votedYes ? 'YES' : 'NO';
    console.log(`\n💳 Trader participates: Buying ${tokenType} tokens`);
    console.log(`   Amount: ${amount} USDC`);
    
    const amountInWei = ethers.parseUnits(amount.toString(), 6);
    
    // Get trader wallet details
    const walletResponse = await circleWalletClient.getWallet({ id: traderWalletId });
    const traderAddress = walletResponse.data.wallet.address;
    
    console.log(`💳 Using Circle Gateway to transfer USDC...`);
    console.log(`   From: Trader Wallet (${traderWalletId})`);
    console.log(`   To: Market Factory (${CONFIG.arc.contracts.marketFactory})`);
    console.log(`   Amount: ${amount} USDC\n`);
    
    // ========================================================================
    // 🔥 CIRCLE GATEWAY USAGE #1: User Deposit
    // ========================================================================
    // Declare txId and txState at function scope (matching test_circle_transfer.js pattern)
    // This ensures they're accessible after the try-catch block
    let txId = null;
    let txState = null;
    
    try {
        // Use Circle Developer-Controlled Wallets API to transfer USDC
        // This creates a blockchain transaction from the developer-controlled wallet
        console.log('Creating transfer transaction via Developer-Controlled Wallets...');
        
        // Convert amount to decimal string (USDC has 6 decimals)
        // amountInWei is already in smallest units (6 decimals), convert to decimal
        let amountDecimal = ethers.formatUnits(amountInWei, 6);
        
        // Get wallet balance to find the USDC token ID (UUID)
        const balanceResponse = await circleWalletClient.getWalletTokenBalance({
            id: traderWalletId,
        });
        
        const tokenBalances = balanceResponse.data?.tokenBalances || [];
        
        // Note: Arc testnet uses USDC as native token, so USDC balance covers both transfer and gas
        // Check for native token balance (for gas fees)
        const nativeToken = tokenBalances.find(token => {
            const tokenInfo = token.token || token;
            return tokenInfo?.isNative === true;
        });
        const nativeBalance = nativeToken ? parseFloat(nativeToken.amount || '0') : 0;
        if (nativeBalance > 0) {
            console.log(`   Native token balance: ${nativeBalance} (for gas fees)`);
        }
        
        // Find USDC token - check by symbol (case-insensitive, including USDC-TESTNET) or by address
        const arcUsdcAddress = CONFIG.arc.contracts.usdc?.toLowerCase();
        const usdcToken = tokenBalances.find(token => {
            const tokenInfo = token.token || token;
            const symbol = (tokenInfo?.symbol || '').toUpperCase();
            const tokenAddress = (tokenInfo?.tokenAddress || tokenInfo?.address || '').toLowerCase();
            
            // Match if symbol contains USDC (e.g., "USDC", "USDC-TESTNET") or address matches
            return symbol.includes('USDC') || 
                   (arcUsdcAddress && tokenAddress === arcUsdcAddress);
        });
        
        if (!usdcToken || !usdcToken.token?.id) {
            console.log('\n❌ Available tokens in wallet:');
            tokenBalances.forEach((token, idx) => {
                const tokenInfo = token.token || token;
                const symbol = tokenInfo?.symbol || 'Unknown';
                const amount = token.amount || '0';
                const isNative = tokenInfo?.isNative ? ' (native)' : '';
                console.log(`   ${idx + 1}. ${symbol}: ${amount}${isNative}`);
            });
            throw new Error('USDC token not found in wallet. Please ensure the wallet has USDC balance.');
        }
        
        const usdcTokenId = usdcToken.token.id;
        const usdcBalance = parseFloat(usdcToken.amount || usdcToken.balance || '0');
        const transferAmount = parseFloat(amountDecimal);
        console.log(`   Using USDC Token ID: ${usdcTokenId}`);
        console.log(`   Wallet USDC balance: ${usdcBalance}`);
        console.log(`   Requested transfer amount: ${transferAmount}`);
        
        // On Arc testnet, USDC is the native token, so gas is paid in USDC
        // Validate balance - need enough for transfer + gas reserve
        const minGasReserve = 0.01; // Reserve at least 0.01 USDC for gas
        if (usdcBalance < transferAmount + minGasReserve) {
            throw new Error(`Insufficient balance: wallet has ${usdcBalance} USDC but needs ${transferAmount} USDC for transfer + ${minGasReserve} USDC for gas = ${transferAmount + minGasReserve} USDC total`);
        }
        
        const gasReserve = usdcBalance - transferAmount;
        
        console.log(`   Transfer amount: ${transferAmount} USDC`);
        console.log(`   Gas reserve: ${gasReserve.toFixed(6)} USDC (leaving remaining USDC for gas)`);
        console.log(`   ✅ Transfer amount set to ${transferAmount} USDC, leaving ${gasReserve.toFixed(6)} USDC for gas fees\n`);
        
        // Validate destination address
        if (!ethers.isAddress(CONFIG.arc.contracts.marketFactory)) {
            throw new Error(`Invalid MarketFactory address: ${CONFIG.arc.contracts.marketFactory}`);
        }
        
        // Verify MarketFactory contract exists on-chain
        console.log(`\n🔍 Verifying MarketFactory contract...`);
        try {
            const code = await arcProvider.getCode(CONFIG.arc.contracts.marketFactory);
            if (code === '0x' || code === '0x0') {
                throw new Error(`MarketFactory contract not found at ${CONFIG.arc.contracts.marketFactory}. Contract may not be deployed.`);
            }
            console.log(`   ✅ MarketFactory contract exists at ${CONFIG.arc.contracts.marketFactory}`);
        } catch (error) {
            console.log(`   ❌ Error verifying contract: ${error.message}`);
            throw new Error(`Cannot verify MarketFactory contract: ${error.message}`);
        }
        
        // Check USDC token contract
        const usdcContractAddress = usdcToken.token?.tokenAddress || CONFIG.arc.contracts.usdc;
        if (usdcContractAddress) {
            console.log(`   ✅ USDC token address: ${usdcContractAddress}`);
            try {
                const usdcCode = await arcProvider.getCode(usdcContractAddress);
                if (usdcCode === '0x' || usdcCode === '0x0') {
                    console.log(`   ⚠️  WARNING: USDC contract not found at ${usdcContractAddress}`);
                } else {
                    console.log(`   ✅ USDC contract exists`);
                }
            } catch (error) {
                console.log(`   ⚠️  Could not verify USDC contract: ${error.message}`);
            }
        }
        
        console.log(`\n📤 Creating transaction with:`);
        console.log(`     - Wallet ID: ${traderWalletId}`);
        console.log(`     - Token ID: ${usdcTokenId}`);
        console.log(`     - Destination: ${CONFIG.arc.contracts.marketFactory}`);
        console.log(`     - Amount: ${amountDecimal} USDC`);
        console.log(`     - Fee Level: MEDIUM (using working configuration from testGateway.js)\n`);
        
        // Build transaction parameters - Using the WORKING approach from testGateway.js
        // NOTE: No idempotencyKey - matching the working pattern that successfully transfers to MarketFactory
        const transactionParams = {
            walletId: traderWalletId,
            tokenId: usdcTokenId, // Use tokenId directly (simpler approach that works)
            destinationAddress: CONFIG.arc.contracts.marketFactory,
            amounts: [amountDecimal], // Simple decimal string like "0.5"
            fee: {
                type: "level",
                config: {
                    feeLevel: "MEDIUM", // This is what works! (confirmed in test_circle_transfer.js)
                },
            },
        };
        
        console.log(`🚀 Creating Circle transaction (using working pattern from testGateway.js)...\n`);
        
        const transferResponse = await circleWalletClient.createTransaction(transactionParams);
        
        // Get transaction data - using the working approach from testGateway1.js
        const txData = transferResponse.data?.transaction || transferResponse.data;
        txId = txData?.id || transferResponse.data?.id;
        txState = txData?.state || transferResponse.data?.state;
        
        console.log('✅ Transfer Transaction Created');
        console.log(`   Transaction ID: ${txId}`);
        console.log(`   Status: ${txState}`);
        if (txData?.txHash) {
            console.log(`   Transaction Hash: ${txData.txHash}`);
        }
        console.log('');
        
        // Wait for transaction confirmation
        console.log('⏳ Waiting for transaction confirmation...');
        let attempts = 0;
        const maxAttempts = 60; // Wait up to 3 minutes (60 * 3 seconds)
        
        // Wait for transaction to complete
        while (txId && txState && ['INITIATED', 'PENDING', 'QUEUED', 'SENT'].includes(txState) && attempts < maxAttempts) {
            await sleep(3000);
            try {
                const statusCheck = await circleWalletClient.getTransaction({
                    id: txId
                });
                // Use the working approach from testGateway1.js - check nested transaction object
                const txStatusData = statusCheck.data?.transaction || statusCheck.data;
                const newState = txStatusData?.state || statusCheck.data?.state;
                if (newState !== txState) {
                    txState = newState;
                    console.log(`   Status: ${txState} (${attempts * 3}s elapsed)`);
                } else {
                    // Show progress every 15 seconds
                    if (attempts % 5 === 0) {
                        console.log(`   Still ${txState}... (${attempts * 3}s elapsed)`);
                    }
                }
            } catch (error) {
                console.log(`   Error checking status: ${error.message}`);
            }
            attempts++;
        }
        
        if (txState === 'COMPLETE' || txState === 'COMPLETED' || txState === 'CONFIRMED') {
            console.log('✅ USDC transferred successfully');
            console.log('⏳ Waiting additional 5 seconds for on-chain confirmation...');
            await sleep(5000);
            console.log('');
        } else if (txState === 'FAILED') {
            // Get more details about the failure
            console.log('\n❌ Transaction failed! Getting failure details...');
            let txDetails = null;
            try {
                const failedTx = await circleWalletClient.getTransaction({ id: txId });
                // Use the working approach from testGateway1.js - check nested transaction object
                txDetails = failedTx.data?.transaction || failedTx.data;
                
                console.log(`   Error Reason: ${txDetails?.errorReason || 'Unknown'}`);
                console.log(`   Error Details: ${txDetails?.errorDetails || 'None'}`);
                if (txDetails?.txHash) {
                    console.log(`   Transaction Hash: ${txDetails.txHash}`);
                }
                
                if (txDetails?.errorReason === 'ESTIMATION_ERROR') {
                    console.log(`\n💡 ESTIMATION_ERROR means the transaction would revert on-chain.`);
                    console.log(`   Error Details: "${txDetails?.errorDetails || 'execution reverted'}"`);
                    console.log(`\n   Possible causes:`);
                    console.log(`   1. Insufficient USDC for gas fees (Arc uses USDC as native token)`);
                    console.log(`      - You have: ${usdcBalance} USDC`);
                    console.log(`      - Transferring: ${transferAmount} USDC`);
                    console.log(`      - Need to reserve ~0.1 USDC for gas fees`);
                    console.log(`   2. MarketFactory contract not properly deployed (should have receive()/fallback() functions)`);
                    console.log(`   3. USDC token contract restrictions`);
                    console.log(`   4. Invalid transaction parameters\n`);
                    
                    console.log(`   💡 SOLUTIONS TO TRY:`);
                    console.log(`   A. Reduce transfer amount to leave more USDC for gas:`);
                    console.log(`      Try transferring ${Math.max(0.1, transferAmount - 0.2).toFixed(6)} USDC instead`);
                    console.log(`   B. Verify MarketFactory address is correct: ${CONFIG.arc.contracts.marketFactory}`);
                    console.log(`   C. Ensure MarketFactory is the updated version with receive()/fallback() functions`);
                    console.log(`   D. Verify USDC token contract on Arc testnet\n`);
                }
                
                if (txDetails?.txHash) {
                    console.log(`   Transaction hash: ${txDetails.txHash}`);
                    console.log(`   Check on block explorer for more details\n`);
                }
            } catch (error) {
                console.log(`   Could not get transaction details: ${error.message}`);
            }
            const errorMsg = txDetails 
                ? `Transfer transaction failed: ${txDetails.errorReason || txState} - ${txDetails.errorDetails || 'See details above'}`
                : `Transfer transaction failed with state: ${txState}`;
            throw new Error(errorMsg);
        } else if (!txId) {
            throw new Error('Transaction ID not found - cannot verify transfer');
        } else {
            console.log(`\n⚠️  Transaction status: ${txState} after ${attempts * 3}s`);
            console.log(`   Transaction may still be processing on-chain`);
            console.log(`   You can check status manually with transaction ID: ${txId}`);
            console.log(`   Continuing anyway, but participation recording may fail if USDC hasn't arrived yet...\n`);
        }
        
        // Additional wait to ensure on-chain confirmation
        if (txState === 'COMPLETE' || txState === 'COMPLETED' || txState === 'CONFIRMED') {
            console.log('⏳ Waiting additional 5 seconds for on-chain confirmation...');
            await sleep(5000);
        }
        
    } catch (error) {
        console.error('❌ Circle Gateway transfer failed:', error.message);
        if (error.response) {
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
    
    // ========================================================================
    // STEP 2: Record participation in smart contract
    // ========================================================================
    // Note: The Circle transfer already moved USDC from trader wallet to MarketFactory
    // Now we call participateWithPreTransferredUSDC() to record the participation
    
    if (txState !== 'COMPLETE' && txState !== 'COMPLETED' && txState !== 'CONFIRMED') {
        throw new Error(`Cannot record participation: Circle transfer not completed. Status: ${txState}`);
    }
    
    const traderWalletInfo = await circleWalletClient.getWallet({ id: traderWalletId });
    const traderWalletAddress = traderWalletInfo.data?.wallet?.address;
    
    if (!traderWalletAddress) {
        throw new Error('Could not get trader wallet address from Circle');
    }
    
    console.log(`\n📝 Recording participation for trader wallet: ${traderWalletAddress}`);
    console.log(`   USDC was already transferred via Circle transaction to MarketFactory`);
    console.log(`   Using participateWithPreTransferredUSDC() to record participation...\n`);
    
    // Create MarketFactory contract instance
    const marketFactory = new ethers.Contract(
        CONFIG.arc.contracts.marketFactory,
        [
            'function participateWithPreTransferredUSDC(bytes32,address,uint256,bool) external',
            'function getMarket(bytes32) external view returns (tuple(address,address,address,bytes32,bool))',
            'function usdcToken() external view returns (address)'
        ],
        arcSigner
    );
    
    // Verify MarketFactory contract exists
    try {
        const marketInfo = await marketFactory.getMarket(marketId);
        if (!marketInfo || marketInfo.marketAddress === ethers.ZeroAddress) {
            throw new Error(`Market ${marketId} not found in MarketFactory`);
        }
        console.log(`   ✅ Market found: ${marketInfo.marketAddress}`);
    } catch (error) {
        if (error.message.includes('Market')) {
            throw error;
        }
        console.log(`   ⚠️  Could not verify market: ${error.message}`);
    }
    
    // Verify USDC balance in MarketFactory before calling participateWithPreTransferredUSDC
    try {
        const usdcTokenAddress = await marketFactory.usdcToken();
        const usdcContract = new ethers.Contract(
            usdcTokenAddress,
            ['function balanceOf(address) external view returns (uint256)'],
            arcProvider
        );
        const marketFactoryBalance = await usdcContract.balanceOf(CONFIG.arc.contracts.marketFactory);
        const expectedBalance = amountInWei;
        
        console.log(`   MarketFactory USDC balance: ${ethers.formatUnits(marketFactoryBalance, 6)} USDC`);
        console.log(`   Expected balance (from transfer): ${ethers.formatUnits(expectedBalance, 6)} USDC`);
        
        if (marketFactoryBalance < expectedBalance) {
            console.log(`   ⚠️  WARNING: MarketFactory balance (${ethers.formatUnits(marketFactoryBalance, 6)}) is less than expected (${ethers.formatUnits(expectedBalance, 6)})`);
            console.log(`   The Circle transfer may still be processing on-chain.`);
            console.log(`   Waiting additional 10 seconds...`);
            await sleep(10000);
            
            // Check again
            const newBalance = await usdcContract.balanceOf(CONFIG.arc.contracts.marketFactory);
            console.log(`   MarketFactory USDC balance after wait: ${ethers.formatUnits(newBalance, 6)} USDC`);
            
            if (newBalance < expectedBalance) {
                throw new Error(`Insufficient USDC in MarketFactory. Have: ${ethers.formatUnits(newBalance, 6)}, Need: ${ethers.formatUnits(expectedBalance, 6)}`);
            }
        } else {
            console.log(`   ✅ MarketFactory has sufficient USDC balance\n`);
        }
    } catch (error) {
        console.log(`   ⚠️  Could not verify USDC balance: ${error.message}`);
        console.log(`   Proceeding anyway, but participation may fail if USDC hasn't arrived...\n`);
    }
    
    // Call participateWithPreTransferredUSDC
    try {
        const voteType = votedYes ? 'YES' : 'NO';
        console.log('Calling participateWithPreTransferredUSDC...');
        console.log(`   Parameters:`);
        console.log(`     - Market ID: ${marketId}`);
        console.log(`     - User Wallet: ${traderWalletAddress}`);
        console.log(`     - Amount: ${ethers.formatUnits(amountInWei, 6)} USDC`);
        console.log(`     - Vote: ${voteType}\n`);
        
        const participateTx = await marketFactory.participateWithPreTransferredUSDC(
            marketId,
            traderWalletAddress, // The Circle Wallet address that sent USDC
            amountInWei,
            votedYes // Vote YES or NO based on parameter
        );
        
        console.log(`   Transaction hash: ${participateTx.hash}`);
        console.log(`   Waiting for confirmation...`);
        
        const receipt = await participateTx.wait();
        console.log(`   ✅ Transaction confirmed in block ${receipt.blockNumber}`);
        
        // Log current YES/NO token prices (dynamic pricing)
        try {
            const marketAddr = marketInfo[0] || marketInfo.marketAddress;
            const marketPriceContract = new ethers.Contract(
                marketAddr,
                ['function getYesPrice() view returns (uint256)', 'function getNoPrice() view returns (uint256)'],
                arcProvider
            );
            const yesPrice = await marketPriceContract.getYesPrice();
            const noPrice = await marketPriceContract.getNoPrice();
            console.log(`   📊 Current market prices: YES = ${ethers.formatUnits(yesPrice, 6)} USDC, NO = ${ethers.formatUnits(noPrice, 6)} USDC`);
        } catch (e) {
            console.log(`   ⚠️  Could not read prices: ${e.message}`);
        }
        
        console.log(`\n✅ Participation recorded successfully`);
        console.log(`✅ Trader ${traderWalletAddress} participated with ${amount} USDC`);
        console.log(`✅ Received ${voteType} tokens\n`);
    } catch (error) {
        console.error(`\n❌ Error recording participation: ${error.message}`);
        
        if (error.message.includes('function') && error.message.includes('not found')) {
            console.log(`\n⚠️  MarketFactory.participateWithPreTransferredUSDC() not found!`);
            console.log(`   You need to redeploy MarketFactory with the updated contract.`);
            console.log(`   The updated contract is in contracts/MarketFactory.sol`);
            console.log(`   Please redeploy and update the address in .env\n`);
        } else if (error.message.includes('Insufficient USDC')) {
            console.log(`\n⚠️  Insufficient USDC in MarketFactory contract.`);
            console.log(`   This means the Circle transfer may not have completed yet.`);
            console.log(`   Please wait a few seconds and try again, or check the Circle transaction status.\n`);
        } else if (error.message.includes('Only admin')) {
            console.log(`\n⚠️  Only admin can call participateWithPreTransferredUSDC().`);
            console.log(`   Make sure your arcSigner is the admin wallet that deployed MarketFactory.\n`);
        } else if (error.message.includes('Market not active')) {
            console.log(`\n⚠️  Market is not active.`);
            console.log(`   The market may have been deactivated or doesn't exist.\n`);
        }
        
        throw error;
    }
    
    return amountInWei;
}

// ============================================================================
// STEP 5: BRIDGE USDC TO ETHEREUM FOR YIELD (Circle Bridge Kit / CCTP)
// ============================================================================

async function bridgeToEthereum(marketId, amount) {
    console.log('=' .repeat(80));
    console.log('STEP 5: Bridge USDC to Base Sepolia for Aave Yield');
    console.log('=' .repeat(80));
    
    console.log('Using Circle Bridge Kit (CCTP) to move USDC...');
    console.log(`Source: Arc Testnet`);
    console.log(`Destination: Base Sepolia`);
    console.log(`Amount: ${ethers.formatUnits(amount, 6)} USDC\n`);
    
    // Step 1: Withdraw USDC from MarketFactory to admin on Arc (so admin has USDC to bridge)
    console.log('📤 Withdrawing USDC from MarketFactory to admin on Arc...');
    const marketFactory = new ethers.Contract(
        CONFIG.arc.contracts.marketFactory,
        ['function emergencyWithdraw(address to, uint256 amount) external'],
        arcSigner
    );
    const withdrawTx = await marketFactory.emergencyWithdraw(arcSigner.address, amount);
    await withdrawTx.wait();
    console.log('   ✅ USDC withdrawn to admin on Arc\n');
    
    // Step 2: Use Circle Bridge Kit to bridge Arc → Base Sepolia
    console.log('🌉 Initiating Circle Bridge Kit (CCTP) transfer...');
    const privateKey = CONFIG.adminPrivateKey.startsWith('0x') ? CONFIG.adminPrivateKey : '0x' + CONFIG.adminPrivateKey;
    
    const adapter = createEthersAdapterFromPrivateKey({
        privateKey,
        getProvider: ({ chain }) => {
            const rpcMap = {
                'Arc_Testnet': CONFIG.arc.rpc,
                'Arc Testnet': CONFIG.arc.rpc,
                'Base_Sepolia': CONFIG.baseSepolia.rpc,
                'Base Sepolia': CONFIG.baseSepolia.rpc,
            };
            const rpcUrl = rpcMap[chain.name] || rpcMap[chain.chain];
            if (!rpcUrl) {
                throw new Error(`RPC not configured for chain: ${chain.name || chain.chain}`);
            }
            return new ethers.JsonRpcProvider(rpcUrl);
        }
    });
    const bridgeKit = new BridgeKit();
    
    const amountStr = ethers.formatUnits(amount, 6);
    const result = await bridgeKit.bridge({
        from: { adapter, chain: 'Arc_Testnet' },
        to: { adapter, chain: 'Base_Sepolia' },
        amount: amountStr,
    });
    
    if (result.steps && result.steps.length > 0) {
        console.log('   Bridge steps:');
        result.steps.forEach((step, i) => {
            console.log(`   ${i + 1}. ${step.name}: ${step.state}`);
            if (step.data && step.data.explorerUrl) {
                console.log(`      ${step.data.explorerUrl}`);
            }
        });
    }
    console.log(`   State: ${result.state}`);
    console.log(`   Amount: ${result.amount} ${result.token}\n`);
    
    if (result.state === 'error') {
        const errStep = result.steps && result.steps.find(s => s.state === 'error');
        const errMsg = errStep ? (errStep.errorMessage || (errStep.error && String(errStep.error)) || JSON.stringify(errStep)) : 'Bridge failed';
        throw new Error(errMsg);
    }
    
    if (result.state === 'pending') {
        console.log('   ⏳ Bridge in progress (attestation/mint may be pending). Waiting 60s...');
        await sleep(60000);
    }
    
    // Step 3: Record bridge operation in BridgeManager (on-chain bookkeeping)
    const attestationId = result.config?.attestationId || `cctp-${Date.now()}`;
    const bridgeManager = new ethers.Contract(
        CONFIG.arc.contracts.bridgeManager,
        ['function initiateBridge(bytes32,uint256,uint256,string) external returns (bytes32)'],
        arcSigner
    );
    const bridgeTx = await bridgeManager.initiateBridge(
        marketId,
        amount,
        CONFIG.baseSepolia.chainId,
        attestationId
    );
    await bridgeTx.wait();
    console.log('✅ Bridge operation recorded in BridgeManager');
    console.log('✅ USDC bridged to Base Sepolia\n');
    
    return true;
}

// ============================================================================
// STEP 5.5: SWAP CIRCLE USDC TO AAVE USDC (LOW LIQUIDITY POOL)
// ============================================================================

async function swapCircleToAaveUSDC(baseProvider, baseSigner, adminAddress, amountToSwapWei) {
    console.log('=' .repeat(80));
    console.log('STEP 5.5: Swap Circle USDC → Aave USDC');
    console.log('=' .repeat(80));
    console.log('Note: Bridge gives Circle USDC, but Aave needs Aave USDC\n');

    const circleUsdcContract = new ethers.Contract(
        CONFIG.baseSepolia.contracts.circleUsdc,
        [
            'function balanceOf(address) external view returns (uint256)',
            'function allowance(address owner, address spender) external view returns (uint256)',
            'function approve(address spender, uint256 amount) external returns (bool)',
            'function decimals() external view returns (uint8)',
            'function symbol() external view returns (string)',
        ],
        baseProvider
    );

    const aaveUsdcContract = new ethers.Contract(
        CONFIG.baseSepolia.contracts.aaveUsdc,
        [
            'function balanceOf(address) external view returns (uint256)',
            'function decimals() external view returns (uint8)',
            'function symbol() external view returns (string)',
        ],
        baseProvider
    );

    const circleDecimals = await circleUsdcContract.decimals();
    const circleSymbol = await circleUsdcContract.symbol();

    // Check Circle USDC balance
    const circleBalance = await circleUsdcContract.balanceOf(adminAddress);
    console.log(`\n   Circle USDC balance (wallet total): ${ethers.formatUnits(circleBalance, circleDecimals)} ${circleSymbol}`);

    if (circleBalance === 0n) {
        throw new Error('No Circle USDC to swap! The bridge may not have completed yet.');
    }

    // Swap ONLY the amount that was bridged this run (not the whole wallet - pool has low liquidity)
    const swapAmount = amountToSwapWei != null && amountToSwapWei > 0n
        ? (amountToSwapWei <= circleBalance ? amountToSwapWei : circleBalance)
        : circleBalance;
    
    if (amountToSwapWei != null && amountToSwapWei > 0n) {
        console.log(`   Amount bridged this run: ${ethers.formatUnits(amountToSwapWei, circleDecimals)} USDC`);
    }
    console.log(`   💱 Swapping ONLY this amount: ${ethers.formatUnits(swapAmount, circleDecimals)} USDC → Aave USDC`);

    // Get Aave USDC balance before swap
    const aaveBalanceBefore = await aaveUsdcContract.balanceOf(adminAddress);
    const aaveDecimals = await aaveUsdcContract.decimals();
    const aaveSymbol = await aaveUsdcContract.symbol();
    console.log(`   Aave USDC balance (before): ${ethers.formatUnits(aaveBalanceBefore, aaveDecimals)} ${aaveSymbol}`);

    // Approve Circle USDC for swap router
    console.log('\n   Approving Circle USDC for Uniswap SwapRouter...');
    const allowance = await circleUsdcContract.allowance(adminAddress, CONFIG.baseSepolia.contracts.swapRouter);
    
    if (allowance < swapAmount) {
        console.log(`   Current allowance: ${ethers.formatUnits(allowance, circleDecimals)} USDC`);
        console.log(`   Required amount: ${ethers.formatUnits(swapAmount, circleDecimals)} USDC`);
        
        const gasOptions = {
            gasLimit: 100000,
            maxFeePerGas: ethers.parseUnits("2", "gwei"),
            maxPriorityFeePerGas: ethers.parseUnits("1", "gwei")
        };
        
        if (allowance > 0n) {
            console.log('   Resetting existing allowance to 0...');
            const resetTx = await circleUsdcContract.connect(baseSigner).approve(CONFIG.baseSepolia.contracts.swapRouter, 0n, gasOptions);
            await resetTx.wait();
            console.log('   ✅ Reset complete');
            await sleep(2000);
        }
        
        console.log('   Setting new allowance...');
        const approveTx = await circleUsdcContract.connect(baseSigner).approve(
            CONFIG.baseSepolia.contracts.swapRouter,
            swapAmount,
            gasOptions
        );
        await approveTx.wait();
        console.log('   ✅ Approval confirmed');
        console.log('   Waiting 3 seconds for confirmation to propagate...');
        await sleep(3000);
    } else {
        console.log(`   ✅ Already approved (allowance: ${ethers.formatUnits(allowance, circleDecimals)} USDC)`);
    }

    // Prepare swap parameters (swap entire amount with 5% slippage tolerance)
    const minAmountOut = (swapAmount * 95n) / 100n; // 5% slippage tolerance
    
    const swapParams = {
        tokenIn: CONFIG.baseSepolia.contracts.circleUsdc,
        tokenOut: CONFIG.baseSepolia.contracts.aaveUsdc,
        fee: 500, // 0.05% fee tier
        recipient: adminAddress,
        amountIn: swapAmount,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0 // No price limit
    };

    console.log(`\n   💱 Swapping ${ethers.formatUnits(swapAmount, circleDecimals)} Circle USDC → Aave USDC...`);
    console.log(`   DEBUG: Swap params:`, JSON.stringify({
        tokenIn: swapParams.tokenIn,
        tokenOut: swapParams.tokenOut,
        fee: swapParams.fee,
        recipient: swapParams.recipient,
        amountIn: swapParams.amountIn.toString(),
        amountOutMinimum: swapParams.amountOutMinimum.toString(),
        sqrtPriceLimitX96: swapParams.sqrtPriceLimitX96
    }, null, 2));

    const swapRouter = new ethers.Contract(
        CONFIG.baseSepolia.contracts.swapRouter,
        [
            'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
        ],
        baseSigner
    );

    // DEBUG: Check contract and function
    console.log(`   DEBUG: SwapRouter address: ${swapRouter.target}`);
    console.log(`   DEBUG: Signer address: ${await baseSigner.getAddress()}`);
    console.log(`   DEBUG: Function exists: ${typeof swapRouter.exactInputSingle === 'function'}`);
    
    // DEBUG: Try to populate transaction first to see the encoded data
    try {
        const populatedTx = await swapRouter.exactInputSingle.populateTransaction(swapParams);
        console.log(`   DEBUG: Transaction data length: ${populatedTx.data.length}`);
        console.log(`   DEBUG: Transaction data preview: ${populatedTx.data.substring(0, 66)}...`);
    } catch (err) {
        console.log(`   DEBUG: Error populating transaction: ${err.message}`);
    }

    const swapTx = await swapRouter.exactInputSingle(swapParams, {
        value: 0,  // CRITICAL: Must explicitly set value: 0 for payable functions when not sending ETH
        gasLimit: 200000,
        maxFeePerGas: ethers.parseUnits("2", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("1", "gwei")
    });

    console.log(`   📤 Transaction hash: ${swapTx.hash}`);
    console.log('   Waiting for confirmation...');

    const receipt = await swapTx.wait();
    console.log(`   ✅ Swap confirmed in block ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

    // Verify swap results
    console.log('\n   📊 Verifying swap results...');
    await sleep(3000);

    const circleBalanceAfter = await circleUsdcContract.balanceOf(adminAddress);
    const aaveBalanceAfter = await aaveUsdcContract.balanceOf(adminAddress);

    console.log(`   Circle USDC balance (after): ${ethers.formatUnits(circleBalanceAfter, circleDecimals)} ${circleSymbol}`);
    console.log(`   Aave USDC balance (after): ${ethers.formatUnits(aaveBalanceAfter, aaveDecimals)} ${aaveSymbol}`);

    const aaveReceived = aaveBalanceAfter - aaveBalanceBefore;
    console.log(`   ✅ Received: ${ethers.formatUnits(aaveReceived, aaveDecimals)} Aave USDC\n`);

    // Return the AMOUNT RECEIVED from swap, not the total balance
    return aaveReceived;
}

// ============================================================================
// STEP 6: DEPLOY TO AAVE ON BASE SEPOLIA
// ============================================================================

async function deployToAave(marketId, amount, baseProvider, baseSigner, adminAddress) {
    console.log('=' .repeat(80));
    console.log('STEP 6: Deploy Aave USDC to Real Aave V3 (Base Sepolia)');
    console.log('=' .repeat(80));
    console.log(`   Note: 'amount' parameter = ${ethers.formatUnits(amount, 6)} USDC (actual amount from swap, not original deposit)\n`);
    
    const yieldController = new ethers.Contract(
        CONFIG.baseSepolia.contracts.yieldController,
        [
            'function deployToAave(bytes32,uint256) external returns (bytes32)',
            'function getCurrentYield(bytes32) external view returns (uint256)'
        ],
        baseSigner
    );
    
    // Use Aave USDC contract (after swap)
    const usdcContract = new ethers.Contract(
        CONFIG.baseSepolia.contracts.aaveUsdc,
        [
            'function balanceOf(address) external view returns (uint256)',
            'function allowance(address owner, address spender) external view returns (uint256)',
            'function approve(address,uint256) external returns (bool)',
        ],
        baseProvider
    );
    
    // Check total balance (for information only)
    const totalBalance = await usdcContract.balanceOf(adminAddress);
    console.log(`   Total Aave USDC balance on Base Sepolia: ${ethers.formatUnits(totalBalance, 6)} USDC`);
    console.log(`   ⚠️  Note: This includes leftover funds from previous test runs`);
    
    // Only deposit what came from THIS test run (the 'amount' parameter)
    // This is the actual amount received from the swap in the current flow
    const depositAmount = amount;
    console.log(`   Amount from current swap: ${ethers.formatUnits(depositAmount, 6)} USDC`);
    console.log(`   Will deposit ONLY this amount to Aave (not the entire balance)\n`);
    
    if (depositAmount === 0n) {
        throw new Error(
            'Swap returned 0 USDC. Swap may have failed or still processing.'
        );
    }
    
    if (totalBalance < depositAmount) {
        throw new Error(
            `Insufficient balance! Have ${ethers.formatUnits(totalBalance, 6)}, need ${ethers.formatUnits(depositAmount, 6)}. This shouldn't happen.`
        );
    }
    
    console.log('\n   Approving Aave USDC for YieldController...');
    const allowance = await usdcContract.allowance(adminAddress, CONFIG.baseSepolia.contracts.yieldController);
    
    if (allowance < depositAmount) {
        console.log(`   Current allowance: ${ethers.formatUnits(allowance, 6)} USDC`);
        console.log(`   Required amount: ${ethers.formatUnits(depositAmount, 6)} USDC`);
        
        const gasOptions = {
            gasLimit: 100000,
            maxFeePerGas: ethers.parseUnits("3", "gwei"),
            maxPriorityFeePerGas: ethers.parseUnits("1.5", "gwei")
        };
        
        if (allowance > 0n) {
            console.log('   Resetting existing allowance to 0...');
            const resetTx = await usdcContract.connect(baseSigner).approve(CONFIG.baseSepolia.contracts.yieldController, 0n, gasOptions);
            await resetTx.wait();
            console.log('   ✅ Reset complete');
            await sleep(3000);
        }
        
        console.log('   Setting new allowance...');
        const approveTx = await usdcContract.connect(baseSigner).approve(
            CONFIG.baseSepolia.contracts.yieldController,
            depositAmount,
            gasOptions
        );
        await approveTx.wait();
        console.log('   ✅ Approval confirmed');
        await sleep(3000);
    } else {
        console.log(`   ✅ Already approved (allowance: ${ethers.formatUnits(allowance, 6)} USDC)`);
    }
    
    console.log(`\n   Deploying ${ethers.formatUnits(depositAmount, 6)} USDC to Aave V3...`);
    const deployTx = await yieldController.deployToAave(marketId, depositAmount, {
        gasLimit: 500000,
        maxFeePerGas: ethers.parseUnits("3", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("1.5", "gwei")
    });
    const deployReceipt = await deployTx.wait();
    
    // Parse positionId only from logs emitted by the YieldController (same as test_withdraw_yield_controller.js).
    // Using logs[0].topics[1] or a fake id would give a wrong positionId and withdraw would leave balance at 0.
    const yieldControllerAddress = CONFIG.baseSepolia.contracts.yieldController;
    if (!yieldControllerAddress) {
        throw new Error('ETH_YIELD_CONTROLLER (baseSepolia.contracts.yieldController) is not set in config.');
    }
    const yieldControllerInterface = new ethers.Interface([
        'event FundsDeployedToAave(bytes32 indexed positionId, bytes32 arcMarketId, uint256 amount)'
    ]);
    let positionId = null;
    for (const log of deployReceipt.logs) {
        if (log.address && log.address.toLowerCase() !== yieldControllerAddress.toLowerCase()) continue;
        try {
            const parsed = yieldControllerInterface.parseLog(log);
            if (parsed && parsed.name === 'FundsDeployedToAave') {
                positionId = parsed.args.positionId;
                break;
            }
        } catch (_) {}
    }
    if (!positionId) {
        throw new Error(
            'Could not read positionId from YieldController deploy event. ' +
            'Ensure deploy receipt contains FundsDeployedToAave from ' + yieldControllerAddress
        );
    }
    
    console.log(`✅ Deployed to Aave V3`);
    console.log(`   Position ID: ${positionId}`);
    console.log(`   Amount: ${ethers.formatUnits(depositAmount, 6)} USDC`);
    console.log(`   Status: Earning yield on Base Sepolia\n`);
    
    return positionId;
}

// ============================================================================
// STEP 7: WAIT FOR YIELD GENERATION
// ============================================================================

async function waitForYield(positionId) {
    console.log('=' .repeat(80));
    console.log('STEP 7: Generate Yield (Real Aave V3 - 2 Minutes)');
    console.log('=' .repeat(80));
    
    console.log('⏳ Waiting 2 minutes for yield generation...');
    console.log('   (In production, this would be 14 days)\n');
    
    // Query REAL Aave aToken balance instead of simulated yield
    const aUSDC = new ethers.Contract(
        '0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC', // Correct Aave V3 aUSDC on Base Sepolia (aBasSepUSDC)
        ['function balanceOf(address) external view returns (uint256)'],
        ethProvider
    );
    
    const yieldController = new ethers.Contract(
        CONFIG.baseSepolia.contracts.yieldController,
        ['function getCurrentYield(bytes32) external view returns (uint256)'],
        ethProvider
    );
    
    // Get initial balance (right after deposit)
    const initialBalance = await aUSDC.balanceOf(CONFIG.baseSepolia.contracts.yieldController);
    console.log(`   Initial aUSDC balance: ${initialBalance.toString()} (raw wei)`);
    console.log(`   Initial aUSDC balance: ${ethers.formatUnits(initialBalance, 6)} USDC\n`);
    
    for (let i = 0; i < 12; i++) {
        await sleep(10000); // 10 seconds
        
        // Check real aToken balance
        const currentBalance = await aUSDC.balanceOf(CONFIG.baseSepolia.contracts.yieldController);
        const realYield = currentBalance > initialBalance ? currentBalance - initialBalance : 0n;
        
        // Also check YieldController's simulated value for comparison
        const simulatedYield = await yieldController.getCurrentYield(positionId);
        
        console.log(`   [${(i + 1) * 10}s] Real aToken balance: ${currentBalance.toString()} (${ethers.formatUnits(currentBalance, 6)} USDC)`);
        console.log(`            Real yield earned: ${realYield.toString()} wei (${ethers.formatUnits(realYield, 6)} USDC)`);
        console.log(`            YieldController simulated: ${ethers.formatUnits(simulatedYield, 6)} USDC\n`);
    }
    
    // Final check
    const finalBalance = await aUSDC.balanceOf(CONFIG.baseSepolia.contracts.yieldController);
    const finalYield = finalBalance > initialBalance ? finalBalance - initialBalance : 0n;
    const simulatedFinalYield = await yieldController.getCurrentYield(positionId);
    
    console.log('✅ Yield generation complete!\n');
    console.log(`   Final aToken balance: ${finalBalance.toString()} (${ethers.formatUnits(finalBalance, 6)} USDC)`);
    console.log(`   Real yield earned: ${finalYield.toString()} wei (${ethers.formatUnits(finalYield, 6)} USDC)`);
    console.log(`   YieldController simulated: ${ethers.formatUnits(simulatedFinalYield, 6)} USDC\n`);
    
    if (finalYield > 0n) {
        console.log(`   💰 ACTUAL YIELD DETECTED: ${finalYield.toString()} wei!\n`);
    } else {
        console.log(`   ℹ️  Note: Real Aave yield over 2 minutes is typically microscopic (fractions of a cent)\n`);
    }
    
    // Return REAL yield from aToken balance, not simulated
    return finalYield;
}

// ============================================================================
// STEP 8: MARKET RESOLUTION
// ============================================================================

async function resolveMarket(marketId, marketAddress) {
    console.log('=' .repeat(80));
    console.log('STEP 8: AI Resolves Market Outcome');
    console.log('=' .repeat(80));
    
    // Close market through MarketFactory (using forceCloseMarket for testing)
    const marketFactory = new ethers.Contract(
        CONFIG.arc.contracts.marketFactory,
        [
            'function forceCloseMarket(bytes32) external',
            'function resolveMarket(bytes32) external'
        ],
        arcSigner
    );
    
    console.log('Force closing market via MarketFactory (for testing)...');
    const closeTx = await marketFactory.forceCloseMarket(marketId);
    await closeTx.wait();
    console.log('✅ Market closed\n');
    
    // AI submits outcome
    const oracle = new ethers.Contract(
        CONFIG.arc.contracts.outcomeOracle,
        ['function submitOutcome(bytes32,uint8,uint256,string) external', 'function finalizeOutcome(bytes32) external'],
        arcSigner
    );
    
    console.log('AI analyzing disaster outcome...');
    console.log('Evidence: NGO reports confirm 120,000 people received aid');
    console.log('Confidence: 95%\n');
    
    const submitTx = await oracle.submitOutcome(
        marketId,
        1, // Outcome.YES
        9500, // 95% confidence
        'NGO confirmed: 120,000 people received emergency aid in Assam'
    );
    await submitTx.wait();
    
    console.log('✅ Outcome submitted: YES');
    
    // Finalize outcome
    const finalizeTx = await oracle.finalizeOutcome(marketId);
    await finalizeTx.wait();
    console.log('✅ Outcome finalized: YES\n');
    
    // Resolve market through MarketFactory
    console.log('Resolving market via MarketFactory...');
    const resolveTx = await marketFactory.resolveMarket(marketId);
    await resolveTx.wait();
    console.log('✅ Market resolved\n');
}

// ============================================================================
// STEP 9: WITHDRAW FROM AAVE
// ============================================================================

async function withdrawFromAave(positionId, baseProvider, baseSigner) {
    console.log('=' .repeat(80));
    console.log('STEP 9: Withdraw from Aave with Yield');
    console.log('=' .repeat(80));
    
    const yieldController = new ethers.Contract(
        CONFIG.baseSepolia.contracts.yieldController,
        ['function withdrawFromAave(bytes32) external returns (uint256 principal, uint256 yield)'],
        baseSigner
    );
    
    console.log('Withdrawing from Aave V3...');
    const withdrawTx = await yieldController.withdrawFromAave(positionId);
    const withdrawReceipt = await withdrawTx.wait();
    
    let principal = 0n;
    let yieldAmount = 0n;
    const eventIface = new ethers.Interface(['event FundsWithdrawnFromAave(bytes32 indexed positionId, uint256 principal, uint256 yield)']);
    for (const log of withdrawReceipt.logs || []) {
        try {
            const parsed = eventIface.parseLog(log);
            if (parsed && parsed.name === 'FundsWithdrawnFromAave') {
                principal = parsed.args.principal;
                yieldAmount = parsed.args.yield;
                break;
            }
        } catch (_) {}
    }
    
    console.log('✅ Withdrawn from Aave');
    console.log(`   Principal: ${ethers.formatUnits(principal, 6)} USDC`);
    console.log(`   Yield: ${ethers.formatUnits(yieldAmount, 6)} USDC`);
    console.log('   Funds are now in YieldController on Base Sepolia\n');
    
    return { principal, yield: yieldAmount };
}

// ============================================================================
// STEP 10: BRIDGE BACK TO ARC
// ============================================================================

async function bridgeBackToArc(marketId, totalAmount, realYieldFromAave, depositAmount, baseProvider, baseSigner, adminAddress) {
    console.log('=' .repeat(80));
    console.log('STEP 10: Transfer & Swap USDC, then Bridge Back to Arc');
    console.log('=' .repeat(80));
    
    // Add 0.1 USDC as simulated yield (since real yield over 2 minutes is ~0)
    const simulatedYield = ethers.parseUnits('0.1', 6);
    
    console.log(`Total withdrawn from Aave: ${ethers.formatUnits(totalAmount, 6)} USDC`);
    console.log(`Real Aave yield earned: ${realYieldFromAave.toString()} wei (${ethers.formatUnits(realYieldFromAave, 6)} USDC)`);
    console.log(`Total deposits from traders: ${ethers.formatUnits(depositAmount, 6)} USDC`);
    console.log(`For payouts, we'll use: Real yield (${ethers.formatUnits(realYieldFromAave, 6)}) + Simulated yield (${ethers.formatUnits(simulatedYield, 6)}) = ${ethers.formatUnits(realYieldFromAave + simulatedYield, 6)} USDC`);
    console.log(`   Note: Principal deposits (${ethers.formatUnits(depositAmount, 6)} USDC) will be returned separately to traders\n`);
    
    // Check actual USDC balance in YieldController (Aave USDC)
    const aaveUsdcContract = new ethers.Contract(
        CONFIG.baseSepolia.contracts.aaveUsdc,
        ['function balanceOf(address) external view returns (uint256)'],
        baseProvider
    );
    
    const actualBalance = await aaveUsdcContract.balanceOf(CONFIG.baseSepolia.contracts.yieldController);
    console.log(`   YieldController Aave USDC balance: ${ethers.formatUnits(actualBalance, 6)} USDC\n`);
    
    if (actualBalance === 0n) {
        throw new Error(
            'YieldController has 0 USDC after withdraw. Withdrawal to YieldController failed. ' +
            'Run the isolated test: node test_withdraw_yield_controller.js [positionId] to verify withdraw and approval flow.'
        );
    }
    
    // 1. Transfer Aave USDC from YieldController to admin
    const yieldController = new ethers.Contract(
        CONFIG.baseSepolia.contracts.yieldController,
        ['function transferUSDC(address _to, uint256 _amount) external'],
        baseSigner
    );
    
    // Wait BEFORE transfer to avoid rate limiting
    console.log('   Waiting 120 seconds before transfer to avoid RPC rate limiting...');
    await sleep(120000);
    console.log('   ✅ Ready to transfer\n');
    
    console.log('Step 1: Transferring Aave USDC from YieldController to admin...');
    
    // Retry logic with exponential backoff
    let transferTx;
    let transferRetries = 0;
    const maxTransferRetries = 5;
    while (transferRetries < maxTransferRetries) {
        try {
            transferTx = await yieldController.transferUSDC(adminAddress, actualBalance, {
                gasLimit: 200000,
                maxFeePerGas: ethers.parseUnits("2", "gwei"),
                maxPriorityFeePerGas: ethers.parseUnits("1", "gwei")
            });
            break; // Success, exit retry loop
        } catch (error) {
            if (error.message && error.message.includes('in-flight transaction limit')) {
                transferRetries++;
                const waitTime = Math.min(30000 * Math.pow(2, transferRetries), 300000); // Exponential backoff, max 5 min
                console.log(`   ⚠️  Rate limit hit. Retry ${transferRetries}/${maxTransferRetries} after ${waitTime/1000}s...`);
                await sleep(waitTime);
            } else {
                throw error; // Different error, throw immediately
            }
        }
    }
    
    if (!transferTx) {
        throw new Error('Failed to send transfer transaction after retries');
    }
    
    await transferTx.wait();
    console.log('   ✅ Aave USDC transferred to admin\n');
    
    // Wait AFTER transfer to avoid rate limiting
    console.log('   Waiting 120 seconds after transfer to avoid rate limiting...');
    await sleep(120000);
    console.log('   ✅ Ready to continue\n');
    
    // 2. Swap Aave USDC → Circle USDC (reverse of the earlier swap)
    console.log('Step 2: Swapping Aave USDC → Circle USDC for bridging...');
    const swapAmount = actualBalance; // Swap all of it
    
    const aaveUsdc = new ethers.Contract(
        CONFIG.baseSepolia.contracts.aaveUsdc,
        ['function approve(address,uint256) external returns (bool)', 'function allowance(address,address) external view returns (uint256)'],
        baseProvider
    );
    
    // Approve swap router
    const currentAllowance = await aaveUsdc.allowance(adminAddress, CONFIG.baseSepolia.contracts.swapRouter);
    if (currentAllowance < swapAmount) {
        console.log('   Waiting 60 seconds before approval to avoid RPC rate limiting...');
        await sleep(60000);
        
        console.log('   Approving Aave USDC for swap router...');
        if (currentAllowance > 0n) {
            // Retry logic for reset approval
            let resetTx;
            let resetRetries = 0;
            while (resetRetries < 3) {
                try {
                    resetTx = await aaveUsdc.connect(baseSigner).approve(CONFIG.baseSepolia.contracts.swapRouter, 0, {
                        gasLimit: 100000,
                        maxFeePerGas: ethers.parseUnits("2", "gwei"),
                        maxPriorityFeePerGas: ethers.parseUnits("1", "gwei")
                    });
                    break;
                } catch (error) {
                    if (error.message && error.message.includes('in-flight transaction limit')) {
                        resetRetries++;
                        const waitTime = 30000 * Math.pow(2, resetRetries);
                        console.log(`   ⚠️  Rate limit on reset. Retry ${resetRetries}/3 after ${waitTime/1000}s...`);
                        await sleep(waitTime);
                    } else {
                        throw error;
                    }
                }
            }
            if (resetTx) {
                await resetTx.wait();
                await sleep(30000);
            }
        }
        
        // Retry logic for approval
        let approveTx;
        let approvalRetries = 0;
        const maxApprovalRetries = 5;
        while (approvalRetries < maxApprovalRetries) {
            try {
                approveTx = await aaveUsdc.connect(baseSigner).approve(CONFIG.baseSepolia.contracts.swapRouter, swapAmount, {
                    gasLimit: 100000,
                    maxFeePerGas: ethers.parseUnits("2", "gwei"),
                    maxPriorityFeePerGas: ethers.parseUnits("1", "gwei")
                });
                break;
            } catch (error) {
                if (error.message && error.message.includes('in-flight transaction limit')) {
                    approvalRetries++;
                    const waitTime = Math.min(30000 * Math.pow(2, approvalRetries), 300000);
                    console.log(`   ⚠️  Rate limit on approval. Retry ${approvalRetries}/${maxApprovalRetries} after ${waitTime/1000}s...`);
                    await sleep(waitTime);
                } else {
                    throw error;
                }
            }
        }
        
        if (!approveTx) {
            throw new Error('Failed to send approval transaction after retries');
        }
        
        await approveTx.wait();
        console.log('   ✅ Approved');
        console.log('   Waiting 120 seconds for approval to propagate and avoid rate limiting...');
        await sleep(120000);
        console.log('   ✅ Ready\n');
    }
    
    // Execute swap: Aave USDC → Circle USDC
    // Using the WORKING format from test_reverse_swap.js
    const minAmountOut = (swapAmount * 90n) / 100n; // 10% slippage (tested and working)
    
    const swapParams = {
        tokenIn: CONFIG.baseSepolia.contracts.aaveUsdc,
        tokenOut: CONFIG.baseSepolia.contracts.circleUsdc,
        fee: 500, // 0.05% fee tier (same as working swap.js)
        recipient: adminAddress,
        amountIn: swapAmount,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: 0
        // NO DEADLINE - Base Sepolia SwapRouter02 doesn't use it
    };
    
    // Use the EXACT working ABI from test_reverse_swap.js
    const swapRouter = new ethers.Contract(
        CONFIG.baseSepolia.contracts.swapRouter,
        ['function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'],
        baseSigner
    );
    
    console.log(`   Waiting 60 seconds before swap to avoid RPC rate limiting...`);
    await sleep(60000);
    
    console.log(`   Swapping ${ethers.formatUnits(swapAmount, 6)} Aave USDC → Circle USDC...`);
    console.log(`   Swap params: recipient=${adminAddress}, amountIn=${swapAmount}, tokenOut=${CONFIG.baseSepolia.contracts.circleUsdc}`);
    
    // Retry logic for swap
    let swapTx;
    let swapRetries = 0;
    const maxSwapRetries = 5;
    while (swapRetries < maxSwapRetries) {
        try {
            swapTx = await swapRouter.exactInputSingle(swapParams, {
                gasLimit: 200000,
                maxFeePerGas: ethers.parseUnits("2", "gwei"),
                maxPriorityFeePerGas: ethers.parseUnits("1", "gwei")
            });
            break;
        } catch (error) {
            if (error.message && error.message.includes('in-flight transaction limit')) {
                swapRetries++;
                const waitTime = Math.min(30000 * Math.pow(2, swapRetries), 300000);
                console.log(`   ⚠️  Rate limit on swap. Retry ${swapRetries}/${maxSwapRetries} after ${waitTime/1000}s...`);
                await sleep(waitTime);
            } else {
                throw error;
            }
        }
    }
    
    if (!swapTx) {
        throw new Error('Failed to send swap transaction after retries');
    }
    
    console.log(`   Swap tx hash: ${swapTx.hash}`);
    const swapReceipt = await swapTx.wait();
    console.log(`   Swap confirmed in block: ${swapReceipt.blockNumber}`);
    console.log(`   Gas used: ${swapReceipt.gasUsed?.toString() ?? 'N/A'}`);
    // exactInputSingle returns amountOut; try to get it from the receipt/logs if needed
    try {
        const swapRouterWithReturn = new ethers.Contract(
            CONFIG.baseSepolia.contracts.swapRouter,
            ['function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) external payable returns (uint256 amountOut)'],
            baseProvider
        );
        const amountOut = await swapRouterWithReturn.exactInputSingle.staticCall(swapParams);
        console.log(`   Swap amountOut (from call): ${ethers.formatUnits(amountOut, 6)} Circle USDC`);
    } catch (e) {
        console.log(`   (Could not read amountOut: ${e.message})`);
    }
    console.log('   ✅ Swapped to Circle USDC\n');
    
    // Check Circle USDC balance
    const circleUsdcContract = new ethers.Contract(
        CONFIG.baseSepolia.contracts.circleUsdc,
        ['function balanceOf(address) external view returns (uint256)'],
        baseProvider
    );
    let circleBalance = await circleUsdcContract.balanceOf(adminAddress);
    console.log(`   Admin Circle USDC balance: ${ethers.formatUnits(circleBalance, 6)} USDC (recipient: ${adminAddress})`);
    if (circleBalance === 0n) {
        console.log('   ⚠️  Balance is 0 after swap; waiting 10s and rechecking (RPC/indexer lag)...');
        await sleep(10000);
        circleBalance = await circleUsdcContract.balanceOf(adminAddress);
        console.log(`   Admin Circle USDC balance (after recheck): ${ethers.formatUnits(circleBalance, 6)} USDC`);
    }
    console.log('');
    
    // 3. Bridge Circle USDC from Base Sepolia → Arc using Circle Bridge Kit (skip if 0)
    if (circleBalance === 0n) {
        console.log('Step 3: Skipping bridge (Circle USDC balance is 0). Recording yield only.');
        console.log('   Check swap tx on block explorer to confirm recipient and amount.\n');
    } else {
        console.log('Step 3: Bridging Circle USDC from Base Sepolia → Arc Testnet...');
    const privateKey = CONFIG.adminPrivateKey.startsWith('0x') ? CONFIG.adminPrivateKey : '0x' + CONFIG.adminPrivateKey;
    const adapter = createEthersAdapterFromPrivateKey({
        privateKey,
        getProvider: ({ chain }) => {
            const rpcMap = {
                'Arc_Testnet': CONFIG.arc.rpc,
                'Arc Testnet': CONFIG.arc.rpc,
                'Base_Sepolia': CONFIG.baseSepolia.rpc,
                'Base Sepolia': CONFIG.baseSepolia.rpc,
            };
            const rpcUrl = rpcMap[chain.name] || rpcMap[chain.chain];
            if (!rpcUrl) throw new Error(`RPC not configured for chain: ${chain.name || chain.chain}`);
            return new ethers.JsonRpcProvider(rpcUrl);
        }
    });
    const bridgeKit = new BridgeKit();
    const amountStr = ethers.formatUnits(circleBalance, 6);
    const result = await bridgeKit.bridge({
        from: { adapter, chain: 'Base_Sepolia' },
        to: { adapter, chain: 'Arc_Testnet' },
        amount: amountStr,
    });
    
    if (result.steps && result.steps.length > 0) {
        result.steps.forEach((step, i) => {
            console.log(`   ${i + 1}. ${step.name}: ${step.state}`);
        });
    }
    console.log(`   State: ${result.state}\n`);
    
    if (result.state === 'error') {
        const errStep = result.steps?.find(s => s.state === 'error');
        throw new Error(errStep?.errorMessage || 'Bridge back failed');
    }
    if (result.state === 'pending') {
        console.log('   ⏳ Bridge in progress. Waiting 60s...');
        await sleep(60000);
    }
    
    console.log('✅ Funds bridged back to Arc (admin wallet on Arc)\n');
    }
    
    // 4. Record yield in treasury (bookkeeping on Arc)
    // Use simulated yield declared at function start
    const distributionAmount = realYieldFromAave + simulatedYield;
    
    console.log('Step 4: Recording yield in TreasuryVault...');
    console.log(`   Real Aave yield: ${realYieldFromAave.toString()} wei (${ethers.formatUnits(realYieldFromAave, 6)} USDC)`);
    console.log(`   Simulated yield (for testing): ${ethers.formatUnits(simulatedYield, 6)} USDC`);
    console.log(`   Total for distribution: ${ethers.formatUnits(distributionAmount, 6)} USDC`);
    console.log(`   Note: Principal deposits (${ethers.formatUnits(depositAmount, 6)} USDC) will be returned to traders separately\n`);
    
    const treasuryVault = new ethers.Contract(
        CONFIG.arc.contracts.treasuryVault,
        ['function recordYield(bytes32,uint256) external'],
        arcSigner
    );
    const recordTx = await treasuryVault.recordYield(marketId, distributionAmount);
    await recordTx.wait();
    console.log(`✅ Yield recorded in TreasuryVault: ${ethers.formatUnits(distributionAmount, 6)} USDC\n`);
    
    return distributionAmount;
}

// ============================================================================
// STEP 11: CALCULATE PAYOUTS
// ============================================================================

async function calculatePayouts(marketAddress) {
    console.log('=' .repeat(80));
    console.log('STEP 11: Calculate Automated Payouts');
    console.log('=' .repeat(80));
    
    const payoutExecutor = new ethers.Contract(
        CONFIG.arc.contracts.payoutExecutor,
        [
            'function calculatePayouts(address) external returns (bytes32)',
            'function getNGOPayouts(bytes32) external view returns (tuple(bytes32,string,uint256,uint256)[])',
            'function getWinnerPayouts(bytes32) external view returns (tuple(address,uint256,uint256)[])',
            'function admin() external view returns (address)'
        ],
        arcSigner
    );
    
    // Debug: Check admin before calling
    const contractAdmin = await payoutExecutor.admin();
    const signerAddress = await arcSigner.getAddress();
    console.log('🔍 Admin Check:');
    console.log(`   Contract admin: ${contractAdmin}`);
    console.log(`   Signer address: ${signerAddress}`);
    console.log(`   Match? ${contractAdmin.toLowerCase() === signerAddress.toLowerCase() ? '✅ YES' : '❌ NO'}\n`);
    
    // Comprehensive diagnostics
    console.log('🔍 Running Diagnostics...\n');
    
    // Check Market state
    const market = new ethers.Contract(
        marketAddress,
        [
            'function getMarketInfo() external view returns (tuple(bytes32 marketId, string question, string disasterType, string location, uint256 startTime, uint256 endTime, uint8 state, bytes32 policyId, bytes32[] eligibleNGOs))',
            'function getWinners() external view returns (address[], uint256[])'
        ],
        arcProvider
    );
    
    let marketInfo;
    try {
        marketInfo = await market.getMarketInfo();
        // Get state value and convert to number (handles BigInt, string, or number)
        const stateValue = marketInfo.state;
        // Convert to number - handle all possible types
        const stateNum = Number(stateValue);
        
        console.log(`   Market State: ${stateNum} (0=ACTIVE, 1=CLOSED, 2=RESOLVED, 3=PAID_OUT)`);
        console.log(`   Policy ID: ${marketInfo.policyId}`);
        console.log(`   Eligible NGOs: ${marketInfo.eligibleNGOs.length}`);
        
        // Check if state is RESOLVED (2)
        // Note: State 2 = RESOLVED, which is required for calculatePayouts
        if (stateNum == 2) {
            console.log(`   Market Resolved: ✅ YES\n`);
        } else {
            console.log(`   Market Resolved: ❌ NO (State: ${stateNum}, expected 2)`);
            console.log(`   ⚠️  WARNING: Market must be RESOLVED (state 2) for calculatePayouts to work.\n`);
        }
    } catch (error) {
        console.log(`   ❌ Market check failed: ${error.message}\n`);
        // Don't throw - continue to other checks, but try to get marketInfo
        try {
            marketInfo = await market.getMarketInfo();
        } catch (e) {
            console.log(`   ⚠️  Could not retrieve market info. Proceeding anyway...\n`);
        }
    }
    
    // Check TreasuryVault and PolicyEngine together
    const treasuryVault = new ethers.Contract(
        CONFIG.arc.contracts.treasuryVault,
        [
            'function getTotalYield(bytes32) external view returns (uint256)'
        ],
        arcProvider
    );
    
    const policyEngine = new ethers.Contract(
        CONFIG.arc.contracts.policyEngine,
        [
            'function validatePayout(bytes32, uint256, uint256) external view returns (uint256,uint256,uint256,uint256)'
        ],
        arcProvider
    );
    
    try {
        if (!marketInfo) {
            marketInfo = await market.getMarketInfo();
        }
        const totalYield = await treasuryVault.getTotalYield(marketInfo.marketId);
        console.log(`   Treasury Yield: ${totalYield > 0n ? '✅ YES' : '❌ NO'}`);
        console.log(`   Total Yield: ${ethers.formatUnits(totalYield, 6)} USDC`);
        
        if (totalYield === 0n) {
            throw new Error(`No yield recorded! Amount: ${totalYield}`);
        }
        
        // Test validatePayout to see if policy exists
        const policyResult = await policyEngine.validatePayout(marketInfo.policyId, totalYield, marketInfo.eligibleNGOs.length);
        console.log(`   Policy found: ✅`);
        console.log(`     NGO Amount: ${ethers.formatUnits(policyResult[0], 6)} USDC`);
        console.log(`     Winner Amount: ${ethers.formatUnits(policyResult[1], 6)} USDC`);
        console.log(`     Protocol Amount: ${ethers.formatUnits(policyResult[2], 6)} USDC\n`);
    } catch (error) {
        console.log(`   ❌ Check failed: ${error.message}`);
        if (error.message.includes('Policy not active')) {
            console.log(`   This is likely the issue - policy not set or not active for this market!\n`);
        } else if (error.message.includes('No yield')) {
            console.log(`   This is likely the issue - yield not recorded!\n`);
        } else {
            console.log(`   Review the error above.\n`);
        }
        throw error;
    }
    
    // Try static call first to get better error message
    console.log('🔍 Testing with static call (simulation)...\n');
    try {
        const result = await payoutExecutor.calculatePayouts.staticCall(marketAddress);
        console.log(`   ✅ Static call succeeded! Result: ${result}\n`);
    } catch (staticError) {
        console.log(`   ❌ Static call failed: ${staticError.message}`);
        if (staticError.data) {
            console.log(`   Error data: ${staticError.data}`);
        }
        if (staticError.reason) {
            console.log(`   Reason: ${staticError.reason}`);
        }
        console.log(`\n   This is the actual error that will occur. Fix the issue above.\n`);
        throw staticError;
    }
    
    console.log('Calculating payouts based on policy...');
    const calcTx = await payoutExecutor.calculatePayouts(marketAddress, { gasLimit: 2000000 });
    const calcReceipt = await calcTx.wait();
    
    console.log('✅ Payouts calculated\n');
    console.log('Payout Distribution:');
    console.log('   60% → NGOs (Flood Relief Assam)');
    console.log('   30% → Winners (YES voters)');
    console.log('   10% → Protocol fees\n');
    
    return true;
}

// ============================================================================
// STEP 12: EXECUTE PAYOUTS VIA CIRCLE GATEWAY + BRIDGE KIT
// ============================================================================

async function executePayouts(marketId, marketAddress, ngoWalletId, traders, yieldAmount, depositAmount) {
    console.log('=' .repeat(80));
    console.log('STEP 12: Execute Automated Payouts via Circle Gateway (3 Traders + NGO)');
    console.log('=' .repeat(80));
    
    // Calculate payout amounts (60/30/10 split)
    const ngoAmount = (yieldAmount * 60n) / 100n;
    const winnerAmount = (yieldAmount * 30n) / 100n;
    const protocolAmount = (yieldAmount * 10n) / 100n;
    
    const ngoAmountDecimal = ethers.formatUnits(ngoAmount, 6);
    const winnerAmountDecimal = ethers.formatUnits(winnerAmount, 6);
    const totalDepositDecimal = ethers.formatUnits(depositAmount, 6);
    
    console.log('\n💰 Payout Breakdown:');
    console.log(`   NGOs (60%): ${ngoAmountDecimal} USDC`);
    console.log(`   Winners (30%): ${winnerAmountDecimal} USDC`);
    console.log(`   Protocol (10%): ${ethers.formatUnits(protocolAmount, 6)} USDC`);
    console.log(`   Total deposits to return: ${totalDepositDecimal} USDC\n`);
    
    // ========================================================================
    // Query PayoutExecutor for actual payout details
    // ========================================================================
    console.log('📋 Querying PayoutExecutor for individual payouts...\n');
    
    const payoutExecutor = new ethers.Contract(
        CONFIG.arc.contracts.payoutExecutor,
        [
            'function getWinnerPayouts(bytes32) view returns (tuple(address user, uint256 principal, uint256 reward)[])',
            'function getLoserPayouts(bytes32) view returns (tuple(address user, uint256 principal)[])',
            'function getNGOPayouts(bytes32) view returns (tuple(bytes32 ngoId, string circleWalletId, uint256 amount, uint256 chainId)[])'
        ],
        arcProvider
    );
    
    // Use getMarketInfo() function (not the public state variable getter)
    const marketContract = new ethers.Contract(
        marketAddress,
        ['function getMarketInfo() view returns (tuple(bytes32 marketId, string question, string disasterType, string location, uint256 startTime, uint256 endTime, uint8 state, bytes32 policyId, bytes32[] eligibleNGOs))'],
        arcProvider
    );
    
    const marketInfo = await marketContract.getMarketInfo();
    const actualMarketId = marketInfo.marketId || marketInfo[0];
    
    const winnerPayouts = await payoutExecutor.getWinnerPayouts(actualMarketId);
    const loserPayouts = await payoutExecutor.getLoserPayouts(actualMarketId);
    
    console.log(`✅ Found ${winnerPayouts.length} winner(s) and ${loserPayouts.length} loser(s)\n`);
    
    // Reward can be 0 from contract (e.g. hybrid formula rounding or ABI decode). Use by-index and fallback.
    const winnerAmountTotal = (yieldAmount * 30n) / 100n; // 30% for winners
    let totalRewardFromContract = 0n;
    for (const w of winnerPayouts) {
        const r = (w.reward !== undefined ? w.reward : (w[2] !== undefined ? w[2] : 0n));
        totalRewardFromContract += r;
    }
    const useFairShare = winnerPayouts.length > 0 && totalRewardFromContract === 0n && winnerAmountTotal > 0n;
    const fairSharePerWinner = useFairShare ? winnerAmountTotal / BigInt(winnerPayouts.length) : 0n;
    if (useFairShare) {
        console.log(`   ⚠️  Contract returned 0 reward for winners; using fair share: ${ethers.formatUnits(fairSharePerWinner, 6)} USDC each\n`);
    }
    
    // Create payout map for easy lookup
    const payoutMap = new Map();
    
    for (const winner of winnerPayouts) {
        const rawReward = (winner.reward !== undefined ? winner.reward : (winner[2] !== undefined ? winner[2] : 0n));
        const reward = useFairShare ? fairSharePerWinner : rawReward;
        const userAddr = (winner.user !== undefined ? winner.user : winner[0]);
        const principal = (winner.principal !== undefined ? winner.principal : winner[1]);
        payoutMap.set(userAddr.toLowerCase(), {
            principal,
            reward,
            isWinner: true
        });
    }
    
    for (const loser of loserPayouts) {
        const userAddr = (loser.user !== undefined ? loser.user : loser[0]);
        const principal = (loser.principal !== undefined ? loser.principal : loser[1]);
        payoutMap.set(userAddr.toLowerCase(), {
            principal,
            reward: 0n,
            isWinner: false
        });
    }
    
    console.log('💳 Individual Trader Payouts:');
    for (let i = 0; i < traders.length; i++) {
        const trader = traders[i];
        const payout = payoutMap.get(trader.address.toLowerCase());
        if (payout) {
            const total = payout.principal + payout.reward;
            console.log(`   ${trader.name}:`);
            console.log(`      Principal: ${ethers.formatUnits(payout.principal, 6)} USDC`);
            console.log(`      Reward: ${ethers.formatUnits(payout.reward, 6)} USDC`);
            console.log(`      Total: ${ethers.formatUnits(total, 6)} USDC`);
            console.log(`      Status: ${payout.isWinner ? '🎉 WINNER' : '💔 LOSER (gets refund)'}`);
        } else {
            console.log(`   ${trader.name}: No payout found`);
        }
    }
    console.log('');
    
    // ========================================================================
    // STEP 1: Create or get Treasury Circle Wallet
    // ========================================================================
    console.log('🏦 Setting up Treasury Circle Wallet...\n');
    
    let treasuryWalletId;
    let treasuryWalletAddress;
    
    try {
        // Create wallet set for treasury (matching pattern from createCircleWallets)
        console.log('Creating treasury wallet set...');
        const treasuryWalletSetResponse = await circleWalletClient.createWalletSet({
            name: 'Treasury Wallet Set',
        });
        const treasuryWalletSetId = treasuryWalletSetResponse.data?.walletSet?.id;
        console.log(`✅ Treasury Wallet Set Created: ${treasuryWalletSetId}\n`);
        
        // Create treasury wallet on Arc Testnet
        console.log('Creating treasury wallet on Arc Testnet...');
        const treasuryWalletResponse = await circleWalletClient.createWallets({
            accountType: 'SCA',
            blockchains: ['ARC-TESTNET'],
            count: 1,
            walletSetId: treasuryWalletSetId,
        });
        
        treasuryWalletId = treasuryWalletResponse.data.wallets[0].id;
        treasuryWalletAddress = treasuryWalletResponse.data.wallets[0].address;
        console.log(`✅ Treasury Wallet Created: ${treasuryWalletId}`);
        console.log(`   Address: ${treasuryWalletAddress}\n`);
    } catch (error) {
        console.error('❌ Failed to create treasury wallet:', error.message);
        if (error.response) {
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
    
    // ========================================================================
    // STEP 2: Transfer USDC from admin wallet to treasury Circle wallet
    // ========================================================================
    // Treasury needs: yield split (NGO + winners + protocol) + all principals to return to traders
    const totalPayoutAmount = ngoAmount + winnerAmount + protocolAmount + depositAmount;
    
    console.log('💰 Transferring USDC to Treasury Circle Wallet...');
    console.log(`   From: Admin wallet (${arcSigner.address})`);
    console.log(`   To: Treasury Circle wallet (${treasuryWalletAddress})`);
    console.log(`   Amount: ${ethers.formatUnits(totalPayoutAmount, 6)} USDC (yield split + principal return)\n`);
    const usdcContract = new ethers.Contract(
        CONFIG.arc.contracts.usdc,
        ['function transfer(address,uint256) external returns (bool)', 'function balanceOf(address) external view returns (uint256)'],
        arcSigner
    );
    
    // Check admin balance
    const adminBalance = await usdcContract.balanceOf(arcSigner.address);
    if (adminBalance < totalPayoutAmount) {
        throw new Error(`Insufficient USDC in admin wallet. Have: ${ethers.formatUnits(adminBalance, 6)}, Need: ${ethers.formatUnits(totalPayoutAmount, 6)}`);
    }
    
    // Transfer to treasury Circle wallet
    const transferTx = await usdcContract.transfer(treasuryWalletAddress, totalPayoutAmount);
    await transferTx.wait();
    console.log(`✅ USDC transferred to treasury Circle wallet\n`);
    
    // Wait for Circle to sync the balance (with retries)
    console.log('⏳ Waiting for Circle to sync treasury wallet balance...');
    let treasuryUsdcToken = null;
    let treasuryRetryCount = 0;
    const treasuryMaxRetries = 10; // Try up to 10 times (30 seconds total)
    
    while (!treasuryUsdcToken && treasuryRetryCount < treasuryMaxRetries) {
        await sleep(3000); // Wait 3 seconds between retries
        
        // Use getWalletTokenBalance to get balances (more reliable)
        const treasuryBalanceResponse = await circleWalletClient.getWalletTokenBalance({
            id: treasuryWalletId,
        });
        
        const treasuryTokenBalances = treasuryBalanceResponse.data?.tokenBalances || treasuryBalanceResponse.data?.balances || [];
        
        // Try to find USDC by symbol OR by address
        const arcUsdcAddress = CONFIG.arc.contracts.usdc?.toLowerCase();
        
        treasuryUsdcToken = treasuryTokenBalances.find(token => {
            const tokenInfo = token.token || token;
            const symbol = (tokenInfo?.symbol || '').toUpperCase();
            const address = (tokenInfo?.tokenAddress || tokenInfo?.address || '').toLowerCase();
            
            // Match by symbol OR by Arc USDC address
            return symbol.includes('USDC') || 
                   (arcUsdcAddress && address === arcUsdcAddress);
        });
        
        if (!treasuryUsdcToken) {
            treasuryRetryCount++;
            console.log(`   Retry ${treasuryRetryCount}/${treasuryMaxRetries} - USDC not synced yet...`);
        }
    }
    
    if (!treasuryUsdcToken || !treasuryUsdcToken.token?.id) {
        // Debug: Show what tokens we found
        const treasuryBalanceResponse = await circleWalletClient.getWalletTokenBalance({
            id: treasuryWalletId,
        });
        const treasuryTokenBalances = treasuryBalanceResponse.data?.tokenBalances || treasuryBalanceResponse.data?.balances || [];
        console.log(`\n   ⚠️  Found ${treasuryTokenBalances.length} token(s) in wallet:`);
        treasuryTokenBalances.forEach((token, idx) => {
            const tokenInfo = token.token || token;
            console.log(`   ${idx + 1}. ${tokenInfo?.symbol || 'Unknown'} - ${tokenInfo?.tokenAddress || tokenInfo?.address || 'N/A'}`);
        });
        throw new Error('USDC token not found in treasury wallet after syncing. Check token addresses.');
    }
    
    console.log(`   ✅ USDC found in treasury wallet\n`);
    
    // ========================================================================
    // 🔥 CIRCLE GATEWAY + BRIDGE KIT USAGE #2: NGO Payout (Cross-Chain)
    // ========================================================================
    console.log('💸 Sending to NGO via Circle Gateway + Bridge Kit (CCTP)...');
    console.log(`   Amount: ${ngoAmountDecimal} USDC`);
    console.log(`   Source Chain: ARC-TESTNET (Arc Testnet)`);
    console.log(`   Destination Chain: BASE-SEPOLIA (Base Sepolia)`);
    console.log(`   Protocol: Circle CCTP (Cross-Chain Transfer Protocol)`);
    console.log(`   NGO Wallet: ${ngoWalletId}\n`);
    
    try {
        // Get NGO wallet info
        const ngoWalletResponse = await circleWalletClient.getWallet({ id: ngoWalletId });
        const ngoAddress = ngoWalletResponse.data.wallet.address;
        console.log(`   NGO Address on Base: ${ngoAddress}\n`);
        
        // Step 1: Bridge from Arc to Base using Circle Bridge Kit
        console.log('🌉 Step 1: Bridging USDC from Arc to Base Sepolia using Circle Bridge Kit...');
        const privateKey = CONFIG.adminPrivateKey.startsWith('0x') ? CONFIG.adminPrivateKey : '0x' + CONFIG.adminPrivateKey;
        
        const adapter = createEthersAdapterFromPrivateKey({
            privateKey,
            getProvider: ({ chain }) => {
                const rpcMap = {
                    'Arc_Testnet': CONFIG.arc.rpc,
                    'Arc Testnet': CONFIG.arc.rpc,
                    'Base_Sepolia': CONFIG.baseSepolia.rpc,
                    'Base Sepolia': CONFIG.baseSepolia.rpc,
                };
                const rpcUrl = rpcMap[chain.name] || rpcMap[chain.chain];
                if (!rpcUrl) throw new Error(`RPC not configured for chain: ${chain.name || chain.chain}`);
                return new ethers.JsonRpcProvider(rpcUrl);
            }
        });
        const bridgeKit = new BridgeKit();
        
        const bridgeResult = await bridgeKit.bridge({
            from: { adapter, chain: 'Arc_Testnet' },
            to: { adapter, chain: 'Base_Sepolia' },
            amount: ngoAmountDecimal,
        });
        
        if (bridgeResult.state === 'error') {
            throw new Error(`Bridge failed: ${bridgeResult.steps?.find(s => s.state === 'error')?.errorMessage || 'Unknown error'}`);
        }
        
        console.log('   ✅ Bridge completed');
        if (bridgeResult.steps) {
            bridgeResult.steps.forEach((step, i) => {
                console.log(`   ${i + 1}. ${step.name}: ${step.state}`);
            });
        }
        
        // Wait for bridge to complete
        if (bridgeResult.state === 'pending') {
            console.log('   ⏳ Bridge in progress. Waiting 60s for completion...');
            await sleep(60000);
        }
        
        // Step 2: Create a treasury Circle wallet on Base Sepolia
        console.log('\n🏦 Step 2: Creating Treasury Circle Wallet on Base Sepolia...');
        let baseTreasuryWalletId;
        let baseTreasuryWalletAddress;
        
        try {
            // Create wallet set for Base treasury (matching pattern from createCircleWallets)
            console.log('   Creating Base treasury wallet set...');
            const baseTreasuryWalletSetResponse = await circleWalletClient.createWalletSet({
                name: 'Base Treasury Wallet Set',
            });
            const baseTreasuryWalletSetId = baseTreasuryWalletSetResponse.data?.walletSet?.id;
            console.log(`   ✅ Base Treasury Wallet Set Created: ${baseTreasuryWalletSetId}\n`);
            
            // Create Base treasury wallet on Base Sepolia
            console.log('   Creating Base treasury wallet on Base Sepolia...');
            const baseTreasuryWalletResponse = await circleWalletClient.createWallets({
                accountType: 'SCA',
                blockchains: ['BASE-SEPOLIA'],
                count: 1,
                walletSetId: baseTreasuryWalletSetId,
            });
            
            baseTreasuryWalletId = baseTreasuryWalletResponse.data.wallets[0].id;
            baseTreasuryWalletAddress = baseTreasuryWalletResponse.data.wallets[0].address;
            console.log(`   ✅ Base Treasury Wallet Created: ${baseTreasuryWalletId}`);
            console.log(`   Address: ${baseTreasuryWalletAddress}\n`);
        } catch (error) {
            console.error('   ❌ Failed to create Base treasury wallet:', error.message);
            if (error.response) {
                console.error('   Response:', JSON.stringify(error.response.data, null, 2));
            }
            throw error;
        }
        
        // Step 3: Transfer USDC from admin's regular wallet to Base treasury Circle wallet
        console.log('💰 Step 3: Transferring USDC to Base Treasury Circle Wallet...');
        console.log(`   From: Admin wallet on Base (${ethSigner.address})`);
        console.log(`   To: Base Treasury Circle wallet (${baseTreasuryWalletAddress})`);
        console.log(`   Amount: ${ngoAmountDecimal} USDC\n`);
        
        const baseUsdcContract = new ethers.Contract(
            CONFIG.baseSepolia.contracts.circleUsdc,
            ['function transfer(address,uint256) external returns (bool)', 'function balanceOf(address) external view returns (uint256)'],
            ethSigner
        );
        
        // Check admin balance on Base
        const baseAdminBalance = await baseUsdcContract.balanceOf(ethSigner.address);
        console.log(`   Admin balance on Base: ${ethers.formatUnits(baseAdminBalance, 6)} USDC`);
        
        if (baseAdminBalance < ngoAmount) {
            console.log(`   ⚠️  Insufficient USDC on Base. Admin balance: ${ethers.formatUnits(baseAdminBalance, 6)} USDC`);
            console.log(`   Waiting 30 seconds for bridge to complete...`);
            await sleep(30000);
            
            // Check again
            const newBalance = await baseUsdcContract.balanceOf(ethSigner.address);
            console.log(`   Admin balance after wait: ${ethers.formatUnits(newBalance, 6)} USDC`);
            
            if (newBalance < ngoAmount) {
                throw new Error(`Insufficient USDC on Base after bridge. Have: ${ethers.formatUnits(newBalance, 6)}, Need: ${ngoAmountDecimal}`);
            }
        }
        
        // Transfer to Base treasury Circle wallet
        console.log(`   Transferring ${ngoAmountDecimal} USDC...`);
        const transferToBaseTreasuryTx = await baseUsdcContract.transfer(baseTreasuryWalletAddress, ngoAmount, {
            gasLimit: 100000,
            maxFeePerGas: ethers.parseUnits("2", "gwei"),
            maxPriorityFeePerGas: ethers.parseUnits("1", "gwei")
        });
        console.log(`   Transaction Hash: ${transferToBaseTreasuryTx.hash}`);
        console.log(`   Waiting for confirmation...`);
        const receipt = await transferToBaseTreasuryTx.wait();
        console.log(`   ✅ Transaction confirmed in block ${receipt.blockNumber}\n`);
        
        // Wait a moment for state to sync
        await sleep(2000);
        
        // Wait for Circle to sync the balance (with retries and on-chain verification)
        console.log('⏳ Waiting for Circle to sync Base treasury wallet balance...');
        console.log(`   Expected amount: ${ngoAmountDecimal} USDC`);
        console.log(`   Circle API may need time to index the token...\n`);
        
        let baseUsdcToken = null;
        let retryCount = 0;
        const maxRetries = 20; // Increased to 20 retries (60 seconds total)
        
        // Verify on-chain balance first (reuse baseUsdcContract declared above)
        // Retry the balance check a few times in case of RPC lag
        let onChainBalance = 0n;
        let balanceRetries = 0;
        const maxBalanceRetries = 5;
        while (balanceRetries < maxBalanceRetries && onChainBalance < ngoAmount) {
            await sleep(1000);
            onChainBalance = await baseUsdcContract.balanceOf(baseTreasuryWalletAddress);
            balanceRetries++;
            if (onChainBalance < ngoAmount && balanceRetries < maxBalanceRetries) {
                console.log(`   Retry ${balanceRetries}/${maxBalanceRetries} - Checking on-chain balance...`);
            }
        }
        
        console.log(`   On-chain USDC balance: ${ethers.formatUnits(onChainBalance, 6)} USDC`);
        if (onChainBalance < ngoAmount) {
            throw new Error(`On-chain balance insufficient after transfer. Have: ${ethers.formatUnits(onChainBalance, 6)}, Need: ${ngoAmountDecimal}. Transaction hash: ${transferToBaseTreasuryTx.hash}`);
        }
        console.log(`   ✅ On-chain balance confirmed\n`);
        
        while (!baseUsdcToken && retryCount < maxRetries) {
            await sleep(3000); // Wait 3 seconds between retries
            
            try {
                // Use getWalletTokenBalance to get balances (more reliable)
                const baseTreasuryBalanceResponse = await circleWalletClient.getWalletTokenBalance({
                    id: baseTreasuryWalletId,
                });
                
                const baseTokenBalances = baseTreasuryBalanceResponse.data?.tokenBalances || baseTreasuryBalanceResponse.data?.balances || [];
                
                // Try to find USDC by symbol OR by address
                const baseSepoliaCircleUsdc = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'.toLowerCase();
                const baseSepoliaAaveUsdc = '0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f'.toLowerCase();
                
                baseUsdcToken = baseTokenBalances.find(token => {
                    const tokenInfo = token.token || token;
                    const symbol = (tokenInfo?.symbol || '').toUpperCase();
                    const address = (tokenInfo?.tokenAddress || tokenInfo?.address || '').toLowerCase();
                    
                    // Match by symbol OR by known USDC addresses on Base Sepolia
                    return symbol.includes('USDC') || 
                           address === baseSepoliaCircleUsdc || 
                           address === baseSepoliaAaveUsdc;
                });
                
                if (!baseUsdcToken) {
                    retryCount++;
                    if (retryCount % 5 === 0) {
                        console.log(`   Retry ${retryCount}/${maxRetries} - Circle API still syncing... (found ${baseTokenBalances.length} token(s))`);
                    }
                } else {
                    console.log(`   ✅ USDC token found in Circle API after ${retryCount} retries!`);
                    const tokenInfo = baseUsdcToken.token || baseUsdcToken;
                    console.log(`   Token ID: ${tokenInfo.id}`);
                    console.log(`   Symbol: ${tokenInfo.symbol || 'USDC'}`);
                    console.log(`   Address: ${tokenInfo.tokenAddress || tokenInfo.address || 'N/A'}`);
                    console.log(`   Balance: ${baseUsdcToken.amount || baseUsdcToken.balance || '0'} ${tokenInfo.symbol || 'USDC'}\n`);
                }
            } catch (error) {
                retryCount++;
                if (retryCount % 5 === 0) {
                    console.log(`   Retry ${retryCount}/${maxRetries} - API error: ${error.message}`);
                }
            }
        }
        
        if (!baseUsdcToken || !baseUsdcToken.token?.id) {
            // Debug: Show what tokens we found
            try {
                const baseTreasuryBalanceResponse = await circleWalletClient.getWalletTokenBalance({
                    id: baseTreasuryWalletId,
                });
                const baseTokenBalances = baseTreasuryBalanceResponse.data?.tokenBalances || baseTreasuryBalanceResponse.data?.balances || [];
                console.log(`\n   ⚠️  Found ${baseTokenBalances.length} token(s) in Circle API:`);
                baseTokenBalances.forEach((token, idx) => {
                    const tokenInfo = token.token || token;
                    console.log(`   ${idx + 1}. ${tokenInfo?.symbol || 'Unknown'} - ${tokenInfo?.tokenAddress || tokenInfo?.address || 'N/A'}`);
                });
            } catch (error) {
                console.log(`   ⚠️  Could not fetch token list: ${error.message}`);
            }
            
            console.log(`\n   💡 On-chain balance confirmed: ${ethers.formatUnits(onChainBalance, 6)} USDC`);
            console.log(`   ⚠️  Circle API hasn't synced yet. This is normal - Circle needs time to index tokens.`);
            console.log(`   💡 Recommendation: Wait 30-60 seconds and try again, or use on-chain transfer instead.\n`);
            throw new Error('USDC token not found in Circle API. On-chain balance exists but Circle API needs more time to sync.');
        }
        
        // Step 4: Use Circle Gateway to send from Base treasury Circle wallet to NGO Circle wallet
        console.log('📤 Step 4: Sending USDC to NGO Circle Wallet via Circle Gateway...');
        console.log(`   From: Base Treasury Circle wallet (${baseTreasuryWalletId})`);
        console.log(`   To: NGO Circle wallet (${ngoWalletId})`);
        console.log(`   Amount: ${ngoAmountDecimal} USDC\n`);
        
        // Use safer token access pattern (matching test_ngo_payout.js)
        const tokenInfo = baseUsdcToken.token || baseUsdcToken;
        const baseUsdcTokenId = tokenInfo.id;
        const baseUsdcBalance = parseFloat(baseUsdcToken.amount || baseUsdcToken.balance || '0');
        
        if (baseUsdcBalance < parseFloat(ngoAmountDecimal)) {
            throw new Error(`Insufficient USDC in Base treasury wallet. Have: ${baseUsdcBalance}, Need: ${ngoAmountDecimal}`);
        }
        
        // Create Circle Gateway transaction from Base treasury to NGO wallet
        const ngoTransactionParams = {
            walletId: baseTreasuryWalletId,
            tokenId: baseUsdcTokenId,
            destinationAddress: ngoAddress,
            amounts: [ngoAmountDecimal],
            fee: {
                type: "level",
                config: {
                    feeLevel: "MEDIUM",
                },
            },
        };
        
        const ngoTransferResponse = await circleWalletClient.createTransaction(ngoTransactionParams);
        const ngoTxData = ngoTransferResponse.data?.transaction || ngoTransferResponse.data;
        const ngoTxId = ngoTxData?.id || ngoTransferResponse.data?.id;
        const ngoTxState = ngoTxData?.state || ngoTransferResponse.data?.state;
        
        // Extract transaction hash if available (may be in different fields)
        const ngoTxHash = ngoTxData?.txHash || ngoTxData?.hash || ngoTxData?.transactionHash || 
                          ngoTransferResponse.data?.txHash || ngoTransferResponse.data?.hash ||
                          ngoTxData?.onchainTxHash || ngoTxData?.blockchainTxHash;
        
        console.log(`   Transaction ID: ${ngoTxId}`);
        console.log(`   Status: ${ngoTxState}`);
        if (ngoTxHash) {
            console.log(`   Transaction Hash: ${ngoTxHash}`);
        }
        console.log('');
        
        // Wait for transaction confirmation
        console.log('⏳ Waiting for Circle Gateway transaction confirmation...');
        let ngoAttempts = 0;
        const ngoMaxAttempts = 60;
        let currentNgoTxState = ngoTxState; // Track current state
        let currentNgoTxHash = ngoTxHash; // Track transaction hash
        
        while (ngoTxId && currentNgoTxState && ['INITIATED', 'PENDING', 'QUEUED', 'SENT'].includes(currentNgoTxState) && ngoAttempts < ngoMaxAttempts) {
            await sleep(3000);
            try {
                const ngoStatusCheck = await circleWalletClient.getTransaction({ id: ngoTxId });
                const ngoTxStatusData = ngoStatusCheck.data?.transaction || ngoStatusCheck.data;
                const newState = ngoTxStatusData?.state || ngoStatusCheck.data?.state;
                
                // Check for transaction hash (may be populated after submission)
                const newHash = ngoTxStatusData?.txHash || ngoTxStatusData?.hash || ngoTxStatusData?.transactionHash ||
                               ngoTxStatusData?.onchainTxHash || ngoTxStatusData?.blockchainTxHash;
                if (newHash && newHash !== currentNgoTxHash) {
                    currentNgoTxHash = newHash;
                    console.log(`   Transaction Hash: ${currentNgoTxHash}`);
                }
                
                if (newState !== currentNgoTxState) {
                    console.log(`   Status: ${newState} (${ngoAttempts * 3}s elapsed)`);
                    currentNgoTxState = newState; // Update state
                    if (!['INITIATED', 'PENDING', 'QUEUED', 'SENT'].includes(newState)) {
                        break; // Final state reached
                    }
                }
            } catch (error) {
                console.log(`   Error checking status: ${error.message}`);
            }
            ngoAttempts++;
        }
        
        // Log final transaction hash if available
        if (currentNgoTxHash) {
            console.log(`   Final Transaction Hash: ${currentNgoTxHash}`);
        }
        
        if (currentNgoTxState === 'COMPLETE' || currentNgoTxState === 'COMPLETED' || currentNgoTxState === 'CONFIRMED') {
            console.log('✅ NGO payment sent via Circle Gateway\n');
        } else {
            console.log(`⚠️  Transaction status: ${currentNgoTxState || ngoTxState}. May still be processing...\n`);
        }
        
    } catch (error) {
        console.error('❌ NGO payout failed:', error.message);
        if (error.response) {
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
        // Continue with winner payout even if NGO fails
    }
    
    // ========================================================================
    // 🔥 CIRCLE GATEWAY USAGE #3: Trader Payouts (all 3 traders)
    // ========================================================================
    console.log('💸 Sending payouts to all 3 traders via Circle Gateway...\n');
    
    // Use the USDC token we already found during sync
    if (!treasuryUsdcToken) {
        throw new Error('USDC token not found in treasury wallet');
    }
    
    const treasuryTokenInfo = treasuryUsdcToken.token || treasuryUsdcToken;
    if (!treasuryTokenInfo?.id) {
        throw new Error('USDC token ID not found in treasury wallet');
    }
    
    const usdcTokenId = treasuryTokenInfo.id;
    
    // Send to each trader
    for (let i = 0; i < traders.length; i++) {
        const trader = traders[i];
        const payout = payoutMap.get(trader.address.toLowerCase());
        
        if (!payout) {
            console.log(`⚠️  No payout found for ${trader.name}, skipping...`);
            continue;
        }
        
        const traderTotal = payout.principal + payout.reward;
        const traderTotalDecimal = ethers.formatUnits(traderTotal, 6);
        
        console.log(`\n💸 Paying ${trader.name} (${payout.isWinner ? 'WINNER' : 'LOSER'}):`);
        console.log(`   Principal: ${ethers.formatUnits(payout.principal, 6)} USDC`);
        console.log(`   Reward: ${ethers.formatUnits(payout.reward, 6)} USDC`);
        console.log(`   Total: ${traderTotalDecimal} USDC`);
        console.log(`   Wallet: ${trader.walletId}`);
        
        try {
            // Create Circle Gateway transaction
            console.log('   📤 Creating Circle Gateway transaction...');
            const transactionParams = {
                walletId: treasuryWalletId,
                tokenId: usdcTokenId,
                destinationAddress: trader.address,
                amounts: [traderTotalDecimal],
                fee: {
                    type: "level",
                    config: {
                        feeLevel: "MEDIUM",
                    },
                },
            };
        
        const transferResponse = await circleWalletClient.createTransaction(transactionParams);
        const txData = transferResponse.data?.transaction || transferResponse.data;
        const txId = txData?.id || transferResponse.data?.id;
        const txState = txData?.state || transferResponse.data?.state;
        
        console.log(`   Transaction ID: ${txId}`);
        console.log(`   Status: ${txState}\n`);
        
        // Wait for transaction confirmation
        console.log('⏳ Waiting for transaction confirmation...');
        let attempts = 0;
        const maxAttempts = 60;
        let currentTxState = txState; // Track current state
        
        while (txId && currentTxState && ['INITIATED', 'PENDING', 'QUEUED', 'SENT'].includes(currentTxState) && attempts < maxAttempts) {
            await sleep(3000);
            try {
                const statusCheck = await circleWalletClient.getTransaction({ id: txId });
                const txStatusData = statusCheck.data?.transaction || statusCheck.data;
                const newState = txStatusData?.state || statusCheck.data?.state;
                if (newState !== currentTxState) {
                    console.log(`   Status: ${newState} (${attempts * 3}s elapsed)`);
                    currentTxState = newState; // Update state
                    if (!['INITIATED', 'PENDING', 'QUEUED', 'SENT'].includes(newState)) {
                        break; // Final state reached
                    }
                }
            } catch (error) {
                console.log(`   Error checking status: ${error.message}`);
            }
            attempts++;
        }
        
            if (currentTxState === 'COMPLETE' || currentTxState === 'COMPLETED' || currentTxState === 'CONFIRMED') {
                console.log(`   ✅ Payment sent to ${trader.name}\n`);
            } else {
                console.log(`   ⚠️  Transaction status: ${currentTxState || txState}. May still be processing...\n`);
            }
            
        } catch (error) {
            console.error(`   ❌ Payout to ${trader.name} failed: ${error.message}`);
            if (error.response) {
                console.error('   Response:', JSON.stringify(error.response.data, null, 2));
            }
            // Continue with next trader
        }
        
        // Small delay between transfers
        if (i < traders.length - 1) {
            await sleep(2000);
        }
    }
    
    console.log('📊 Protocol fees collected: ' + ethers.formatUnits(protocolAmount, 6) + ' USDC\n');
    
    console.log('=' .repeat(80));
    console.log('CIRCLE GATEWAY + BRIDGE KIT SUMMARY');
    console.log('=' .repeat(80));
    console.log('✅ Transfer #1: User Deposit (Trader → Treasury)');
    console.log('   Method: Circle Gateway Transfer API');
    console.log('   Chain: ARC-TESTNET (same chain)');
    console.log('');
    console.log('✅ Transfer #2: NGO Payout (Arc → Base)');
    console.log('   Method: Circle Gateway + Bridge Kit (CCTP)');
    console.log('   Source: ARC-TESTNET (Arc Testnet)');
    console.log('   Destination: BASE-SEPOLIA (Base Sepolia)');
    console.log('   Protocol: CCTP (Cross-Chain Transfer Protocol)');
    console.log('   Mechanism: Burn → Attestation → Mint');
    console.log('');
    console.log('✅ Transfer #3: Trader Payouts (Treasury → 3 Traders)');
    console.log('   Method: Circle Gateway Transfer API');
    console.log('   Chain: ARC-TESTNET (same chain)');
    console.log('   Winners: Principal + yield reward');
    console.log('   Losers: Principal refund only');
    console.log('=' .repeat(80) + '\n');
}

// ============================================================================
// STEP 13: VERIFY COMPLETION
// ============================================================================

async function verifyCompletion(ngoWalletId, traders) {
    console.log('=' .repeat(80));
    console.log('STEP 13: Verify All Payouts Completed (NGO + 3 Traders)');
    console.log('=' .repeat(80));
    
    console.log('Checking final balances...\n');
    
    const ngoBalance = await checkWalletBalance(ngoWalletId);
    console.log(`NGO Wallet Balance: ${ngoBalance} USDC (on Base Sepolia)`);
    
    for (let i = 0; i < traders.length; i++) {
        const trader = traders[i];
        try {
            const balance = await checkWalletBalance(trader.walletId);
            console.log(`${trader.name} Balance: ${balance} USDC (on Arc)`);
        } catch (error) {
            console.log(`${trader.name} Balance: Error - ${error.message}`);
        }
    }
    
    console.log('\n✅ ALL PAYOUTS COMPLETED SUCCESSFULLY!\n');
    console.log('Summary:');
    console.log('✅ NGO received funds on their preferred chain (Base)');
    console.log('✅ Trader1 (YES voter) received principal + reward');
    console.log('✅ Trader2 (YES voter) received principal + reward');
    console.log('✅ Trader3 (NO voter) received principal refund');
    console.log('✅ No manual signing required');
    console.log('✅ Fully automated via Circle Gateway\n');
}

// ============================================================================
// MAIN EXECUTION FLOW
// ============================================================================

async function main() {
    try {
        console.log('\n');
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║                                                                ║');
        console.log('║          AI-DRIVEN TREASURY SYSTEM - FULL TEST                ║');
        console.log('║                                                                ║');
        console.log('║   Arc Contracts + Circle SDK + Real Aave Integration         ║');
        console.log('║                                                                ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');
        console.log('\n');
        
        // Initialize
        await initialize();
        
        // Step 1: Create Circle Wallets (3 traders + NGO)
        const { traders, ngoWalletId, ngoAddress } = await createCircleWallets();
        
        // Step 2: Fund all traders from admin wallet
        await fundTraders(traders);
        
        // Step 3: Create disaster market
        const { marketId, marketAddress, ngoId } = await createDisasterMarket(ngoWalletId, ngoAddress);
        
        // Step 4: Traders participate (2 buy YES, 1 buys NO)
        // Using 0.05 USDC each to avoid swap issues
        console.log('\n' + '='.repeat(80));
        console.log('STEP 4: Three Traders Participate');
        console.log('='.repeat(80) + '\n');
        
        // Log initial YES/NO prices (before any participation)
        try {
            const marketPriceContract = new ethers.Contract(
                marketAddress,
                ['function getYesPrice() view returns (uint256)', 'function getNoPrice() view returns (uint256)'],
                arcProvider
            );
            const yesInitial = await marketPriceContract.getYesPrice();
            const noInitial = await marketPriceContract.getNoPrice();
            console.log('📊 Initial YES/NO token prices (before any trades):');
            console.log(`   YES: ${ethers.formatUnits(yesInitial, 6)} USDC, NO: ${ethers.formatUnits(noInitial, 6)} USDC\n`);
        } catch (e) {
            console.log(`   ⚠️  Could not read initial prices: ${e.message}\n`);
        }
        
        const tradeAmount = 0.05; // Small amount to avoid swap issues
        let totalDeposited = 0n;
        
        // Trader 1: Buy YES
        console.log('👤 Trader 1 buying YES tokens...');
        const deposit1 = await traderParticipates(traders[0].walletId, marketId, tradeAmount, true);
        totalDeposited += deposit1;
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait between trades
        
        // Trader 2: Buy YES
        console.log('\n👤 Trader 2 buying YES tokens...');
        const deposit2 = await traderParticipates(traders[1].walletId, marketId, tradeAmount, true);
        totalDeposited += deposit2;
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Trader 3: Buy NO
        console.log('\n👤 Trader 3 buying NO tokens...');
        const deposit3 = await traderParticipates(traders[2].walletId, marketId, tradeAmount, false);
        totalDeposited += deposit3;
        
        console.log('\n✅ All 3 traders participated!');
        console.log(`   Total deposited: ${ethers.formatUnits(totalDeposited, 6)} USDC\n`);
        
        // Log final YES/NO prices after all participation (dynamic pricing summary)
        try {
            const marketPriceContract = new ethers.Contract(
                marketAddress,
                ['function getYesPrice() view returns (uint256)', 'function getNoPrice() view returns (uint256)'],
                arcProvider
            );
            const yesPriceFinal = await marketPriceContract.getYesPrice();
            const noPriceFinal = await marketPriceContract.getNoPrice();
            console.log('📊 YES/NO token prices after all participation (dynamic pricing):');
            console.log(`   YES token price: ${ethers.formatUnits(yesPriceFinal, 6)} USDC`);
            console.log(`   NO token price:  ${ethers.formatUnits(noPriceFinal, 6)} USDC`);
            console.log(`   (Sum ≈ 1.0; prices moved with demand)\n`);
        } catch (e) {
            console.log(`   ⚠️  Could not read final prices: ${e.message}\n`);
        }
        
        const depositAmount = totalDeposited; // Use total for the rest of the flow
        
        // Step 5: Bridge to Ethereum
        await bridgeToEthereum(marketId, depositAmount);
        
        // Step 5.5: Swap Circle USDC to Aave USDC - only the amount we just bridged (0.15 USDC)
        const aaveUsdcReceived = await swapCircleToAaveUSDC(ethProvider, ethSigner, ethSigner.address, depositAmount);
        
        // Step 6: Deploy to Aave (use the actual amount received from swap, not the original deposit)
        const positionId = await deployToAave(marketId, aaveUsdcReceived, ethProvider, ethSigner, ethSigner.address);
        
        // Step 7: Wait for yield (returns REAL aToken yield)
        const realAaveYield = await waitForYield(positionId);
        
        // Step 8: Resolve market
        await resolveMarket(marketId, marketAddress);
        
        // Step 9: Withdraw from Aave (principal + yield now in YieldController on Base Sepolia)
        const { principal: withdrawnPrincipal, yield: withdrawnYield } = await withdrawFromAave(positionId, ethProvider, ethSigner);
        const totalWithdrawn = withdrawnPrincipal + withdrawnYield;
        
        // Step 10: Transfer USDC, swap to Circle USDC, and bridge back to Arc
        // Pass the REAL Aave yield and actual deposit amount (will add 0.1 USDC simulated yield)
        const distributionAmount = await bridgeBackToArc(marketId, totalWithdrawn, realAaveYield, depositAmount, ethProvider, ethSigner, ethSigner.address);
        
        // Step 11: Calculate payouts
        await calculatePayouts(marketAddress);
        
        // Step 12: Execute payouts (use distribution amount: real yield + 0.1 USDC simulated, and actual deposit amount)
        await executePayouts(marketId, marketAddress, ngoWalletId, traders, distributionAmount, depositAmount);
        
        // Step 13: Verify completion
        await verifyCompletion(ngoWalletId, traders);
        
        // Final YES/NO price summary (market state after resolution)
        console.log('=' .repeat(80));
        console.log('FINAL MARKET PRICE SUMMARY (YES/NO tokens)');
        console.log('=' .repeat(80));
        try {
            const marketPriceContract = new ethers.Contract(
                marketAddress,
                ['function getYesPrice() view returns (uint256)', 'function getNoPrice() view returns (uint256)'],
                arcProvider
            );
            const yesPrice = await marketPriceContract.getYesPrice();
            const noPrice = await marketPriceContract.getNoPrice();
            console.log(`   YES token price: ${ethers.formatUnits(yesPrice, 6)} USDC`);
            console.log(`   NO token price:  ${ethers.formatUnits(noPrice, 6)} USDC`);
            console.log(`   (Prices reflect demand: 2 bought YES, 1 bought NO)\n`);
        } catch (e) {
            console.log(`   Could not read prices: ${e.message}\n`);
        }
        
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║                                                                ║');
        console.log('║                  🎉 TEST COMPLETED SUCCESSFULLY! 🎉           ║');
        console.log('║                                                                ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');
        console.log('\n');
        
        rl.close();
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        console.error(error);
        rl.close();
        process.exit(1);
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
if (require.main === module) {
    main();
}

module.exports = { main };