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
      await executor.connect();
      
      const listener = new DiscordListener(botConfig, executor);
      await listener.start();
      
      console.log('✅ Trading bot is running');
      console.log(`📡 Listening to channel: ${botConfig.channelName}`);
      console.log(`💼 Connected to Tastytrade account: ${botConfig.tastytradeAccountNumber}`);
      console.log(`📊 Position sizing: ${botConfig.sizingMethod}`);
      console.log(`🛡️  Daily limits: ${botConfig.maxDailyTrades} trades, $${botConfig.maxDailyLoss} loss`);

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


