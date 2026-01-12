require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const TradingBroadcaster = require('./trading-broadcaster');
const FillBroadcaster = require('./fill-broadcaster');
const ConfigClient = require('./ConfigClient');

// Handle uncaught exceptions to prevent crashes from library issues
process.on('uncaughtException', (error) => {
  console.error('⚠️  Uncaught exception (non-fatal):', error.message);
  // Don't crash - just log and continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️  Unhandled rejection (non-fatal):', reason);
  // Don't crash - just log and continue
});

// Initialize Discord client
const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let tradingBroadcaster = null;
let fillBroadcaster = null;
let configClient = null;

// Discord bot ready
discordClient.once('clientReady', async () => {
  console.log('✅ Discord bot is online!');
  console.log(`Logged in as ${discordClient.user.tag}`);
  
  try {
    await discordClient.user.setActivity('Trading', { type: ActivityType.Playing });
    await discordClient.user.setStatus('online');
    console.log('✅ Presence set successfully');
  } catch (error) {
    console.error('❌ Error setting presence:', error);
  }

  // Initialize Trading Broadcaster
  const accountNumber = process.env.TASTYTRADE_ACCOUNT_NUMBER || '5WT00000';
  const configProfile = process.env.QUEUE_CONFIG_PROFILE || 'balanced'; // aggressive, balanced, conservative
  
  console.log(`\n📊 Initializing Trading Broadcaster...`);
  console.log(`   Account: ${accountNumber}`);
  console.log(`   Config: ${configProfile}`);
  
  tradingBroadcaster = new TradingBroadcaster(discordClient, accountNumber, configProfile);
  await tradingBroadcaster.initialize();
  
  // Initialize Fill Broadcaster for fill notifications
  fillBroadcaster = new FillBroadcaster(discordClient);
  console.log('✅ Fill Broadcaster initialized');
  
  // Initialize Central Server connection (optional)
  // Need CENTRAL_SERVER_URL, CENTRAL_BOT_TOKEN, and either CENTRAL_SUBSCRIBER_ID or DEPLOYMENT_ID
  if (process.env.CENTRAL_SERVER_URL && process.env.CENTRAL_BOT_TOKEN && (process.env.CENTRAL_SUBSCRIBER_ID || process.env.DEPLOYMENT_ID)) {
    try {
      configClient = new ConfigClient({
        serverUrl: process.env.CENTRAL_SERVER_URL,
        subscriberId: process.env.CENTRAL_SUBSCRIBER_ID,
        deploymentId: process.env.DEPLOYMENT_ID,
        botToken: process.env.CENTRAL_BOT_TOKEN
      });
      
      if (process.env.CENTRAL_DISCORD_USER_ID) {
        await configClient.authenticate(process.env.CENTRAL_DISCORD_USER_ID);
        console.log('✅ Central Server connected');
      }
    } catch (error) {
      console.warn('⚠️  Central Server connection failed:', error.message);
      configClient = null;
    }
  }
  
  // Connect to account streamer for real-time fill notifications
  try {
    await tradingBroadcaster.connectAccountStreamer();
  } catch (error) {
    console.log('⚠️  Account streamer not available (may be sandbox limitation)');
  }

  console.log('\n✅ Trading bot fully initialized!\n');
  
  // Print latency stats every 5 minutes
  setInterval(() => {
    tradingBroadcaster.printLatencyStats(300000); // Last 5 minutes
  }, 300000);
});

// Handle Discord messages
discordClient.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Command: !queue-status
  if (message.content === '!queue-status') {
    if (!tradingBroadcaster) {
      await message.reply('Trading broadcaster not initialized');
      return;
    }

    const status = tradingBroadcaster.getQueueStatus();
    await message.reply(
      `📊 **Queue Status**\n` +
      `Queue length: ${status.queueLength}\n` +
      `Active orders: ${status.activeOrders}\n` +
      `Orders this minute: ${status.ordersThisMinute}/${status.maxOrdersPerMinute}\n` +
      `Processing: ${status.processing ? 'Yes' : 'No'}`
    );
  }

  // Command: !latency-stats
  if (message.content === '!latency-stats') {
    if (!tradingBroadcaster) {
      await message.reply('Trading broadcaster not initialized');
      return;
    }

    const stats = tradingBroadcaster.getLatencyStats(3600000); // Last hour
    if (stats.count > 0) {
      await message.reply(
        `⏱️  **Latency Stats (Last Hour)**\n` +
        `Count: ${stats.count}\n` +
        `Min: ${stats.min}ms\n` +
        `Max: ${stats.max}ms\n` +
        `Avg: ${Math.round(stats.avg)}ms\n` +
        `Median: ${stats.median}ms\n` +
        `P95: ${stats.p95}ms`
      );
    } else {
      await message.reply('No latency data available');
    }
  }

  // Command: !test-fill - Test fill notifications
  if (message.content === '!test-fill') {
    if (!fillBroadcaster) {
      await message.reply('Fill broadcaster not initialized');
      return;
    }

    try {
      await message.reply('🧪 Sending test fill...');
      
      const testFill = {
        orderId: `LIVE-TEST-${Date.now()}`,
        symbol: 'SPY',
        action: 'Buy to Open',
        quantity: 1,
        fillPrice: 450.00,
        totalValue: 45000.00,
        type: 'Equity Option',
        optionType: 'CALL',
        strike: 450,
        expiration: '2024-12-20',
        status: 'Filled',
        accountNumber: process.env.TASTYTRADE_ACCOUNT_NUMBER || '**8917'
      };

      const result = await fillBroadcaster.broadcastFill(testFill);
      
      // Count successful sends
      const successCount = [result.vip, result.premium, result.basic]
        .filter(r => r && r.success).length;
      const totalTiers = [result.vip, result.premium, result.basic]
        .filter(r => r && !r.skipped).length;
      
      if (successCount > 0) {
        await message.reply(`✅ Test fill sent to ${successCount}/${totalTiers} tiers`);
      } else {
        await message.reply(`❌ Test fill failed: ${result.errors?.[0]?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Test fill error:', error);
      await message.reply(`❌ Test fill failed: ${error.message}`);
    }
    return;
  }

  // Command: !central-status - Check Central Server status
  if (message.content === '!central-status') {
    if (!configClient) {
      await message.reply('🔴 Central Server not configured or connection failed');
      return;
    }

    const status = configClient.getStatus();
    if (!status) {
      await message.reply('🔴 Not authenticated with Central Server');
      return;
    }

    const canTrade = configClient.canTradeToday();
    const validUntil = new Date(status.validUntil).toLocaleString();
    
    await message.reply(
      `🏢 **Central Server Status**\n` +
      `Status: ${canTrade ? '✅ Trading Enabled' : '⛔ Trading Disabled'}\n` +
      `Tier: ${status.tier}\n` +
      `Monthly Profit: $${status.monthlyProfitUsed?.toLocaleString() || 0} / $${status.monthlyCapLimit?.toLocaleString() || 0}\n` +
      `Max Position: $${status.maxPositionSize?.toLocaleString() || 0}\n` +
      `Valid Until: ${validUntil}\n` +
      (status.reason ? `Reason: ${status.reason}\n` : '') +
      (status.message ? `Message: ${status.message}` : '')
    );
    return;
  }

  // Command: !queue-order (example)
  // Format: !queue-order SYMBOL QUANTITY ACTION [PRIORITY]
  if (message.content.startsWith('!queue-order')) {
    if (!tradingBroadcaster) {
      await message.reply('Trading broadcaster not initialized');
      return;
    }

    // Parse command (simplified - you'd want better parsing)
    const parts = message.content.split(' ');
    if (parts.length < 4) {
      await message.reply('Usage: !queue-order SYMBOL QUANTITY ACTION [PRIORITY]');
      return;
    }

    const symbol = parts[1];
    const quantity = parseInt(parts[2]);
    const action = parts[3]; // Buy, Sell, etc.
    const priority = parts[4] ? parseInt(parts[4]) : 0;

    // Create order data (simplified)
    const orderData = {
      'time-in-force': 'Day',
      'order-type': 'Market',
      'size': quantity,
      'underlying-symbol': symbol,
      'legs': [{
        'instrument-type': 'Equity',
        'symbol': symbol,
        'quantity': quantity,
        'action': action
      }]
    };

    try {
      await tradingBroadcaster.queueOrder(orderData, { priority });
      await message.reply(`✅ Order queued: ${action} ${quantity} ${symbol} (Priority: ${priority})`);
    } catch (error) {
      await message.reply(`❌ Failed to queue order: ${error.message}`);
    }
  }
});

// Login to Discord
discordClient.login(process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  
  if (tradingBroadcaster && tradingBroadcaster.queueManager) {
    console.log('Clearing order queue...');
    tradingBroadcaster.queueManager.clearQueue();
  }
  
  if (discordClient) {
    await discordClient.destroy();
  }
  
  process.exit(0);
});

