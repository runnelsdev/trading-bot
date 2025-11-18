require('dotenv').config();
const TastytradeIntegration = require('./tastytrade-client');

async function verifyAccount() {
  try {
    const tastytrade = new TastytradeIntegration();
    await tastytrade.authenticate();

    const accountNumber = process.argv[2] || '5WX01234';

    console.log(`\n🔍 Verifying account: ${accountNumber}...\n`);

    // First, get all accounts
    console.log('📋 Fetching all accounts...');
    const accounts = await tastytrade.getAccounts();
    
    if (accounts.length > 0) {
      console.log(`\n✅ Found ${accounts.length} account(s):`);
      accounts.forEach((acc, i) => {
        const accNum = acc.account['account-number'];
        const isMatch = accNum === accountNumber;
        console.log(`  ${i + 1}. ${accNum}${isMatch ? ' ← MATCH' : ''}`);
      });
    } else {
      console.log('\n⚠️  No accounts found in account list');
    }

    // Try to verify the specific account
    console.log(`\n🔍 Verifying access to account ${accountNumber}...`);
    try {
      const verification = await tastytrade.verifyAccount(accountNumber);
      
      if (verification.exists) {
        console.log(`\n✅ Account ${accountNumber} is accessible!`);
        if (verification.balance) {
          console.log('\n💰 Account Balance:');
          console.log(JSON.stringify(verification.balance, null, 2));
        }
      } else {
        console.log(`\n❌ Account ${accountNumber} not accessible`);
        console.log(`   Error: ${verification.error}`);
        if (verification.suggestion) {
          console.log(`   💡 ${verification.suggestion}`);
        }
        console.log(`\n💡 Additional checks:`);
        console.log(`   1. Verify the account number is correct`);
        console.log(`   2. Check your credentials have access to this account`);
        console.log(`   3. Ensure you're using the correct environment (sandbox vs production)`);
        console.log(`   4. For sandbox: Make sure test accounts are set up in the sandbox environment`);
      }
    } catch (error) {
      console.log(`\n❌ Error verifying account: ${error.message}`);
      if (error.response) {
        console.log(`   Status: ${error.response.status}`);
        if (error.response.status === 404) {
          console.log(`   The account ${accountNumber} was not found.`);
        }
      }
    }

    console.log('\n✅ Verification complete!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

// Run
verifyAccount();

