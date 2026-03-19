require('dotenv').config();
const express = require('express');
const path = require('path');
const ConfigManager = require('./ConfigManager');
const DiscordListener = require('./DiscordListener');
const TastytradeExecutor = require('./TastytradeExecutor');
const ConfigClient = require('./ConfigClient');

/**
 * Subscriber Bot Main Entry Point
 *
 * Three states:
 *   1. setup    - No config exists, show setup wizard
 *   2. online   - Connected to Tastytrade + Discord, trading
 *   3. offline  - Config exists but login failed, show management UI with retry
 */
async function main() {
  const configManager = new ConfigManager();

  // Check if this is first run (no config at all)
  if (process.env.FIRST_RUN === 'true' || !configManager.isConfigured()) {
    startSetupMode(configManager, 'Awaiting initial setup');
    return;
  }

  // Config exists — try to connect
  console.log('🚀 Starting trading bot...');

  const botConfig = await configManager.load();

  if (!botConfig.discordBotToken) {
    startOfflineMode(configManager, botConfig, 'DISCORD_BOT_TOKEN not found in .env');
    return;
  }

  const executor = new TastytradeExecutor(botConfig);

  // Try to connect with retries
  const connected = await connectWithRetry(executor, botConfig);

  if (connected) {
    await startOnlineMode(executor, botConfig, configManager);
  } else {
    startOfflineMode(configManager, botConfig, 'Could not connect to Tastytrade after retries');
  }
}

/**
 * Try connecting to Tastytrade with retries
 */
async function connectWithRetry(executor, botConfig, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔐 Login attempt ${attempt}/${maxRetries}...`);
      await executor.connect();
      console.log('✅ TASTYTRADE: LOGGED IN');
      return true;
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxRetries) {
        const wait = attempt * 10;
        console.log(`⏳ Waiting ${wait}s before retry...`);
        await new Promise(r => setTimeout(r, wait * 1000));
      }
    }
  }
  return false;
}

/**
 * Bot is connected and trading
 */
async function startOnlineMode(executor, botConfig, configManager) {
  const listener = new DiscordListener(botConfig, executor);
  await listener.start();
  console.log('✅ DISCORD: CONNECTED');

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  ✅ BOT ONLINE - All systems connected');
  console.log('═══════════════════════════════════════');
  console.log(`  📡 Channel: ${botConfig.channelName}`);
  console.log(`  💼 Tastytrade: ${botConfig.tastytradeAccountNumber}`);
  console.log(`  📊 Sizing: ${botConfig.sizingMethod}`);
  console.log(`  🛡️  Max loss: $${botConfig.maxDailyLoss}`);
  console.log('═══════════════════════════════════════');
  console.log('');

  // Connect to central server for heartbeats
  if (process.env.CENTRAL_SERVER_URL && process.env.CENTRAL_BOT_TOKEN && (process.env.CENTRAL_SUBSCRIBER_ID || process.env.DEPLOYMENT_ID)) {
    try {
      const configClient = new ConfigClient({
        serverUrl: process.env.CENTRAL_SERVER_URL,
        subscriberId: process.env.CENTRAL_SUBSCRIBER_ID,
        deploymentId: process.env.DEPLOYMENT_ID,
        botToken: process.env.CENTRAL_BOT_TOKEN
      });

      // Sync config to central server via heartbeat
      configClient.channelName = botConfig.channelName;
      configClient.tastytradeAccount = botConfig.tastytradeAccountNumber;

      if (process.env.CENTRAL_DISCORD_USER_ID) {
        await configClient.authenticate(process.env.CENTRAL_DISCORD_USER_ID);
        console.log('✅ Central Server connected');
        configClient.startHeartbeat(60000);
      }
    } catch (error) {
      console.warn('⚠️  Central Server connection failed:', error.message);
    }
  }

  // Start web server for management
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  const startedAt = new Date().toISOString();
  app.get('/api/bot-status', (req, res) => {
    const status = executor.getStatus ? executor.getStatus() : {};
    res.json({
      state: 'online',
      tastytrade: status.connected !== false ? 'connected' : 'disconnected',
      discord: listener.isConnected ? 'connected' : 'disconnected',
      account: botConfig.tastytradeAccountNumber,
      channel: botConfig.channelName,
      sizing: botConfig.sizingMethod,
      startedAt
    });
  });

  require('../config/setup-server')(app, configManager);

  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Management UI: http://localhost:${port}`);
  });

  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await listener.stop();
    process.exit(0);
  });
}

/**
 * Config exists but login failed — keep config, serve management UI, retry periodically
 */
function startOfflineMode(configManager, botConfig, errorMessage) {
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('  ❌ BOT OFFLINE - Login failed');
  console.log(`  Reason: ${errorMessage}`);
  console.log('  Config preserved — will retry every 5 min');
  console.log('  Or reconfigure via the setup page');
  console.log('═══════════════════════════════════════');
  console.log('');

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  let lastError = errorMessage;
  let retryCount = 0;
  let retrying = false;

  app.get('/api/bot-status', (req, res) => {
    res.json({
      state: 'offline',
      tastytrade: 'not connected',
      discord: 'not connected',
      account: botConfig?.tastytradeAccountNumber || null,
      channel: botConfig?.channelName || null,
      error: lastError,
      retryCount,
      nextRetry: '~5 min'
    });
  });

  // Manual retry endpoint
  app.post('/api/retry-login', async (req, res) => {
    if (retrying) {
      return res.json({ success: false, message: 'Retry already in progress' });
    }
    const result = await attemptReconnect();
    res.json(result);
  });

  require('../config/setup-server')(app, configManager);

  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 Management UI: http://localhost:${port}`);
    console.log('   Reconfigure or wait for automatic retry\n');
  });

  // Retry login every 5 minutes
  async function attemptReconnect() {
    retrying = true;
    retryCount++;
    console.log(`\n🔄 Retry #${retryCount} — attempting Tastytrade login...`);

    try {
      const freshConfig = await configManager.load();
      const executor = new TastytradeExecutor(freshConfig);
      await executor.connect();

      console.log('✅ Reconnected! Restarting bot...');
      retrying = false;

      // Restart process so it enters online mode cleanly
      setTimeout(() => process.exit(0), 1000);
      return { success: true, message: 'Connected! Bot restarting...' };

    } catch (error) {
      lastError = error.message;
      retrying = false;
      console.log(`❌ Retry #${retryCount} failed: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  // Auto-retry every 5 minutes
  setInterval(() => {
    if (!retrying) {
      attemptReconnect();
    }
  }, 5 * 60 * 1000);
}

/**
 * No config at all — first-time setup
 */
function startSetupMode(configManager, message) {
  console.log('🔧 Starting configuration server...');

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/api/bot-status', (req, res) => {
    res.json({
      state: 'setup',
      tastytrade: 'not configured',
      discord: 'not configured',
      message
    });
  });

  require('../config/setup-server')(app, configManager);

  const port = process.env.PORT || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`\n📝 Configuration UI available at: http://YOUR_DROPLET_IP:${port}`);
    console.log('🔐 Complete the setup to start your trading bot\n');
  });
}

main().catch(console.error);
