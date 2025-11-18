require('dotenv').config();
const express = require('express');
const path = require('path');
const ConfigManager = require('./src/ConfigManager');
const DiscordListener = require('./src/DiscordListener');
const TastytradeExecutor = require('./src/TastytradeExecutor');

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
    app.use(express.static(path.join(__dirname, 'public')));
    
    // Configuration endpoints
    require('./config/setup-server')(app, configManager);
    
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
      
      // Keep process alive
      process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down...');
        await listener.stop();
        process.exit(0);
      });
      
    } catch (error) {
      console.error('❌ Failed to start bot:', error.message);
      console.error('💡 Try deleting config/bot-config.json to reconfigure');
      process.exit(1);
    }
  }
}

main().catch(console.error);


