require('dotenv').config();
const TastytradeIntegration = require('./tastytrade-client');

/**
 * Check for available accounts and test common account number formats
 */
async function checkAccounts() {
  try {
    const tastytrade = new TastytradeIntegration();
    await tastytrade.authenticate();

    console.log('🔍 Checking for available accounts...\n');

    // Try to get accounts list
    console.log('📋 Method 1: Fetching account list...');
    try {
      const accounts = await tastytrade.getAccounts();
      if (accounts.length > 0) {
        console.log(`✅ Found ${accounts.length} account(s):\n`);
        accounts.forEach((acc, i) => {
          const accNum = acc.account['account-number'];
          console.log(`   ${i + 1}. ${accNum}`);
        });
        console.log('\n✅ You have accounts available!');
        return;
      } else {
        console.log('   ⚠️  No accounts found in account list\n');
      }
    } catch (error) {
      console.log(`   ⚠️  Error: ${error.message}\n`);
    }

    // Try common account number formats
    console.log('🔍 Method 2: Testing common account number formats...\n');
    const commonFormats = [
      '5WT00000',
      '5WT00001',
      '5WT0001',
      '5WT0002',
      '5WT001',
      '5WT002'
    ];

    let foundAccounts = [];

    for (const accountNumber of commonFormats) {
      try {
        console.log(`   Testing ${accountNumber}...`);
        const verification = await tastytrade.verifyAccount(accountNumber);
        if (verification.exists) {
          foundAccounts.push(accountNumber);
          console.log(`   ✅ ${accountNumber} is accessible!`);
        } else {
          console.log(`   ❌ ${accountNumber} - ${verification.error}`);
        }
      } catch (error) {
        // Silently continue - account doesn't exist
        console.log(`   ❌ ${accountNumber} - Not accessible`);
      }
    }

    if (foundAccounts.length > 0) {
      console.log(`\n✅ Found ${foundAccounts.length} accessible account(s):`);
      foundAccounts.forEach(acc => console.log(`   - ${acc}`));
    } else {
      console.log('\n❌ No accessible accounts found with common formats.');
      console.log('\n💡 Next steps:');
      console.log('   1. Contact api.support@tastytrade.com to create a sandbox account');
      console.log('   2. Include support ID: c485a5aa21ab1be0ad233fe7a0ba5aae');
      console.log('   3. Once account is created, run this script again');
    }

    console.log('\n✅ Account check complete!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

checkAccounts();

