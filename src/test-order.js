require('dotenv').config();
const TastytradeIntegration = require('./tastytrade-client');

async function testOrder() {
  try {
    // Initialize Tastytrade client
    const tastytrade = new TastytradeIntegration();
    
    // Authenticate
    await tastytrade.authenticate();
    
    // First, get available accounts to verify account number
    console.log('📋 Fetching available accounts...');
    let accounts = [];
    try {
      accounts = await tastytrade.getAccounts();
      if (accounts.length > 0) {
        console.log(`\n✅ Found ${accounts.length} account(s):`);
        accounts.forEach((acc, i) => {
          const accNum = acc.account['account-number'];
          console.log(`  ${i + 1}. ${accNum}`);
        });
      } else {
        console.log(`\n⚠️  No accounts found. This might be normal for sandbox/test environments.`);
      }
    } catch (error) {
      console.log(`\n⚠️  Could not fetch accounts: ${error.message}`);
      console.log(`   Continuing with provided account number...`);
    }
    
    // Use first account if 5WT0001 is not found, or use the provided one
    let accountNumber = "5WT0001";
    if (accounts.length > 0) {
      const accountExists = accounts.some(acc => acc.account['account-number'] === accountNumber);
      if (!accountExists) {
        accountNumber = accounts[0].account['account-number'];
        console.log(`\n⚠️  Account 5WT0001 not found. Using first available account: ${accountNumber}`);
      } else {
        console.log(`\n✅ Using account: ${accountNumber}`);
      }
    } else {
      console.log(`\n📋 Using provided account number: ${accountNumber}`);
      console.log(`   Verifying account access...`);
      
      // Verify account access
      try {
        const verification = await tastytrade.verifyAccount(accountNumber);
        if (!verification.exists) {
          console.log(`\n❌ Account ${accountNumber} is not accessible.`);
          console.log(`   Run: node src/verify-account.js ${accountNumber}`);
          console.log(`   Or use one of your accessible accounts.`);
          process.exit(1);
        } else {
          console.log(`\n✅ Account ${accountNumber} is accessible!`);
        }
      } catch (error) {
        console.log(`\n⚠️  Could not verify account: ${error.message}`);
        console.log(`   Continuing anyway...`);
      }
    }
    
    // Order data - cleaned up for API submission
    // Note: Remove response-only fields like status, cancellable, editable, fills, etc.
    // WARNING: The option symbols below have an expiration date of 191018 (Oct 18, 2019) which is expired.
    // You'll need to update these with current option symbols for the order to work.
    const orderData = {
      "time-in-force": "Day",
      "order-type": "Limit",
      "size": 1,
      "underlying-symbol": "SPY",
      "price": "2.0",
      "price-effect": "Credit",
      "legs": [
        {
          "instrument-type": "Equity Option",
          "symbol": "SPY   191018C00298000",  // ⚠️ Expired option - update with current symbol
          "quantity": 1,
          "action": "Buy to Open"
        },
        {
          "instrument-type": "Equity Option",
          "symbol": "SPY   191018C00295000",  // ⚠️ Expired option - update with current symbol
          "quantity": 1,
          "action": "Sell to Open"
        }
      ]
    };
    
    console.log('\n⚠️  IMPORTANT: The option symbols in this order have expired dates (191018 = Oct 18, 2019).');
    console.log('   You need to update them with current option symbols for the order to work.');
    console.log('   Run: node src/find-options.js SPY 295,298');
    console.log('   This will show you current option symbols you can use.\n');

    console.log('\n📋 Testing order submission...\n');
    console.log('Order Details:');
    console.log(`  Account: ${accountNumber}`);
    console.log(`  Underlying: ${orderData['underlying-symbol']}`);
    console.log(`  Order Type: ${orderData['order-type']}`);
    console.log(`  Price: $${orderData.price}`);
    console.log(`  Price Effect: ${orderData['price-effect']}`);
    console.log(`  Legs: ${orderData.legs.length}`);
    orderData.legs.forEach((leg, i) => {
      console.log(`    ${i + 1}. ${leg.action} ${leg.symbol} x${leg.quantity}`);
    });

    // Step 1: Dry-run the order first (recommended)
    console.log('\n🔍 Step 1: Running dry-run test...');
    try {
      const dryRunResult = await tastytrade.dryRunOrder(accountNumber, orderData);
      console.log('\n✅ Dry-run successful!');
      console.log('\nDry-run Results:');
      
      if (dryRunResult.data) {
        if (dryRunResult.data['buying-power-effect']) {
          const bp = dryRunResult.data['buying-power-effect'];
          console.log(`  Buying Power Impact: $${bp.impact} (${bp.effect})`);
          console.log(`  New Buying Power: $${bp['new-buying-power']}`);
        }
        
        if (dryRunResult.data['fee-calculation']) {
          const fees = dryRunResult.data['fee-calculation'];
          console.log(`  Total Fees: $${fees['total-fees']}`);
          console.log(`    - Commission: $${fees.commission}`);
          console.log(`    - Regulatory Fees: $${fees['regulatory-fees']}`);
          console.log(`    - Clearing Fees: $${fees['clearing-fees']}`);
        }

        if (dryRunResult.data.warnings && dryRunResult.data.warnings.length > 0) {
          console.log('\n⚠️  Warnings:');
          dryRunResult.data.warnings.forEach(warning => {
            console.log(`  - ${warning}`);
          });
        }
      }

      console.log('\n📊 Full dry-run response:');
      console.log(JSON.stringify(dryRunResult, null, 2));
    } catch (dryRunError) {
      console.error('❌ Dry-run failed:', dryRunError.message);
      if (dryRunError.response) {
        console.error('Response:', JSON.stringify(dryRunError.response.data, null, 2));
      }
      throw dryRunError;
    }

    // Step 2: Uncomment to actually submit the order
    // WARNING: This will place a real order!
    /*
    console.log('\n📤 Step 2: Submitting actual order...');
    try {
      const orderResult = await tastytrade.createComplexOrder(accountNumber, orderData);
      console.log('\n✅ Order submitted!');
      console.log('\nOrder Result:');
      console.log(JSON.stringify(orderResult, null, 2));
      
      // Get the order ID if available
      if (orderResult.data && orderResult.data.order) {
        const orderId = orderResult.data.order['id'] || orderResult.data.order['order-id'];
        if (orderId) {
          console.log(`\n📋 Order ID: ${orderId}`);
          console.log('You can use this ID to cancel the order if needed.');
        }
      }
    } catch (orderError) {
      console.error('❌ Order submission failed:', orderError.message);
      if (orderError.response) {
        console.error('Response:', JSON.stringify(orderError.response.data, null, 2));
      }
      throw orderError;
    }
    */

    console.log('\n✅ Order test completed!');
    console.log('\n💡 To actually submit the order, uncomment the code in Step 2.');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testOrder();

