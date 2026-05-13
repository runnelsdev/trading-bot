require('dotenv').config();
const TastytradeIntegration = require('../src/clients/tastytrade-client');

async function testTastytrade() {
  try {
    // Initialize Tastytrade client
    const tastytrade = new TastytradeIntegration();
    
    // Authenticate
    await tastytrade.authenticate();
    
    // Get accounts
    const accounts = await tastytrade.getAccounts();
    
    if (accounts.length > 0) {
      const firstAccount = accounts[0];
      const accountNumber = firstAccount.account['account-number'];
      
      console.log(`\n📊 Account: ${accountNumber}`);
      
      // Get balances
      const balances = await tastytrade.getBalances(accountNumber);
      console.log('💰 Balances:', JSON.stringify(balances, null, 2));
      
      // Get positions
      const positions = await tastytrade.getPositions(accountNumber);
      console.log(`\n📈 Positions: ${positions.length}`);
      if (positions.length > 0) {
        positions.forEach((pos, index) => {
          console.log(`  ${index + 1}. ${pos.symbol} - Quantity: ${pos.quantity}`);
        });
      }
    }
    
    // Example: Connect to quote streamer and subscribe to symbols
    // Uncomment to test market data streaming
    /*
    await tastytrade.connectQuoteStreamer();
    
    // Add event listener for market data
    tastytrade.client.quoteStreamer.addEventListener((events) => {
      console.log('📊 Market data received:', events);
    });
    
    // Subscribe to symbols
    tastytrade.subscribeToQuotes(['AAPL', 'TSLA']);
    
    // Keep running for a bit to see data
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    await tastytrade.disconnectQuoteStreamer();
    */
    
    console.log('\n✅ Tastytrade test completed successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the test
testTastytrade();

