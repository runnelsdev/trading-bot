const TastytradeClient = require('@tastytrade/api').default;
const path = require('path');

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
   * Map Discord roles to available channels
   */
  function getChannelsForRoles(roleIds, guild) {
    // Channel mapping based on subscription tiers
    // Customize this based on your Discord server setup
    const channelMap = {
      // Tier 1 channels
      'tier1': [
        { id: process.env.CHANNEL_TIER1_ID || 'tier1', name: 'Basic Signals', tier: 'Tier 1', description: 'Entry-level trading signals' }
      ],
      // Tier 2 channels
      'tier2': [
        { id: process.env.CHANNEL_TIER1_ID || 'tier1', name: 'Basic Signals', tier: 'Tier 1', description: 'Entry-level trading signals' },
        { id: process.env.CHANNEL_TIER2_ID || 'tier2', name: 'Premium Signals', tier: 'Tier 2', description: 'Advanced trading signals' }
      ],
      // Tier 3 channels
      'tier3': [
        { id: process.env.CHANNEL_TIER1_ID || 'tier1', name: 'Basic Signals', tier: 'Tier 1', description: 'Entry-level trading signals' },
        { id: process.env.CHANNEL_TIER2_ID || 'tier2', name: 'Premium Signals', tier: 'Tier 2', description: 'Advanced trading signals' },
        { id: process.env.CHANNEL_TIER3_ID || 'tier3', name: 'VIP Signals', tier: 'Tier 3', description: 'Exclusive VIP trading signals' }
      ]
    };

    // For now, return all channels (you'd check roles in production)
    // In production, check roleIds against your role mapping
    const allChannels = [
      ...channelMap.tier1,
      ...channelMap.tier2,
      ...channelMap.tier3
    ];

    // Remove duplicates
    const uniqueChannels = [];
    const seen = new Set();
    allChannels.forEach(ch => {
      if (!seen.has(ch.id)) {
        seen.add(ch.id);
        uniqueChannels.push(ch);
      }
    });

    return uniqueChannels;
  }
};


