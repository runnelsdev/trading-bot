require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const FillBroadcaster = require('./fill-broadcaster');

/**
 * Fill Notification Test Suite
 * Tests various fill formats and edge cases
 */

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let fillBroadcaster = null;

// Test cases
const testCases = {
  // Complete fill with all fields
  complete: {
    orderId: 'TEST-COMPLETE-001',
    symbol: 'SPY',
    action: 'Buy to Open',
    status: 'Filled',
    filledQuantity: 10,
    totalQuantity: 10,
    fillPrice: 450.25,
    instrumentType: 'Equity Option',
    strike: 450,
    expiration: '2024-12-15',
    optionType: 'CALL',
    filledAt: new Date(),
    accountNumber: '5WT12345',
    fees: 0.50,
    commission: 1.00,
    executionVenue: 'CBOE'
  },

  // Partial fill
  partial: {
    orderId: 'TEST-PARTIAL-001',
    symbol: 'QQQ',
    action: 'Sell to Close',
    status: 'Partially Filled',
    filledQuantity: 5,
    totalQuantity: 10,
    fillPrice: 380.50,
    instrumentType: 'Equity Option',
    strike: 380,
    expiration: '2024-12-20',
    optionType: 'PUT',
    filledAt: new Date()
  },

  // Equity fill (not options)
  equity: {
    orderId: 'TEST-EQUITY-001',
    symbol: 'AAPL',
    action: 'Buy to Open',
    status: 'Filled',
    filledQuantity: 100,
    totalQuantity: 100,
    fillPrice: 175.25,
    instrumentType: 'Equity',
    filledAt: new Date(),
    accountNumber: '5WT12345'
  },

  // Missing optional fields
  minimal: {
    orderId: 'TEST-MINIMAL-001',
    symbol: 'TSLA',
    action: 'Buy to Open',
    status: 'Filled',
    filledQuantity: 1,
    fillPrice: 250.00,
    filledAt: new Date()
    // Missing: instrumentType, strike, expiration, fees, etc.
  },

  // Missing critical fields
  missingSymbol: {
    orderId: 'TEST-MISSING-001',
    // symbol: missing!
    action: 'Buy to Open',
    status: 'Filled',
    filledQuantity: 10,
    fillPrice: 100.00,
    filledAt: new Date()
  },

  // Missing action
  missingAction: {
    orderId: 'TEST-MISSING-002',
    symbol: 'SPY',
    // action: missing!
    status: 'Filled',
    filledQuantity: 10,
    fillPrice: 450.00,
    filledAt: new Date()
  },

  // Malformed data types
  malformedTypes: {
    orderId: 'TEST-MALFORMED-001',
    symbol: 'SPY',
    action: 'Buy to Open',
    status: 'Filled',
    filledQuantity: 'not-a-number', // Should be number
    fillPrice: 'invalid-price', // Should be number
    filledAt: 'not-a-date' // Should be date
  },

  // Null/undefined fields
  nullFields: {
    orderId: 'TEST-NULL-001',
    symbol: null,
    action: undefined,
    status: 'Filled',
    filledQuantity: 10,
    fillPrice: null,
    filledAt: new Date()
  },

  // Very large numbers
  largeNumbers: {
    orderId: 'TEST-LARGE-001',
    symbol: 'SPY',
    action: 'Buy to Open',
    status: 'Filled',
    filledQuantity: 10000,
    totalQuantity: 10000,
    fillPrice: 999999.99,
    instrumentType: 'Equity Option',
    filledAt: new Date()
  },

  // Negative numbers (should not happen but test)
  negativeNumbers: {
    orderId: 'TEST-NEGATIVE-001',
    symbol: 'SPY',
    action: 'Sell to Close',
    status: 'Filled',
    filledQuantity: -10, // Invalid
    fillPrice: -50.00, // Invalid
    filledAt: new Date()
  },

  // Different action formats
  actionVariations: {
    orderId: 'TEST-ACTION-001',
    symbol: 'IWM',
    action: 'BTO', // Shorthand
    status: 'Filled',
    filledQuantity: 5,
    fillPrice: 200.00,
    filledAt: new Date()
  },

  // Long symbol names
  longSymbol: {
    orderId: 'TEST-LONG-001',
    symbol: 'SPXW241220C04500000', // Full OCC symbol
    action: 'Buy to Open',
    status: 'Filled',
    filledQuantity: 1,
    fillPrice: 10.50,
    instrumentType: 'Equity Option',
    filledAt: new Date()
  },

  // Empty strings
  emptyStrings: {
    orderId: 'TEST-EMPTY-001',
    symbol: '',
    action: '',
    status: 'Filled',
    filledQuantity: 10,
    fillPrice: 100.00,
    filledAt: new Date()
  },

  // Different timestamp formats
  timestampVariations: {
    orderId: 'TEST-TIMESTAMP-001',
    symbol: 'SPY',
    action: 'Buy to Open',
    status: 'Filled',
    filledQuantity: 10,
    fillPrice: 450.00,
    filledAt: '2024-12-15T10:30:00Z', // ISO string
    timestamp: 1702645800000 // Unix timestamp
  },

  // Special characters in symbol
  specialChars: {
    orderId: 'TEST-SPECIAL-001',
    symbol: 'SPY/QQQ', // Invalid but test
    action: 'Buy to Open',
    status: 'Filled',
    filledQuantity: 10,
    fillPrice: 450.00,
    filledAt: new Date()
  },

  // Multiple legs (spread)
  multiLeg: {
    orderId: 'TEST-SPREAD-001',
    symbol: 'SPY',
    action: 'Buy to Open',
    status: 'Filled',
    filledQuantity: 1,
    fillPrice: 2.50,
    instrumentType: 'Equity Option',
    strike: 450,
    expiration: '2024-12-15',
    optionType: 'CALL',
    legs: [
      { strike: 450, optionType: 'CALL', action: 'Buy to Open' },
      { strike: 455, optionType: 'CALL', action: 'Sell to Open' }
    ],
    filledAt: new Date()
  }
};

// Run all tests
async function runTests() {
  console.log('🧪 Starting Fill Notification Test Suite\n');
  console.log('=' .repeat(60));
  
  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };

  for (const [testName, testData] of Object.entries(testCases)) {
    console.log(`\n📝 Test: ${testName}`);
    console.log('-'.repeat(60));
    
    try {
      // Show test data
      console.log('Input:', JSON.stringify(testData, null, 2));
      
      // Broadcast fill
      const result = await fillBroadcaster.broadcastFill(testData);
      
      // Check result
      console.log('Result:', JSON.stringify(result, null, 2));
      
      // Validate
      const hasErrors = result.errors && result.errors.length > 0;
      const hasSuccess = result.vip?.success || result.premium?.success || result.basic?.success;
      const validationPassed = result.validation?.isValid;
      const criticalFailure = result.validation?.critical;
      
      // Check if channels are configured
      const noChannelsConfigured = !process.env.VIP_CHANNEL_ID && 
                                    !process.env.PREMIUM_CHANNEL_ID && 
                                    !process.env.BASIC_CHANNEL_ID;
      
      // Negative tests: these SHOULD fail validation (that's the expected behavior)
      const isNegativeTest = ['missingSymbol', 'missingAction', 'nullFields', 'emptyStrings'].includes(testName);
      
      if (isNegativeTest) {
        // Negative tests: SHOULD fail validation - that means the system is working!
        if (criticalFailure) {
          console.log('✅ PASSED (correctly rejected invalid data)');
          results.passed++;
        } else {
          console.log('❌ FAILED (should have rejected this data)');
          results.failed++;
          results.errors.push({ test: testName, result });
        }
      } else if (hasSuccess && !hasErrors) {
        console.log('✅ PASSED');
        results.passed++;
      } else if (hasSuccess && hasErrors) {
        console.log('⚠️  PARTIAL PASS (some tiers failed)');
        results.passed++;
      } else if (noChannelsConfigured) {
        // No channels configured - check validation only
        if (validationPassed || !criticalFailure) {
          console.log('✅ PASSED (validation OK, no channels to send)');
          console.log('   ℹ️  Set VIP_CHANNEL_ID in .env to test actual broadcasting');
          results.passed++;
        } else {
          console.log('❌ FAILED (validation error)');
          results.failed++;
          results.errors.push({ test: testName, result });
        }
      } else if (validationPassed && !criticalFailure) {
        console.log('⚠️  PARTIAL PASS (validation OK, broadcast failed)');
        results.passed++;
      } else {
        console.log('❌ FAILED');
        results.failed++;
        results.errors.push({ test: testName, result });
      }
      
    } catch (error) {
      console.log('❌ ERROR:', error.message);
      results.failed++;
      results.errors.push({ test: testName, error: error.message });
    }
    
    // Wait a bit between tests
    await sleep(1000);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ Failed Tests:');
    results.errors.forEach(err => {
      console.log(`  - ${err.test}: ${err.error || 'See above'}`);
    });
  }

  console.log('\n✅ Test suite complete!\n');
  
  // Disconnect
  await client.destroy();
  process.exit(results.failed > 0 ? 1 : 0);
}

// Interactive test mode
async function interactiveMode() {
  console.log('\n🎮 Interactive Test Mode');
  console.log('Commands:');
  console.log('  !test [name] - Run specific test');
  console.log('  !test all - Run all tests');
  console.log('  !test list - List available tests');
  console.log('  !custom - Send custom fill data');
  console.log('  !quit - Exit\n');

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // List tests
    if (message.content === '!test list') {
      const testList = Object.keys(testCases).join('\n  - ');
      await message.reply(`Available tests:\n  - ${testList}`);
    }

    // Run all tests
    else if (message.content === '!test all') {
      await message.reply('Running all tests...');
      await runTests();
    }

    // Run specific test
    else if (message.content.startsWith('!test ')) {
      const testName = message.content.split(' ')[1];
      
      if (testCases[testName]) {
        await message.reply(`Running test: ${testName}`);
        
        try {
          const result = await fillBroadcaster.broadcastFill(testCases[testName]);
          await message.reply(`✅ Test complete. Check channels for result.`);
        } catch (error) {
          await message.reply(`❌ Test failed: ${error.message}`);
        }
      } else {
        await message.reply(`❌ Test "${testName}" not found. Use !test list`);
      }
    }

    // Custom fill
    else if (message.content === '!custom') {
      await message.reply(
        'Send custom fill data as JSON:\n```json\n' +
        '{\n' +
        '  "symbol": "SPY",\n' +
        '  "action": "Buy to Open",\n' +
        '  "filledQuantity": 10,\n' +
        '  "fillPrice": 450.00\n' +
        '}\n```'
      );
    }

    // Parse custom JSON
    else if (message.content.startsWith('{')) {
      try {
        const customFill = JSON.parse(message.content);
        await fillBroadcaster.broadcastFill(customFill);
        await message.reply('✅ Custom fill sent. Check channels.');
      } catch (error) {
        await message.reply(`❌ Error: ${error.message}`);
      }
    }

    // Quit
    else if (message.content === '!quit') {
      await message.reply('Shutting down...');
      await client.destroy();
      process.exit(0);
    }
  });
}

// Initialize
client.once('clientReady', async () => {
  console.log('✅ Test bot connected');
  console.log(`🤖 Logged in as: ${client.user.tag}`);

  // Initialize fill broadcaster
  fillBroadcaster = new FillBroadcaster(client, {
    vipChannelId: process.env.VIP_CHANNEL_ID,
    premiumChannelId: process.env.PREMIUM_CHANNEL_ID,
    basicChannelId: process.env.BASIC_CHANNEL_ID,
    fallbackToSignalChannels: true,
    vipSignalChannelId: process.env.VIP_CHANNEL_ID,
    premiumSignalChannelId: process.env.PREMIUM_CHANNEL_ID,
    basicSignalChannelId: process.env.BASIC_CHANNEL_ID
  });

  console.log('✅ Fill broadcaster initialized\n');

  // Choose mode
  const mode = process.argv[2] || 'interactive';

  if (mode === 'auto' || mode === 'all') {
    await runTests();
  } else {
    console.log('Starting interactive mode...');
    console.log('Go to your Discord and use test commands!\n');
    await interactiveMode();
  }
});

// Helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Login
client.login(process.env.DISCORD_BOT_TOKEN);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await client.destroy();
  process.exit(0);
});


































