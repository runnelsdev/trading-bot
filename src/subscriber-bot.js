require('dotenv').config();
const express = require('express');
const path = require('path');
const ConfigManager = require('./ConfigManager');
const DiscordListener = require('./DiscordListener');
const TastytradeExecutor = require('./TastytradeExecutor');
const ConfigClient = require('./ConfigClient');

/**
 * Subscriber Bot Main Entry Point
 * Handles both configuration mode and running bot mode
 */
async function main() {
  const configManager = new ConfigManager();
  
  // Check if this is first run
  if (process.env.FIRST_RUN === 'true' || !configManager.isConfigured()) {
    console.log('🔧 Starting configuration server...');
    
    // Start web server for configuration
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '../public')));

    app.get('/api/bot-status', (req, res) => {
      res.json({
        state: 'setup',
        tastytrade: 'not configured',
        discord: 'not configured',
        message: 'Awaiting initial setup'
      });
    });

    // Configuration endpoints
    require('../config/setup-server')(app, configManager);
    
    const port = process.env.PORT || 3000;
    app.listen(port, '0.0.0.0', () => {
      console.log(`\n📝 Configuration UI available at: http://YOUR_DROPLET_IP:${port}`);
      console.log('🔐 Complete the setup to start your trading bot\n');
    });
    
  } else {
    console.log('🚀 Starting trading bot...');
    
    try {
      // Load configuration
      const botConfig = await configManager.load();
      
      // Ensure Discord token is available from .env
      if (!botConfig.discordBotToken) {
        throw new Error('DISCORD_BOT_TOKEN not found in .env file. Please set it in your .env file.');
      }
      
      // Initialize components
      const executor = new TastytradeExecutor(botConfig);
      console.log('🔐 Logging in to Tastytrade...');
      await executor.connect();
      console.log('✅ TASTYTRADE: LOGGED IN');

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

          if (process.env.CENTRAL_DISCORD_USER_ID) {
            await configClient.authenticate(process.env.CENTRAL_DISCORD_USER_ID);
            console.log('✅ Central Server connected');
            configClient.startHeartbeat(60000);
          }
        } catch (error) {
          console.warn('⚠️  Central Server connection failed:', error.message);
        }
      }
      
      // Start web server for management/reset even when running
      const app = express();
      app.use(express.json());
      app.use(express.static(path.join(__dirname, '../public')));

      // Live status endpoint
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

      // Setup endpoints (for reset functionality)
      require('../config/setup-server')(app, configManager);

      const port = process.env.PORT || 3000;
      app.listen(port, '0.0.0.0', () => {
        console.log(`\n🌐 Management UI available at: http://localhost:${port}`);
        console.log('   Visit to view status or reset configuration\n');
      });
      
      // Keep process alive
      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        await listener.stop();
        process.exit(0);
      });
      
    } catch (error) {
      console.error('❌ Failed to start bot:', error.message);

      // Instead of crash-looping, fall back to setup mode
      console.log('');
      console.log('═══════════════════════════════════════');
      console.log('  ❌ BOT OFFLINE - Login failed');
      console.log(`  Reason: ${error.message}`);
      console.log('═══════════════════════════════════════');
      console.log('');
      console.log('🔧 Falling back to setup mode...');
      const fs = require('fs');
      const configPath = path.join(__dirname, '../config/bot-config.json');
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        console.log('   Removed invalid config');
      }

      const app = express();
      app.use(express.json());
      app.use(express.static(path.join(__dirname, '../public')));

      app.get('/api/bot-status', (req, res) => {
        res.json({
          state: 'offline',
          tastytrade: 'not connected',
          discord: 'not connected',
          error: error.message
        });
      });

      require('../config/setup-server')(app, configManager);

      const port = process.env.PORT || 3000;
      app.listen(port, '0.0.0.0', () => {
        console.log(`\n📝 Configuration UI available at: http://YOUR_DROPLET_IP:${port}`);
        console.log('🔐 Please reconfigure your trading bot\n');
      });
    }
  }
}

main().catch(console.error);


