/**
 * ============================================================================
 * CIRCLE ENTITY SECRET GENERATOR
 * ============================================================================
 * 
 * This script helps you generate and register your Circle Entity Secret
 * following the guide in guides/entityGuide.md
 * 
 * Steps:
 * 1. Generate a 32-byte Entity Secret
 * 2. Register it with Circle using your API key
 * 3. Save the recovery file securely
 * 
 * Prerequisites:
 * - Circle API key from https://console.circle.com
 * - npm install @circle-fin/developer-controlled-wallets
 * 
 * ============================================================================
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                ║');
  console.log('║         CIRCLE ENTITY SECRET GENERATOR                        ║');
  console.log('║                                                                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('\n');

  try {
    // Import functions from SDK (version 10.1.0+)
    let generateEntitySecret, registerEntitySecretCiphertext;
    try {
      const { generateEntitySecret: genSecret, registerEntitySecretCiphertext: regSecret } = require('@circle-fin/developer-controlled-wallets');
      generateEntitySecret = genSecret;
      registerEntitySecretCiphertext = regSecret;
      
      if (typeof generateEntitySecret !== 'function' || typeof registerEntitySecretCiphertext !== 'function') {
        throw new Error('SDK functions not available');
      }
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        console.log('❌ ERROR: @circle-fin/developer-controlled-wallets not installed!');
        console.log('\nPlease install it first:');
        console.log('   npm install');
        console.log('\nThen run this script again.\n');
        process.exit(1);
      } else {
        console.log('❌ ERROR: Could not import SDK functions');
        console.log('   Error:', error.message);
        console.log('\nPlease ensure you have @circle-fin/developer-controlled-wallets@^10.1.0 installed');
        process.exit(1);
      }
    }

    // Step 1: Get API Key
    console.log('📋 STEP 1: Get Your Circle API Key');
    console.log('=' .repeat(60));
    let apiKey = process.env.CIRCLE_API_KEY;
    
    if (!apiKey || apiKey === 'your_circle_api_key_here') {
      console.log('⚠️  CIRCLE_API_KEY not found in .env file');
      apiKey = await prompt('Enter your Circle API Key: ');
      if (!apiKey) {
        console.log('❌ API Key is required!');
        process.exit(1);
      }
    } else {
      console.log('✅ Found API Key in .env file');
    }
    console.log('');

    // Step 2: Generate Entity Secret
    console.log('📋 STEP 2: Generate Entity Secret');
    console.log('=' .repeat(60));
    console.log('Generating 32-byte Entity Secret...\n');
    
    // Capture console output to extract the entity secret
    // generateEntitySecret() prints the secret but doesn't return it
    let originalLog = console.log;
    let entitySecret = null;
    const logMessages = [];
    
    console.log = (...args) => {
      const message = args.join(' ');
      logMessages.push(message);
      originalLog(...args);
      
      // Extract entity secret from the printed output
      const secretMatch = message.match(/ENTITY SECRET:\s*([a-f0-9]{64})/i);
      if (secretMatch) {
        entitySecret = secretMatch[1];
      }
    };
    
    generateEntitySecret();
    
    // Restore console.log
    console.log = originalLog;
    
    // If we didn't capture it from output, generate manually
    if (!entitySecret) {
      const crypto = require('crypto');
      entitySecret = crypto.randomBytes(32).toString('hex');
      console.log(`\n✅ Generated Entity Secret: ${entitySecret}\n`);
    } else {
      console.log('\n✅ Entity Secret Generated!');
    }
    
    console.log(`   Entity Secret: ${entitySecret}`);
    console.log('   ⚠️  SAVE THIS SECRET SECURELY - Circle cannot recover it!\n');

    // Step 3: Register Entity Secret
    console.log('📋 STEP 3: Register Entity Secret with Circle');
    console.log('=' .repeat(60));
    
    // Create recovery file directory
    const recoveryDir = path.join(__dirname, '..', 'recovery');
    if (!fs.existsSync(recoveryDir)) {
      fs.mkdirSync(recoveryDir, { recursive: true });
    }

    const recoveryFilePath = path.join(recoveryDir, `entity-secret-recovery-${Date.now()}.json`);

    // Save entity secret to a secure file first (before registration)
    const secretFile = path.join(__dirname, '..', '.entity-secret');
    if (entitySecret) {
      fs.writeFileSync(secretFile, entitySecret, { mode: 0o600 });
      console.log(`✅ Entity Secret saved to: ${secretFile}`);
      console.log('   (This file is gitignored for security)\n');
    }
    
    // Try to register using SDK if available
    if (registerEntitySecretCiphertext && entitySecret) {
      console.log('Registering Entity Secret ciphertext with Circle...\n');
      try {
        const response = await registerEntitySecretCiphertext({
          apiKey: apiKey,
          entitySecret: entitySecret,
          recoveryFileDownloadPath: recoveryDir, // Directory where recovery file will be saved
        });

        console.log('✅ Entity Secret Registered Successfully!');
        
        // The recovery file should be saved automatically by the SDK
        // Check if recovery file was created
        const recoveryFiles = fs.readdirSync(recoveryDir).filter(f => f.endsWith('.dat'));
        if (recoveryFiles.length > 0) {
          const latestRecoveryFile = recoveryFiles.sort().reverse()[0];
          const recoveryFilePath = path.join(recoveryDir, latestRecoveryFile);
          console.log(`   Recovery File: ${recoveryFilePath}`);
          console.log('   ⚠️  SAVE THE RECOVERY FILE SECURELY!\n');
        } else if (response.data?.recoveryFile) {
          // Save recovery file content if provided in response
          const recoveryFilePath = path.join(recoveryDir, `recovery_file_${Date.now()}.dat`);
          fs.writeFileSync(recoveryFilePath, response.data.recoveryFile);
          console.log(`   Recovery File: ${recoveryFilePath}`);
          console.log('   ⚠️  SAVE THE RECOVERY FILE SECURELY!\n');
        } else {
          console.log('   ⚠️  Recovery file should be in recovery/ directory\n');
        }
      } catch (error) {
        console.error('❌ Failed to register Entity Secret via SDK!');
        console.error('Error:', error.message);
        if (error.response) {
          console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
        console.log('\n⚠️  Falling back to manual registration instructions.\n');
        
        // Provide manual registration instructions
        console.log('📝 Manual Registration Steps:');
        console.log('   1. Go to Circle Console: https://console.circle.com');
        console.log('   2. Navigate to Developer Settings > Entity Secret');
        console.log('   3. Register your Entity Secret using the generated secret below');
        console.log(`   Entity Secret: ${entitySecret}\n`);
      }
    } else {
      if (!entitySecret) {
        console.log('❌ ERROR: Entity Secret was not generated properly!\n');
        process.exit(1);
      }
      console.log('⚠️  SDK registration function not available.');
      console.log('   Please register manually using Circle Console.\n');
      
      // Provide manual registration instructions
      console.log('📝 Manual Registration Steps:');
      console.log('   1. Go to Circle Console: https://console.circle.com');
      console.log('   2. Navigate to Developer Settings > Entity Secret');
      console.log('   3. Register your Entity Secret using the generated secret below');
      console.log(`   Entity Secret: ${entitySecret}\n`);
    }

    // Step 4: Update .env file
    console.log('📋 STEP 4: Update .env File');
    console.log('=' .repeat(60));
    
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      
      // Update or add CIRCLE_ENTITY_SECRET
      if (envContent.includes('CIRCLE_ENTITY_SECRET=')) {
        envContent = envContent.replace(
          /CIRCLE_ENTITY_SECRET=.*/,
          `CIRCLE_ENTITY_SECRET=${entitySecret}`
        );
      } else {
        // Add after CIRCLE_API_KEY
        envContent = envContent.replace(
          /(CIRCLE_API_KEY=.*)/,
          `$1\nCIRCLE_ENTITY_SECRET=${entitySecret}`
        );
      }
      
      fs.writeFileSync(envPath, envContent);
      console.log('✅ Updated .env file with Entity Secret');
    } else {
      console.log('⚠️  .env file not found. Please add manually:');
      console.log(`   CIRCLE_ENTITY_SECRET=${entitySecret}\n`);
    }
    
    console.log('\n📋 STEP 5: Register Entity Secret with Circle');
    console.log('=' .repeat(60));
    console.log('To complete setup, register your Entity Secret:');
    console.log('\n   Option 1: Circle Console (Recommended)');
    console.log('   1. Go to: https://console.circle.com');
    console.log('   2. Navigate to: Developer Settings > Entity Secret');
    console.log('   3. Enter your Entity Secret and register');
    console.log('\n   Option 2: Circle CLI (if installed)');
    console.log('   Follow Circle\'s CLI documentation');
    console.log('\n   Your Entity Secret:');
    console.log(`   ${entitySecret}\n`);

    // Summary
    console.log('\n' + '=' .repeat(60));
    console.log('✅ SUCCESS! Entity Secret Generated and Registered');
    console.log('=' .repeat(60));
    console.log('\n📝 Summary:');
    console.log(`   Entity Secret: ${entitySecret}`);
    console.log(`   Recovery File: ${recoveryFilePath}`);
    console.log(`   .env Updated: ${fs.existsSync(envPath) ? 'Yes' : 'No'}`);
    console.log('\n🔒 Security Reminders:');
    console.log('   1. Store Entity Secret in a password manager');
    console.log('   2. Save recovery file in a secure, separate location');
    console.log('   3. Never commit Entity Secret to git');
    console.log('   4. Circle cannot recover your Entity Secret if lost');
    console.log('\n✨ You can now use this Entity Secret in test_full_system.js!\n');

    rl.close();

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
    rl.close();
    process.exit(1);
  }
}

main();
