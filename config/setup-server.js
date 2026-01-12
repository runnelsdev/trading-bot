const TastytradeClient = require('@tastytrade/api').default;
const path = require('path');
const fs = require('fs');

/**
 * Setup Server Routes
 * Handles configuration API endpoints
 */
module.exports = (app, configManager) => {
  
  // Serve configuration page
  app.get('/', (req, res) => {
    res.sendFile('setup.html', { root: path.join(__dirname, '../public') });
  });

  // Serve setup page (even when configured, for reconfiguration)
  app.get('/setup', (req, res) => {
    res.sendFile('setup.html', { root: path.join(__dirname, '../public') });
  });

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', mode: 'setup' });
  });

  // Get available channels (based on Discord roles)
  app.get('/api/get-channels', async (req, res) => {
    try {
      const discordToken = process.env.DISCORD_BOT_TOKEN;
      
      if (!discordToken) {
        return res.status(400).json({ 
          success: false, 
          error: 'DISCORD_BOT_TOKEN not found in .env file. Please set it in your .env file.' 
        });
      }

      try {
        // In production, you'd verify Discord token and get user's roles
        // For now, return all available channels
        // You can customize this based on your subscription tiers
        
        const { Client, GatewayIntentBits } = require('discord.js');
        const client = new Client({
          intents: [GatewayIntentBits.Guilds]
        });

        // Login and wait for ready event
        await client.login(discordToken);
        
        // Wait for client to be ready
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Discord client connection timeout'));
          }, 10000); // 10 second timeout
          
          if (client.isReady()) {
            clearTimeout(timeout);
            resolve();
          } else {
            client.once('ready', () => {
              clearTimeout(timeout);
              resolve();
            });
            
            client.once('error', (error) => {
              clearTimeout(timeout);
              reject(error);
            });
          }
        });
        
        // Get guild (server) - you'll need to set this
        const guildId = process.env.DISCORD_GUILD_ID;
        if (!guildId) {
          // Return default channels if no guild configured
          await client.destroy();
          return res.json({
            success: true,
            channels: [
              { id: 'default', name: 'Trading Signals', tier: 'All Tiers', description: 'General trading signals' }
            ]
          });
        }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
          await client.destroy();
          throw new Error(`Guild ${guildId} not found. Make sure the bot is in the server and DISCORD_GUILD_ID is correct.`);
        }

        // Get member info
        const member = await guild.members.fetch(client.user.id);
        const roles = member.roles.cache.map(r => r.id);

        // Map roles to available channels
        const channels = getChannelsForRoles(roles, guild);
        
        await client.destroy();
        
        res.json({ success: true, channels });
        
      } catch (error) {
        console.error('Error getting channels:', error);
        res.status(400).json({ 
          success: false, 
          error: error.message || 'Failed to get channels' 
        });
      }
    } catch (error) {
      console.error('Unexpected error in get-channels:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error: ' + (error.message || 'Unknown error')
      });
    }
  });

  // Test Tastytrade connection
  app.post('/api/test-tastytrade', async (req, res) => {
    try {
      const { username, password, clientSecret, refreshToken } = req.body;
      
      if (!username && !clientSecret) {
        return res.status(400).json({
          success: false,
          error: 'Tastytrade credentials required'
        });
      }

      try {
        const baseUrl = process.env.TASTYTRADE_ENV === 'production'
          ? 'https://api.tastytrade.com'
          : 'https://api.cert.tastyworks.com';

        const TastytradeClient = require('@tastytrade/api').default;
        const config = process.env.TASTYTRADE_ENV === 'production'
          ? TastytradeClient.ProdConfig
          : TastytradeClient.SandboxConfig;

        let client;
        
        if (clientSecret && refreshToken) {
          // OAuth authentication
          client = new TastytradeClient({
            ...config,
            clientSecret,
            refreshToken,
            oauthScopes: ['read', 'trade', 'openid']
          });
        } else {
          // Session-based authentication
          client = new TastytradeClient(config);
          await client.sessionService.login(username, password);
        }
        
        // Get accounts
        const accounts = await client.accountsAndCustomersService.getCustomerAccounts();
        
        res.json({
          success: true,
          message: 'Connection successful',
          accounts: accounts.map(acc => ({
            number: acc.account['account-number'],
            nickname: acc.account.nickname || acc.account['account-number']
          }))
        });
        
      } catch (error) {
        console.error('Tastytrade connection error:', error);
        res.status(400).json({
          success: false,
          error: 'Connection failed: ' + (error.message || 'Unknown error')
        });
      }
    } catch (error) {
      console.error('Unexpected error in test-tastytrade:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error: ' + (error.message || 'Unknown error')
      });
    }
  });

  // Save configuration
  app.post('/api/save-config', async (req, res) => {
    try {
      const config = req.body;
      
      // Validate configuration
      if (!config.tastytradeUsername && !config.tastytradeClientSecret) {
        throw new Error('Tastytrade credentials required');
      }
      
      if (!process.env.DISCORD_BOT_TOKEN) {
        throw new Error('DISCORD_BOT_TOKEN not found in .env file. Please set it in your .env file.');
      }
      
      if (!config.channelId) {
        throw new Error('Channel selection required');
      }

      if (!config.tastytradeAccountNumber) {
        throw new Error('Tastytrade account selection required');
      }
      
      // Add metadata
      config.configuredAt = new Date().toISOString();

      // Save configuration (encrypted) - Discord token comes from .env, not saved in config
      await configManager.save(config);

      // Update FIRST_RUN=false in .env so bot starts in trading mode
      try {
        const envPath = path.join(__dirname, '../.env');
        if (fs.existsSync(envPath)) {
          let envContent = fs.readFileSync(envPath, 'utf8');
          if (envContent.includes('FIRST_RUN=true')) {
            envContent = envContent.replace('FIRST_RUN=true', 'FIRST_RUN=false');
            fs.writeFileSync(envPath, envContent);
            console.log('✅ Updated FIRST_RUN=false in .env');
          }
        }
      } catch (envError) {
        console.error('Warning: Could not update FIRST_RUN in .env:', envError.message);
      }

      res.json({
        success: true,
        message: 'Configuration saved. Restarting bot...'
      });

      // Restart the process (PM2 will handle it)
      setTimeout(() => {
        process.exit(0);
      }, 2000);
      
    } catch (error) {
      console.error('Save config error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  });

  // Get current configuration status
  app.get('/api/status', (req, res) => {
    const publicConfig = configManager.getPublicConfig();
    res.json({
      configured: configManager.isConfigured(),
      config: publicConfig
    });
  });

  // Reset configuration (delete config file to start fresh)
  app.post('/api/reset-config', async (req, res) => {
    try {
      const fs = require('fs');
      const configPath = path.join(__dirname, 'bot-config.json');
      
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        console.log('🔄 Configuration reset - bot-config.json deleted');
      }
      
      res.json({
        success: true,
        message: 'Configuration reset. Restarting to setup mode...'
      });
      
      // Restart the process (PM2 will handle it, bringing it back to setup mode)
      setTimeout(() => {
        process.exit(0);
      }, 1500);
      
    } catch (error) {
      console.error('Reset config error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Get signal channels from Discord guild
   * Fetches actual channel IDs from the server
   */
  function getChannelsForRoles(roleIds, guild) {
    const channels = [];

    // Define which channels are signal channels by name patterns
    const signalChannelPatterns = [
      { pattern: /vip[-_]?signals?/i, tier: 'VIP', description: 'Exclusive VIP trading signals' },
      { pattern: /premium[-_]?signals?/i, tier: 'Premium', description: 'Premium trading signals' },
      { pattern: /basic[-_]?signals?/i, tier: 'Basic', description: 'Basic trading signals' },
      { pattern: /signals?[-_]?test/i, tier: 'Test', description: 'Test signals channel' },
      { pattern: /vip[-_]?channel/i, tier: 'VIP', description: 'VIP channel' },
      { pattern: /premium[-_]?channel/i, tier: 'Premium', description: 'Premium channel' },
      { pattern: /basic[-_]?channel/i, tier: 'Basic', description: 'Basic channel' },
    ];

    // Get text channels from guild
    guild.channels.cache.forEach(channel => {
      // Only include text channels
      if (channel.type !== 0) return; // 0 = GUILD_TEXT

      const channelName = channel.name.toLowerCase();

      // Check if channel matches any signal pattern
      for (const { pattern, tier, description } of signalChannelPatterns) {
        if (pattern.test(channelName)) {
          channels.push({
            id: channel.id,  // Real Discord channel ID
            name: channel.name,
            tier: tier,
            description: description
          });
          break;
        }
      }
    });

    // Sort by tier priority: VIP > Premium > Basic > Test
    const tierOrder = { 'VIP': 0, 'Premium': 1, 'Basic': 2, 'Test': 3 };
    channels.sort((a, b) => (tierOrder[a.tier] || 99) - (tierOrder[b.tier] || 99));

    // If no signal channels found, return a helpful message
    if (channels.length === 0) {
      console.log('No signal channels found. Available channels:',
        guild.channels.cache.filter(c => c.type === 0).map(c => c.name).join(', '));
    }

    return channels;
  }
};


