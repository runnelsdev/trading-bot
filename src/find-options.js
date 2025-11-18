require('dotenv').config();
const TastytradeIntegration = require('./tastytrade-client');

async function findOptions() {
  try {
    const tastytrade = new TastytradeIntegration();
    await tastytrade.authenticate();

    const symbol = process.argv[2] || 'SPY';
    const strikes = process.argv[3] ? process.argv[3].split(',').map(s => parseFloat(s.trim())) : [];

    console.log(`\n🔍 Finding option chain for ${symbol}...\n`);

    // Get option chain
    const optionChain = await tastytrade.getOptionChain(symbol);
    
    if (!optionChain || !optionChain.items || optionChain.items.length === 0) {
      console.log('❌ No option chain found');
      return;
    }

    console.log(`✅ Found ${optionChain.items.length} expiration date(s)\n`);

    // Show available expirations
    console.log('📅 Available Expiration Dates:');
    optionChain.items.slice(0, 10).forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.expirationDate} (${item.daysToExpiration} days)`);
    });
    if (optionChain.items.length > 10) {
      console.log(`  ... and ${optionChain.items.length - 10} more`);
    }

    // If strikes provided, find matching options
    if (strikes.length > 0) {
      console.log(`\n🎯 Searching for strikes: ${strikes.join(', ')}`);
      
      // Get first expiration (or you can specify)
      const firstExpiration = optionChain.items[0];
      console.log(`\n📊 Options for ${firstExpiration.expirationDate}:\n`);

      const foundOptions = [];

      // Search calls
      if (firstExpiration.callExpirationMap) {
        for (const [strike, callOption] of Object.entries(firstExpiration.callExpirationMap)) {
          const strikePrice = parseFloat(strike);
          if (strikes.length === 0 || strikes.some(s => Math.abs(s - strikePrice) < 1)) {
            foundOptions.push({
              type: 'CALL',
              strike: strikePrice,
              symbol: callOption.symbol,
              streamerSymbol: callOption['streamer-symbol'] || callOption.streamerSymbol || 'N/A'
            });
          }
        }
      }

      // Search puts
      if (firstExpiration.putExpirationMap) {
        for (const [strike, putOption] of Object.entries(firstExpiration.putExpirationMap)) {
          const strikePrice = parseFloat(strike);
          if (strikes.length === 0 || strikes.some(s => Math.abs(s - strikePrice) < 1)) {
            foundOptions.push({
              type: 'PUT',
              strike: strikePrice,
              symbol: putOption.symbol,
              streamerSymbol: putOption['streamer-symbol'] || putOption.streamerSymbol || 'N/A'
            });
          }
        }
      }

      // Sort by strike
      foundOptions.sort((a, b) => a.strike - b.strike);

      if (foundOptions.length > 0) {
        console.log('Found Options:');
        foundOptions.forEach(opt => {
          console.log(`  ${opt.type.padEnd(4)} Strike: $${opt.strike.toFixed(2).padStart(8)} | Symbol: ${opt.symbol}`);
        });
      } else {
        console.log('❌ No options found for the specified strikes');
      }
    } else {
      // Show sample options from first expiration
      const firstExpiration = optionChain.items[0];
      console.log(`\n📊 Sample Options for ${firstExpiration.expirationDate} (showing first 10 strikes):\n`);

      const sampleOptions = [];
      
      if (firstExpiration.callExpirationMap) {
        const callStrikes = Object.keys(firstExpiration.callExpirationMap)
          .map(s => parseFloat(s))
          .sort((a, b) => a - b)
          .slice(0, 10);
        
        callStrikes.forEach(strike => {
          const callOption = firstExpiration.callExpirationMap[strike];
          sampleOptions.push({
            type: 'CALL',
            strike: strike,
            symbol: callOption.symbol,
            streamerSymbol: callOption['streamer-symbol'] || callOption.streamerSymbol || 'N/A'
          });
        });
      }

      if (sampleOptions.length > 0) {
        console.log('Sample Call Options:');
        sampleOptions.forEach(opt => {
          console.log(`  Strike: $${opt.strike.toFixed(2).padStart(8)} | Symbol: ${opt.symbol}`);
        });
      }
    }

    console.log('\n✅ Done!\n');
    console.log('💡 Usage examples:');
    console.log('   node src/find-options.js SPY');
    console.log('   node src/find-options.js SPY 295,298');
    console.log('   node src/find-options.js AAPL 150,155,160');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

// Run
findOptions();

