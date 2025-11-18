require('dotenv').config();
const TastytradeIntegration = require('./tastytrade-client');

async function testConnection() {
  try {
    console.log('🔄 Connecting to Tastytrade...\n');
    
    // Initialize Tastytrade client
    const tastytrade = new TastytradeIntegration();
    
    // Authenticate
    await tastytrade.authenticate();
    
    console.log('✅ Connected successfully!\n');
    
    // Try to get accounts
    console.log('📊 Fetching accounts...');
    const accounts = await tastytrade.getAccounts();
    
    console.log(`\n📊 Found ${accounts.length} account(s):`);
    
    if (accounts.length > 0) {
      accounts.forEach((acc, i) => {
        const accNum = acc.account['account-number'];
        console.log(`  ${i + 1}. ${accNum}`);
      });
      
      // Get details for first account
      const firstAccount = accounts[0];
      const accountNumber = firstAccount.account['account-number'];
      
      console.log(`\n📋 Details for account ${accountNumber}:`);
      
      // Get balances
      try {
        const balances = await tastytrade.getBalances(accountNumber);
        console.log('💰 Balances:', JSON.stringify(balances, null, 2));
      } catch (error) {
        console.log(`   ⚠️  Could not get balances: ${error.message}`);
      }
      
      // Get positions
      try {
        const positions = await tastytrade.getPositions(accountNumber);
        console.log(`\n📈 Positions: ${positions.length}`);
        if (positions.length > 0) {
          positions.forEach((pos, index) => {
            console.log(`  ${index + 1}. ${pos.symbol} - Quantity: ${pos.quantity}`);
          });
        }
      } catch (error) {
        console.log(`   ⚠️  Could not get positions: ${error.message}`);
      }
    } else {
      console.log('\n⚠️  No accounts found.');
      console.log('   This might be normal if you need to create sandbox accounts first.');
    }
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Connection failed:', error.message);
    if (error.response) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testConnection();
