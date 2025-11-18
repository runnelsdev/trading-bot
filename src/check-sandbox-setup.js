require('dotenv').config();
const TastytradeIntegration = require('./tastytrade-client');

async function checkSetup() {
  console.log('🔍 Checking Tastytrade Sandbox Setup...\n');

  // Check environment variables
  console.log('📋 Environment Configuration:');
  const env = process.env.TASTYTRADE_ENV || 'not set';
  console.log(`   TASTYTRADE_ENV: ${env}`);

  const hasOAuth = !!(process.env.TASTYTRADE_CLIENT_SECRET && process.env.TASTYTRADE_REFRESH_TOKEN);
  const hasSession = !!(process.env.TASTYTRADE_USERNAME && process.env.TASTYTRADE_PASSWORD);

  if (hasOAuth) {
    console.log('   ✅ OAuth credentials found');
    console.log(`   Client Secret: ${process.env.TASTYTRADE_CLIENT_SECRET.substring(0, 8)}...`);
    console.log(`   Refresh Token: ${process.env.TASTYTRADE_REFRESH_TOKEN.substring(0, 20)}...`);
  } else if (hasSession) {
    console.log('   ✅ Session credentials found');
    console.log(`   Username: ${process.env.TASTYTRADE_USERNAME}`);
  } else {
    console.log('   ❌ No credentials found');
    console.log('\n💡 You need to set up either:');
    console.log('   - OAuth: TASTYTRADE_CLIENT_SECRET and TASTYTRADE_REFRESH_TOKEN');
    console.log('   - Session: TASTYTRADE_USERNAME and TASTYTRADE_PASSWORD');
    console.log('\n   See src/setup-oauth.md for instructions');
    process.exit(1);
  }

  // Test authentication
  console.log('\n🔐 Testing Authentication...');
  try {
    const tastytrade = new TastytradeIntegration();
    await tastytrade.authenticate();
    console.log('   ✅ Authentication successful!');
  } catch (error) {
    console.log(`   ❌ Authentication failed: ${error.message}`);
    if (error.message.includes('refresh token')) {
      console.log('\n💡 Your refresh token may be invalid or expired.');
      console.log('   Go to your OAuth app settings and create a new grant to get a new refresh token.');
    }
    process.exit(1);
  }

  // Test account access
  console.log('\n📊 Testing Account Access...');
  try {
    const tastytrade = new TastytradeIntegration();
    await tastytrade.authenticate();
    const accounts = await tastytrade.getAccounts();
    
    if (accounts.length > 0) {
      console.log(`   ✅ Found ${accounts.length} account(s):`);
      accounts.forEach((acc, i) => {
        const accNum = acc.account['account-number'];
        console.log(`      ${i + 1}. ${accNum}`);
      });
    } else {
      console.log('   ⚠️  No accounts found');
      console.log('   This might be normal if you need to create sandbox accounts first.');
      console.log('   Go to the sandbox dashboard to add test accounts.');
    }
  } catch (error) {
    console.log(`   ⚠️  Could not fetch accounts: ${error.message}`);
  }

  // Sandbox-specific notes
  console.log('\n📝 Sandbox Environment Notes:');
  console.log('   ⚠️  Symbol search is NOT available in sandbox');
  console.log('   ⚠️  Market data/quote streamer is NOT available in sandbox');
  console.log('   ⚠️  Some helper functions may not work');
  console.log('   ✅ Orders work but behave differently (see setup-oauth.md)');

  console.log('\n✅ Setup check complete!\n');
  console.log('💡 Next steps:');
  console.log('   1. If you have accounts, test: node src/verify-account.js YOUR_ACCOUNT');
  console.log('   2. To test orders: node src/test-order.js');
  console.log('   3. For OAuth setup help: see src/setup-oauth.md');
}

checkSetup().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});

