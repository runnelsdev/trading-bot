require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const SignalRelay = require('./signal-relay');
const FillBroadcaster = require('./fill-broadcaster');
const TradingBroadcaster = require('./trading-broadcaster');

/**
 * Signal Relay Bot
 * Listens to Tastytrade Discord signals and relays to tiered subscriber channels
 * Monitors Tastytrade order fills and broadcasts fill notifications
 */

// Initialize Discord client for YOUR server
const myDiscordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Initialize signal relay and fill broadcaster
let signalRelay = null;
let fillBroadcaster = null;
let tradingBroadcaster = null;

// Configuration
const config = {
  // Tastytrade Discord (source)
  tastytradeServerId: process.env.TASTYTRADE_SERVER_ID,
  tastytradeSignalChannelId: process.env.TASTYTRADE_SIGNAL_CHANNEL_ID,
  
  // Your Discord Server (destination)
  yourServerId: process.env.YOUR_SERVER_ID,
  
  // Signal channels (tiered)
  vipChannelId: process.env.VIP_CHANNEL_ID,
  premiumChannelId: process.env.PREMIUM_CHANNEL_ID,
  basicChannelId: process.env.BASIC_CHANNEL_ID,
  
  // Fill notification channels (optional - will use signal channels if not set)
  vipFillsChannelId: process.env.VIP_FILLS_CHANNEL_ID,
  premiumFillsChannelId: process.env.PREMIUM_FILLS_CHANNEL_ID,
  basicFillsChannelId: process.env.BASIC_FILLS_CHANNEL_ID,
  
  // Auto-trade settings
  autoTradeEnabled: process.env.AUTO_TRADE_ENABLED === 'true',
  accountNumber: process.env.TASTYTRADE_ACCOUNT_NUMBER || '5WT00000',
  queueConfigProfile: process.env.QUEUE_CONFIG_PROFILE || 'balanced'
};

// Bot ready
myDiscordClient.once('clientReady', async () => {
  console.log('✅ Signal Relay Bot is online!');
  console.log(`🤖 Logged in as: ${myDiscordClient.user.tag}`);
  
  // Set presence
  try {
    await myDiscordClient.user.setActivity('Trading Signals', { type: ActivityType.Watching });
    await myDiscordClient.user.setStatus('online');
  } catch (error) {
    console.error('❌ Error setting presence:', error);
  }

  // Validate configuration
  if (!config.tastytradeServerId || !config.tastytradeSignalChannelId) {
    console.error('❌ Missing Tastytrade Discord configuration!');
    console.error('   Set TASTYTRADE_SERVER_ID and TASTYTRADE_SIGNAL_CHANNEL_ID in .env');
    process.exit(1);
  }

  if (!config.vipChannelId) {
    console.warn('⚠️  No VIP channel configured');
  }

  // Initialize Signal Relay
  signalRelay = new SignalRelay(myDiscordClient, {
    vipChannelId: config.vipChannelId,
    premiumChannelId: config.premiumChannelId,
    basicChannelId: config.basicChannelId
  });

  // Initialize Fill Broadcaster
  fillBroadcaster = new FillBroadcaster(myDiscordClient, {
    vipFillsChannelId: config.vipFillsChannelId,
    premiumFillsChannelId: config.premiumFillsChannelId,
    basicFillsChannelId: config.basicFillsChannelId,
    // Fallback to signal channels if no separate fills channels
    fallbackToSignalChannels: true,
    vipSignalChannelId: config.vipChannelId,
    premiumSignalChannelId: config.premiumChannelId,
    basicSignalChannelId: config.basicChannelId
  });

  console.log('✅ Signal Relay initialized');
  console.log('✅ Fill Broadcaster initialized');
  console.log(`📡 Listening to Tastytrade: Server ${config.tastytradeServerId}, Channel ${config.tastytradeSignalChannelId}`);
  console.log(`📤 Relaying to channels:`);
  if (config.vipChannelId) console.log(`   👑 VIP: ${config.vipChannelId}`);
  if (config.premiumChannelId) console.log(`   💎 Premium: ${config.premiumChannelId}`);
  if (config.basicChannelId) console.log(`   🥉 Basic: ${config.basicChannelId}`);

  // Initialize Trading Broadcaster if auto-trade enabled
  if (config.autoTradeEnabled) {
    console.log(`\n🤖 Auto-trade ENABLED`);
    console.log(`   Account: ${config.accountNumber}`);
    console.log(`   Config: ${config.queueConfigProfile}`);
    
    tradingBroadcaster = new TradingBroadcaster(
      myDiscordClient, 
      config.accountNumber, 
      config.queueConfigProfile
    );
    await tradingBroadcaster.initialize();
    
    // Connect to account streamer for fill notifications
    try {
      await tradingBroadcaster.connectAccountStreamer();
      
      // Hook into fill notifications
      setupFillNotifications(tradingBroadcaster);
      
      console.log('✅ Fill notifications connected');
    } catch (error) {
      console.log('⚠️  Account streamer not available (may be sandbox limitation)');
    }
    
    console.log('✅ Auto-trade system ready');
  } else {
    console.log(`\n⏸️  Auto-trade DISABLED (relay only mode)`);
  }

  console.log('\n✅ Signal Relay Bot fully initialized!\n');
});

/**
 * Setup fill notification monitoring from Tastytrade account streamer
 */
function setupFillNotifications(broadcaster) {
  if (!broadcaster.accountStreamer) {
    console.warn('⚠️  Account streamer not available for fill notifications');
    return;
  }

  // Override or extend the streamer message handler
  const originalHandler = broadcaster.handleStreamerMessage.bind(broadcaster);
  
  broadcaster.handleStreamerMessage = async function(message) {
    // Call original handler
    await originalHandler(message);
    
    // Extract and broadcast fill if present
    const fillData = extractDetailedFillData(message);
    
    if (fillData && fillBroadcaster) {
      console.log(`📨 Fill detected: ${fillData.symbol} ${fillData.action} ${fillData.filledQuantity}`);
      
      // Broadcast to tiered channels
      await fillBroadcaster.broadcastFill(fillData);
    }
  };
}

/**
 * Extract detailed fill data from Tastytrade streamer message
 */
function extractDetailedFillData(message) {
  try {
    // Tastytrade streamer message structure varies by message type
    // Check for order fill events
    
    if (message.type === 'Order' && message.data) {
      const order = message.data.order || message.data;
      
      // Check if filled
      if (order.status === 'Filled' || order.status === 'Partially Filled') {
        const fill = {
          type: 'fill',
          orderId: order.id || order['order-id'],
          symbol: order['underlying-symbol'] || order.symbol,
          action: order.legs?.[0]?.action || 'Unknown',
          status: order.status,
          
          // Quantities
          filledQuantity: order['filled-quantity'] || order.filledQuantity || order.size,
          totalQuantity: order['total-quantity'] || order.totalQuantity || order.size,
          
          // Pricing
          fillPrice: order['avg-fill-price'] || order.avgFillPrice || order.price,
          price: order.price,
          
          // Instrument details
          instrumentType: order.legs?.[0]?['instrument-type'] || 'Equity',
          
          // Option details (if applicable)
          strike: order.legs?.[0]?.['strike-price'],
          expiration: order.legs?.[0]?.['expiration-date'],
          optionType: order.legs?.[0]?.['option-type'],
          
          // Timing
          filledAt: order['filled-at'] || order.filledAt || new Date(),
          timestamp: order['created-at'] || order.createdAt || new Date(),
          
          // Account
          accountNumber: order['account-number'] || order.accountNumber,
          
          // Fees
          fees: order.fees,
          commission: order.commission,
          
          // Execution
          executionVenue: order['execution-venue'] || order.executionVenue,
          
          // Original message for debugging
          rawData: order
        };
        
        return fill;
      }
    }
    
    // Check for fill-specific events
    if (message.type === 'Fill' || message.type === 'Trade') {
      const fill = message.data;
      
      return {
        type: 'fill',
        orderId: fill['order-id'] || fill.orderId,
        symbol: fill.symbol || fill['underlying-symbol'],
        action: fill.action || fill.side,
        status: 'Filled',
        
        filledQuantity: fill.quantity || fill.size,
        fillPrice: fill.price,
        
        instrumentType: fill['instrument-type'] || 'Equity',
        
        filledAt: fill['executed-at'] || fill.executedAt || new Date(),
        timestamp: new Date(),
        
        accountNumber: fill['account-number'] || fill.accountNumber,
        
        rawData: fill
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting fill data:', error);
    return null;
  }
}

// Listen for messages from Tastytrade Discord
myDiscordClient.on('messageCreate', async (message) => {
  try {
    // Only process messages from Tastytrade's signal channel
    if (message.guild?.id !== config.tastytradeServerId) return;
    if (message.channel?.id !== config.tastytradeSignalChannelId) return;

    // Ignore non-bot messages (assuming Tastytrade uses a bot to post signals)
    // Adjust this logic based on how Tastytrade posts signals
    if (!message.author.bot) {
      console.log(`ℹ️  Non-bot message in Tastytrade channel (might not be a signal)`);
      // Uncomment to ignore human messages: return;
    }

    console.log(`\n🔔 New message detected in Tastytrade channel`);
    console.log(`   From: ${message.author.tag}`);
    console.log(`   Content: ${message.content ? message.content.substring(0, 100) : '[No text]'}`);
    console.log(`   Embeds: ${message.embeds.length}`);

    // Parse signal from message
    const signal = await parseSignal(message);
    
    if (!signal) {
      console.log('⚠️  Could not parse signal from message');
      return;
    }

    console.log(`✅ Signal parsed:`, JSON.stringify(signal, null, 2));

    // Relay to tiered channels
    if (signalRelay) {
      const relayResults = await signalRelay.distribute(signal);
      console.log(`📡 Relay results:`, relayResults);
      
      // Track which tiers received this signal (for fill notifications)
      if (fillBroadcaster && signal.id) {
        const sentTiers = Object.keys(relayResults).filter(
          tier => relayResults[tier] && relayResults[tier].success
        );
        fillBroadcaster.trackSignalTiers(signal.id, sentTiers);
      }
    }

    // Execute trade if auto-trade enabled
    if (config.autoTradeEnabled && tradingBroadcaster) {
      console.log(`🎯 Executing trade...`);
      
      // Convert signal to order format
      const orderData = convertSignalToOrder(signal);
      
      try {
        await tradingBroadcaster.queueOrder(orderData, {
          priority: signal.confidence === 'HIGH' ? 8 : 5
        });
        console.log(`✅ Trade queued for execution`);
      } catch (error) {
        console.error(`❌ Trade execution failed:`, error.message);
      }
    }

  } catch (error) {
    console.error('❌ Error processing message:', error);
  }
});

// Admin commands in YOUR Discord
myDiscordClient.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.guild?.id !== config.yourServerId) return;

  // Command: !relay-status
  if (message.content === '!relay-status') {
    const stats = signalRelay ? signalRelay.getStats() : {};
    await message.reply(
      `📊 **Signal Relay Status**\n` +
      `Filtering: ${stats.filteringEnabled ? 'Enabled' : 'Disabled'}\n` +
      `VIP Channel: ${stats.vipChannelId || 'Not configured'}\n` +
      `Premium Channel: ${stats.premiumChannelId || 'Not configured'}\n` +
      `Basic Channel: ${stats.basicChannelId || 'Not configured'}\n` +
      `Auto-trade: ${config.autoTradeEnabled ? 'Enabled' : 'Disabled'}`
    );
  }

  // Command: !test-signal
  if (message.content === '!test-signal') {
    const testSignal = {
      symbol: 'SPY',
      action: 'Buy to Open',
      quantity: 1,
      orderType: 'Market',
      contractType: 'CALL',
      strike: 450,
      expiration: '2024-12-15',
      entryPrice: 2.50,
      stopLoss: 1.80,
      target: 3.50,
      confidence: 'HIGH',
      strategy: 'Test signal from admin command',
      timestamp: new Date()
    };

    if (signalRelay) {
      await signalRelay.distribute(testSignal);
      await message.reply('✅ Test signal sent to all tiers');
    } else {
      await message.reply('❌ Signal relay not initialized');
    }
  }

  // Command: !queue-status (if auto-trade enabled)
  if (message.content === '!queue-status' && tradingBroadcaster) {
    const status = tradingBroadcaster.getQueueStatus();
    await message.reply(
      `📊 **Trade Queue Status**\n` +
      `Queue length: ${status.queueLength}\n` +
      `Active orders: ${status.activeOrders}\n` +
      `Orders this minute: ${status.ordersThisMinute}/${status.maxOrdersPerMinute}\n` +
      `Processing: ${status.processing ? 'Yes' : 'No'}`
    );
  }

  // Command: !fill-stats
  if (message.content === '!fill-stats' && fillBroadcaster) {
    const stats = fillBroadcaster.getStats(3600000); // Last hour
    
    let response = `📊 **Fill Statistics (Last Hour)**\n`;
    response += `Total Fills: ${stats.totalFills}\n`;
    response += `Total Value: $${stats.totalValue.toFixed(2)}\n\n`;
    
    if (Object.keys(stats.bySymbol).length > 0) {
      response += `By Symbol:\n`;
      Object.entries(stats.bySymbol)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([symbol, count]) => {
          response += `  ${symbol}: ${count}\n`;
        });
    }
    
    if (Object.keys(stats.byAction).length > 0) {
      response += `\nBy Action:\n`;
      Object.entries(stats.byAction).forEach(([action, count]) => {
        response += `  ${action}: ${count}\n`;
      });
    }
    
    await message.reply(response || 'No fill data available');
  }

  // Command: !test-fill
  if (message.content === '!test-fill' && fillBroadcaster) {
    const testFill = {
      orderId: 'TEST-' + Date.now(),
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
      commission: 1.00
    };

    await fillBroadcaster.broadcastFill(testFill);
    await message.reply('✅ Test fill notification sent to all tiers');
  }
});

/**
 * Parse signal from Discord message
 * Handles both embeds and text formats
 */
async function parseSignal(message) {
  let signal = null;

  // Try parsing embed first
  if (message.embeds.length > 0) {
    signal = parseSignalFromEmbed(message.embeds[0]);
  }

  // Fallback to text parsing
  if (!signal && message.content) {
    signal = parseSignalFromText(message.content);
  }

  // Validate signal has minimum required fields
  if (signal && !signal.symbol) {
    console.warn('⚠️  Signal missing symbol');
    return null;
  }

  if (signal && !signal.action) {
    console.warn('⚠️  Signal missing action');
    return null;
  }

  return signal;
}

/**
 * Parse signal from Discord embed
 */
function parseSignalFromEmbed(embed) {
  const signal = {
    timestamp: embed.timestamp ? new Date(embed.timestamp) : new Date(),
    id: `signal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` // Generate unique ID
  };

  // Check if this is actually a signal
  const title = (embed.title || '').toUpperCase();
  const description = (embed.description || '').toUpperCase();
  
  if (!title.includes('SIGNAL') && !title.includes('TRADE') && !title.includes('ALERT') &&
      !description.includes('SIGNAL') && !description.includes('TRADE')) {
    return null; // Not a signal
  }

  // Extract from embed fields
  embed.fields?.forEach(field => {
    const name = field.name.toLowerCase().replace(/\s+/g, '');
    const value = field.value;

    if (name.includes('symbol') || name.includes('ticker')) {
      signal.symbol = value.trim().toUpperCase();
    }
    if (name.includes('action')) {
      signal.action = normalizeAction(value);
    }
    if (name.includes('quantity') || name.includes('size') || name.includes('contracts')) {
      signal.quantity = parseInt(value) || 1;
    }
    if (name.includes('type') && !name.includes('order')) {
      signal.contractType = value.toUpperCase();
    }
    if (name.includes('strike')) {
      signal.strike = parseFloat(value.replace(/[$,]/g, ''));
    }
    if (name.includes('expir')) {
      signal.expiration = value.trim();
    }
    if (name.includes('entry') || (name.includes('price') && !name.includes('target'))) {
      signal.entryPrice = parseFloat(value.replace(/[$,]/g, ''));
    }
    if (name.includes('stop')) {
      signal.stopLoss = parseFloat(value.replace(/[$,]/g, ''));
    }
    if (name.includes('target') || name.includes('takeprofit')) {
      signal.target = parseFloat(value.replace(/[$,]/g, ''));
    }
    if (name.includes('confidence')) {
      signal.confidence = value.toUpperCase();
    }
    if (name.includes('strategy') || name.includes('notes')) {
      signal.strategy = value;
    }
    if (name.includes('ordertype')) {
      signal.orderType = value;
    }
  });

  return signal.symbol ? signal : null;
}

/**
 * Parse signal from text message
 */
function parseSignalFromText(content) {
  const signal = {
    timestamp: new Date(),
    id: `signal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` // Generate unique ID
  };

  // Look for common signal patterns
  const patterns = {
    symbol: /(?:symbol|ticker)[:\s]*([A-Z]{1,5})/i,
    action: /(?:action|side)[:\s]*(buy|sell|bto|sto|btc|stc)[^\n]*/i,
    quantity: /(?:quantity|size|contracts)[:\s]*(\d+)/i,
    strike: /strike[:\s]*\$?([\d.]+)/i,
    expiration: /expir(?:ation)?[:\s]*(\d+\/\d+\/\d+)/i,
    entryPrice: /(?:entry|price)[:\s]*\$?([\d.]+)/i,
    stopLoss: /stop[:\s]*\$?([\d.]+)/i,
    target: /target[:\s]*\$?([\d.]+)/i,
    confidence: /confidence[:\s]*(high|medium|low)/i
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = content.match(pattern);
    if (match) {
      let value = match[1].trim();
      
      // Type conversion
      if (['strike', 'entryPrice', 'stopLoss', 'target'].includes(key)) {
        signal[key] = parseFloat(value);
      } else if (key === 'quantity') {
        signal[key] = parseInt(value);
      } else if (key === 'action') {
        signal[key] = normalizeAction(value);
      } else if (key === 'confidence') {
        signal[key] = value.toUpperCase();
      } else {
        signal[key] = value;
      }
    }
  }

  return signal.symbol ? signal : null;
}

/**
 * Normalize action to standard format
 */
function normalizeAction(action) {
  const normalized = action.toUpperCase().replace(/\s+/g, '_');
  
  const actionMap = {
    'BUY': 'Buy to Open',
    'BTO': 'Buy to Open',
    'BUY_TO_OPEN': 'Buy to Open',
    'SELL': 'Sell to Open',
    'STO': 'Sell to Open',
    'SELL_TO_OPEN': 'Sell to Open',
    'BTC': 'Buy to Close',
    'BUY_TO_CLOSE': 'Buy to Close',
    'STC': 'Sell to Close',
    'SELL_TO_CLOSE': 'Sell to Close'
  };
  
  return actionMap[normalized] || action;
}

/**
 * Convert signal to Tastytrade order format
 */
function convertSignalToOrder(signal) {
  const orderData = {
    'time-in-force': 'Day',
    'order-type': signal.orderType || 'Market',
    'size': signal.quantity || 1,
    'underlying-symbol': signal.symbol
  };

  // Add price if limit order
  if (orderData['order-type'] === 'Limit' && signal.entryPrice) {
    orderData.price = signal.entryPrice.toFixed(2);
  }

  // Build legs
  if (signal.contractType && signal.strike && signal.expiration) {
    // Options order
    orderData.legs = [{
      'instrument-type': 'Equity Option',
      'symbol': signal.symbol,
      'quantity': signal.quantity || 1,
      'action': signal.action,
      'option-type': signal.contractType,
      'strike-price': signal.strike,
      'expiration-date': signal.expiration
    }];
  } else {
    // Equity order
    orderData.legs = [{
      'instrument-type': 'Equity',
      'symbol': signal.symbol,
      'quantity': signal.quantity || 1,
      'action': signal.action
    }];
  }

  return orderData;
}

// Login to Discord
myDiscordClient.login(process.env.DISCORD_BOT_TOKEN);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  
  if (tradingBroadcaster && tradingBroadcaster.queueManager) {
    console.log('Clearing order queue...');
    tradingBroadcaster.queueManager.clearQueue();
  }
  
  if (myDiscordClient) {
    await myDiscordClient.destroy();
  }
  
  process.exit(0);
});
