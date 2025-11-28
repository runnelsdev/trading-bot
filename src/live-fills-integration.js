/**
 * Live Fills Integration
 * 
 * Connects Tastytrade Account Streamer → Fill Broadcaster → Discord Channels
 * 
 * Usage:
 *   node src/live-fills-integration.js
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const WebSocket = require('ws');

// Required for Node.js environment (needed for account streamer)
global.WebSocket = WebSocket;
global.window = { WebSocket, setTimeout, clearTimeout };

// Import your existing components
const TastytradeIntegration = require('./tastytrade-client');
const FillBroadcaster = require('./fill-broadcaster');

// Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Components
let tastytrade = null;
let fillBroadcaster = null;
let accountStreamer = null;

/**
 * Extract detailed fill data from Tastytrade streamer message
 */
function extractFillFromStreamerMessage(message) {
  try {
    // Handle different message formats from Tastytrade streamer
    
    // Format 1: Order update with status
    if (message.data?.order || message.order) {
      const order = message.data?.order || message.order;
      
      // Only process filled orders
      if (!['Filled', 'Partially Filled', 'PartiallyFilled'].includes(order.status)) {
        return null;
      }
      
      return {
        orderId: order.id || order['order-id'] || `live-${Date.now()}`,
        symbol: order['underlying-symbol'] || order.symbol || order['underlying-symbol'],
        action: normalizeAction(order.action || order['order-action'] || extractActionFromLegs(order.legs)),
        status: order.status,
        filledQuantity: order['filled-quantity'] || order.filledQuantity || order.size || 0,
        totalQuantity: order.size || order.quantity || order['order-quantity'] || 0,
        fillPrice: order['average-fill-price'] || order.price || order['fill-price'] || 0,
        instrumentType: order['instrument-type'] || order.instrumentType || guessInstrumentType(order),
        strike: order.strike || order['strike-price'] || extractFromLegs(order.legs, 'strike'),
        expiration: order.expiration || order['expiration-date'] || extractFromLegs(order.legs, 'expiration'),
        optionType: order['option-type'] || order.optionType || extractFromLegs(order.legs, 'optionType'),
        filledAt: order['filled-at'] || order.filledAt || new Date().toISOString(),
        accountNumber: order['account-number'] || order.accountNumber || process.env.TASTYTRADE_ACCOUNT_NUMBER,
        fees: (order.fees || 0) + (order.commission || 0),
        legs: order.legs || []
      };
    }
    
    // Format 2: Fill event
    if (message.type === 'Fill' || message.data?.type === 'Fill') {
      const fill = message.data || message;
      return {
        orderId: fill['order-id'] || fill.orderId || `fill-${Date.now()}`,
        symbol: fill.symbol || fill['underlying-symbol'],
        action: normalizeAction(fill.action || fill['order-action']),
        status: 'Filled',
        filledQuantity: fill.quantity || fill['filled-quantity'] || 1,
        totalQuantity: fill.quantity || fill['filled-quantity'] || 1,
        fillPrice: fill.price || fill['fill-price'] || 0,
        instrumentType: fill['instrument-type'] || 'Unknown',
        filledAt: fill.timestamp || fill['executed-at'] || new Date().toISOString(),
        accountNumber: fill['account-number'] || process.env.TASTYTRADE_ACCOUNT_NUMBER
      };
    }
    
    // Format 3: Trade execution
    if (message.type === 'Trade' || message.data?.type === 'Trade') {
      const trade = message.data || message;
      return {
        orderId: trade.id || `trade-${Date.now()}`,
        symbol: trade.symbol,
        action: normalizeAction(trade.side || trade.action),
        status: 'Filled',
        filledQuantity: trade.quantity || trade.size,
        fillPrice: trade.price,
        instrumentType: trade.type || 'Equity',
        filledAt: trade.timestamp || new Date().toISOString()
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting fill from streamer message:', error);
    return null;
  }
}

/**
 * Normalize action strings to standard format
 */
function normalizeAction(action) {
  if (!action) return null;
  
  const actionMap = {
    'BTO': 'Buy to Open',
    'BTC': 'Buy to Close',
    'STO': 'Sell to Open',
    'STC': 'Sell to Close',
    'Buy': 'Buy to Open',
    'Sell': 'Sell to Close',
    'buy': 'Buy to Open',
    'sell': 'Sell to Close',
    'LONG': 'Buy to Open',
    'SHORT': 'Sell to Open'
  };
  
  return actionMap[action] || action;
}

/**
 * Extract action from order legs
 */
function extractActionFromLegs(legs) {
  if (!legs || legs.length === 0) return null;
  return legs[0].action || legs[0]['order-action'];
}

/**
 * Extract field from order legs
 */
function extractFromLegs(legs, field) {
  if (!legs || legs.length === 0) return null;
  
  const fieldMap = {
    'strike': ['strike', 'strike-price'],
    'expiration': ['expiration', 'expiration-date'],
    'optionType': ['option-type', 'optionType', 'put-call']
  };
  
  const possibleFields = fieldMap[field] || [field];
  
  for (const leg of legs) {
    for (const f of possibleFields) {
      if (leg[f]) return leg[f];
    }
  }
  
  return null;
}

/**
 * Guess instrument type from order data
 */
function guessInstrumentType(order) {
  if (order.strike || order['strike-price'] || order.expiration) {
    return 'Equity Option';
  }
  if (order.symbol?.includes('/')) {
    return 'Future';
  }
  return 'Equity';
}

/**
 * Handle incoming streamer message
 */
async function handleStreamerMessage(message) {
  console.log('📨 Received streamer message:', JSON.stringify(message, null, 2).substring(0, 500));
  
  const fillData = extractFillFromStreamerMessage(message);
  
  if (fillData) {
    console.log('✅ Extracted fill data:', fillData);
    
    // Broadcast to Discord channels
    const result = await fillBroadcaster.broadcastFill(fillData);
    
    if (result.errors.length > 0) {
      console.error('❌ Errors broadcasting fill:', result.errors);
    } else {
      console.log('✅ Fill broadcast complete:', {
        vip: result.vip?.success,
        premium: result.premium?.success,
        basic: result.basic?.success
      });
    }
  }
}

/**
 * Connect to Tastytrade account streamer
 */
async function connectStreamer() {
  try {
    console.log('🔌 Connecting to Tastytrade...');
    
    // Initialize Tastytrade integration (handles OAuth properly)
    tastytrade = new TastytradeIntegration();
    
    // Authenticate first - this establishes the session
    await tastytrade.authenticate();
    console.log('✅ Connected to Tastytrade API');
    
    // Get accounts to verify connection
    const accounts = await tastytrade.getAccounts();
    console.log(`✅ Found ${accounts.length} account(s)`);
    
    // Get account streamer
    if (tastytrade.client && tastytrade.client.accountStreamer) {
      accountStreamer = tastytrade.client.accountStreamer;
      
      // Add message observer
      accountStreamer.addMessageObserver((message) => {
        handleStreamerMessage(message);
      });
      
      // Start streamer
      await accountStreamer.start();
      console.log('✅ Account streamer started');
      
      // Subscribe to account
      const accountNumber = process.env.TASTYTRADE_ACCOUNT_NUMBER;
      await accountStreamer.subscribeToAccounts([accountNumber]);
      console.log(`✅ Subscribed to account: ${accountNumber}`);
      
      return true;
    } else {
      console.warn('⚠️  Account streamer not available on client');
      console.log('   This may be a sandbox limitation');
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to connect streamer:', error.message);
    return false;
  }
}

/**
 * Main startup
 */
async function main() {
  console.log('🚀 Starting Live Fills Integration...\n');
  
  // Validate environment
  const required = [
    'DISCORD_BOT_TOKEN',
    'TASTYTRADE_USERNAME', 
    'TASTYTRADE_PASSWORD',
    'TASTYTRADE_ACCOUNT_NUMBER'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    process.exit(1);
  }
  
  // Check for channel configuration
  if (!process.env.VIP_CHANNEL_ID && !process.env.PREMIUM_CHANNEL_ID && !process.env.BASIC_CHANNEL_ID) {
    console.warn('⚠️  No tier channel IDs configured');
    console.warn('   Set VIP_CHANNEL_ID, PREMIUM_CHANNEL_ID, BASIC_CHANNEL_ID in .env');
  }
  
  // Connect Discord
  client.once('ready', async () => {
    console.log(`✅ Discord connected as: ${client.user.tag}`);
    
    // Initialize fill broadcaster
    fillBroadcaster = new FillBroadcaster(client, {
      vipChannelId: process.env.VIP_CHANNEL_ID,
      premiumChannelId: process.env.PREMIUM_CHANNEL_ID,
      basicChannelId: process.env.BASIC_CHANNEL_ID,
      vipFillsChannelId: process.env.VIP_FILLS_CHANNEL_ID,
      premiumFillsChannelId: process.env.PREMIUM_FILLS_CHANNEL_ID,
      basicFillsChannelId: process.env.BASIC_FILLS_CHANNEL_ID
    });
    console.log('✅ Fill broadcaster initialized');
    
    // Connect to Tastytrade streamer
    const streamerConnected = await connectStreamer();
    
    if (streamerConnected) {
      console.log('\n✅ Live fills integration ready!');
      console.log('   Listening for order fills from Tastytrade...');
      console.log('   Fills will be broadcast to your Discord channels\n');
    } else {
      console.log('\n⚠️  Running without live streamer');
      console.log('   You can still test with !test-fill command\n');
    }
  });
  
  // Handle admin commands
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    
    const content = message.content.toLowerCase();
    
    // Status command
    if (content === '!live-status') {
      const status = {
        discord: '✅ Connected',
        tastytrade: tastytrade ? '✅ Connected' : '❌ Not connected',
        streamer: accountStreamer ? '✅ Listening' : '❌ Not available',
        channels: {
          vip: process.env.VIP_CHANNEL_ID ? '✅' : '❌',
          premium: process.env.PREMIUM_CHANNEL_ID ? '✅' : '❌',
          basic: process.env.BASIC_CHANNEL_ID ? '✅' : '❌'
        }
      };
      
      await message.reply(
        '**📊 Live Fills Status**\n' +
        '```\n' +
        `Discord:    ${status.discord}\n` +
        `Tastytrade: ${status.tastytrade}\n` +
        `Streamer:   ${status.streamer}\n` +
        `Channels:   VIP ${status.channels.vip} | Premium ${status.channels.premium} | Basic ${status.channels.basic}\n` +
        '```'
      );
    }
    
    // Manual test fill
    if (content === '!test-fill') {
      const testFill = {
        orderId: `LIVE-TEST-${Date.now()}`,
        symbol: 'SPY',
        action: 'Buy to Open',
        status: 'Filled',
        filledQuantity: 1,
        fillPrice: 450.00,
        instrumentType: 'Equity Option',
        strike: 450,
        expiration: '2024-12-20',
        optionType: 'CALL',
        filledAt: new Date().toISOString(),
        accountNumber: process.env.TASTYTRADE_ACCOUNT_NUMBER
      };
      
      await message.reply('📤 Sending test fill...');
      const result = await fillBroadcaster.broadcastFill(testFill);
      
      const successCount = [result.vip, result.premium, result.basic]
        .filter(r => r?.success).length;
      
      await message.reply(`✅ Test fill sent to ${successCount}/3 tiers`);
    }
    
    // Reconnect command
    if (content === '!reconnect') {
      await message.reply('🔄 Reconnecting to Tastytrade...');
      const success = await connectStreamer();
      await message.reply(success ? '✅ Reconnected!' : '❌ Failed to reconnect');
    }
  });
  
  // Login to Discord
  await client.login(process.env.DISCORD_BOT_TOKEN);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  
  if (accountStreamer) {
    try {
      await accountStreamer.stop();
      console.log('✅ Account streamer stopped');
    } catch (e) {}
  }
  
  if (client) {
    client.destroy();
    console.log('✅ Discord disconnected');
  }
  
  process.exit(0);
});

// Start
main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
