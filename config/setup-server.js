const TastytradeClient = require('@tastytrade/api').default;
const path = require('path');
const fs = require('fs');
const axios = require('axios');

/**
 * Setup Server Routes
 * Handles configuration API endpoints
 */
module.exports = (app, configManager) => {

  /**
   * Record settings changes to central server for audit trail
   */
  async function recordSettingsChange(oldConfig, newConfig) {
    const centralServerUrl = process.env.CENTRAL_SERVER_URL;
    const subscriberId = process.env.CENTRAL_SUBSCRIBER_ID;
    const botId = process.env.CENTRAL_BOT_ID;
    const botToken = process.env.CENTRAL_BOT_TOKEN;

    if (!centralServerUrl || !subscriberId || !botToken) {
      console.log('⚠️  Central server not configured, skipping settings history');
      return;
    }

    // Settings to track (sensitive fields excluded)
    const trackedSettings = [
      'sizingMethod', 'percentage', 'fixedDollar', 'coachMultiplier',
      'maxDailyLoss', 'channelId', 'channelName', 'tastytradeAccountNumber'
    ];

    const changes = [];

    for (const key of trackedSettings) {
      const oldValue = oldConfig?.[key];
      const newValue = newConfig?.[key];

      // Record if changed or if new setting on first config
      if (oldValue !== newValue) {
        changes.push({
          setting_key: key,
          old_value: oldValue !== undefined ? String(oldValue) : null,
          new_value: newValue !== undefined ? String(newValue) : null
        });
      }
    }

    if (changes.length === 0) {
      console.log('📊 No tracked settings changed');
      return;
    }

    try {
      console.log(`📊 Recording ${changes.length} setting changes to central server...`);

      await axios.post(
        `${centralServerUrl}/api/v1/bot/settings-change`,
        {
          subscriberId,
          botId,
          botToken,
          changes
        },
        { timeout: 5000 }
      );

      console.log('✅ Settings changes recorded');
    } catch (error) {
      console.error('⚠️  Failed to record settings history:', error.message);
      // Don't fail the save - history is nice-to-have
    }
  }
  
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

          try {
            const sessionData = await client.sessionService.login(username, password, true);
            // If login succeeded, capture remember-token
            if (sessionData && sessionData['remember-token']) {
              res._rememberToken = sessionData['remember-token'];
            }
          } catch (loginError) {
            const status = loginError.response?.status;
            const errorData = loginError.response?.data;
            const errorCode = errorData?.error?.code;
            const sessionToken = loginError.response?.headers?.['set-cookie']
              ?.find(c => c.includes('session'))
              || loginError.response?.headers?.authorization;

            console.log(`Tastytrade login returned ${status}:`, JSON.stringify(errorData));
            console.log('Response headers:', JSON.stringify(loginError.response?.headers));

            if (status === 403 && errorCode === 'device_challenge_required') {
              // Device challenge - need to send verification code
              return res.json({
                success: false,
                needs_device_challenge: true,
                message: 'Device verification required. A code will be sent to your email/phone.'
              });
            }

            if (status === 403) {
              // Other 403 - could be OTP/2FA
              const errorMsg = errorData?.error?.message || '';
              return res.json({
                success: false,
                needs_otp: true,
                message: errorMsg || 'Two-factor authentication required. Please enter your one-time password.'
              });
            }
            throw loginError;
          }
        }

        // Get accounts
        const accounts = await client.accountsAndCustomersService.getCustomerAccounts();

        res.json({
          success: true,
          message: 'Connection successful',
          rememberToken: res._rememberToken || null,
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

  // Trigger device challenge - sends verification code via email/SMS
  app.post('/api/device-challenge', async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password required' });
      }

      const axios = require('axios');
      const baseUrl = process.env.TASTYTRADE_ENV === 'production'
        ? 'https://api.tastytrade.com'
        : 'https://api.cert.tastyworks.com';

      // Step 1: Login to get the session token (will return 403 with device challenge)
      let sessionToken = null;
      try {
        const loginResp = await axios.post(`${baseUrl}/sessions`, {
          login: username,
          password: password,
          'remember-me': true
        });
        // If login succeeds without challenge, we're done
        sessionToken = loginResp.data?.data?.['session-token'];
        if (sessionToken) {
          return res.json({
            success: true,
            skip_challenge: true,
            sessionToken,
            rememberToken: loginResp.data?.data?.['remember-token'] || null
          });
        }
      } catch (loginErr) {
        const errData = loginErr.response?.data;
        const errCode = errData?.error?.code;

        if (errCode !== 'device_challenge_required') {
          console.error('Device challenge - unexpected login error:', errCode, errData);
          return res.status(400).json({ success: false, error: errData?.error?.message || 'Login failed' });
        }

        // Extract session token from the 403 response
        // Tastytrade returns it in the response data or headers
        sessionToken = errData?.data?.['session-token']
          || loginErr.response?.headers?.['session-token']
          || loginErr.response?.headers?.authorization;

        console.log('Device challenge required, session-token present:', !!sessionToken);
        console.log('403 response data keys:', Object.keys(errData || {}));
        console.log('403 response headers:', JSON.stringify(loginErr.response?.headers));
      }

      if (!sessionToken) {
        // Try to extract from any available source
        console.log('No session token found in device challenge response');
        return res.status(400).json({
          success: false,
          error: 'Could not obtain session token for device challenge. Check server logs.'
        });
      }

      // Step 2: POST to /device-challenge to trigger the verification code
      try {
        const challengeResp = await axios.post(`${baseUrl}/device-challenge`, {}, {
          headers: {
            'Authorization': sessionToken,
            'Content-Type': 'application/json'
          }
        });

        console.log('Device challenge triggered:', challengeResp.status, JSON.stringify(challengeResp.data));

        res.json({
          success: true,
          message: 'Verification code sent! Check your email or phone.',
          sessionToken: sessionToken
        });

      } catch (challengeErr) {
        console.error('Device challenge trigger error:', challengeErr.response?.status, JSON.stringify(challengeErr.response?.data));
        res.status(400).json({
          success: false,
          error: challengeErr.response?.data?.error?.message || 'Failed to trigger device challenge'
        });
      }

    } catch (error) {
      console.error('Device challenge error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Verify device challenge code
  app.post('/api/device-challenge/verify', async (req, res) => {
    try {
      const { username, code, sessionToken } = req.body;

      if (!code || !sessionToken) {
        return res.status(400).json({ success: false, error: 'Verification code and session token required' });
      }

      const axios = require('axios');
      const baseUrl = process.env.TASTYTRADE_ENV === 'production'
        ? 'https://api.tastytrade.com'
        : 'https://api.cert.tastyworks.com';

      const verifyResp = await axios.post(`${baseUrl}/device-challenge`, {
        code: code
      }, {
        headers: {
          'Authorization': sessionToken,
          'Content-Type': 'application/json'
        }
      });

      console.log('Device challenge verified:', verifyResp.status, JSON.stringify(verifyResp.data));

      const sessionData = verifyResp.data?.data || verifyResp.data;
      const rememberToken = sessionData['remember-token'];
      const newSessionToken = sessionData['session-token'] || sessionToken;

      // Get accounts using the verified session
      const accountsResp = await axios.get(`${baseUrl}/customers/me/accounts`, {
        headers: { 'Authorization': newSessionToken }
      });

      const accounts = accountsResp.data?.data?.items || [];

      res.json({
        success: true,
        message: 'Device verified successfully!',
        rememberToken: rememberToken || null,
        accounts: accounts.map(acc => ({
          number: acc.account['account-number'],
          nickname: acc.account.nickname || acc.account['account-number']
        }))
      });

    } catch (error) {
      console.error('Device challenge verify error:', error.response?.status, JSON.stringify(error.response?.data));
      res.status(400).json({
        success: false,
        error: error.response?.data?.error?.message || 'Verification failed. Please try again.'
      });
    }
  });

  // Verify OTP and get remember-token
  app.post('/api/verify-otp', async (req, res) => {
    try {
      const { username, password, otp } = req.body;

      if (!username || !password || !otp) {
        return res.status(400).json({ success: false, error: 'Username, password, and OTP required' });
      }

      const TastytradeClient = require('@tastytrade/api').default;
      const config = process.env.TASTYTRADE_ENV === 'production'
        ? TastytradeClient.ProdConfig
        : TastytradeClient.SandboxConfig;

      const client = new TastytradeClient(config);

      // Login with OTP via direct API call (SDK doesn't support OTP parameter)
      const baseUrl = process.env.TASTYTRADE_ENV === 'production'
        ? 'https://api.tastytrade.com'
        : 'https://api.cert.tastyworks.com';

      const axios = require('axios');
      const loginResponse = await axios.post(`${baseUrl}/sessions`, {
        login: username,
        password: password,
        'remember-me': true,
        'one-time-password': otp
      });

      const sessionData = loginResponse.data.data;
      const rememberToken = sessionData['remember-token'];

      if (!rememberToken) {
        console.warn('⚠️  No remember-token returned from Tastytrade');
      } else {
        console.log('✅ Got remember-token from Tastytrade');
      }

      // Use the session to get accounts
      client.session = client.session || {};
      client.httpClient = client.httpClient || {};
      if (client.httpClient.session) {
        client.httpClient.session.authToken = sessionData['session-token'];
      }

      // Get accounts using the session token directly
      const accountsResponse = await axios.get(`${baseUrl}/customers/me/accounts`, {
        headers: { 'Authorization': sessionData['session-token'] }
      });

      const accounts = accountsResponse.data.data.items || [];

      res.json({
        success: true,
        message: 'Two-factor authentication successful',
        rememberToken: rememberToken || null,
        accounts: accounts.map(acc => ({
          number: acc.account['account-number'],
          nickname: acc.account.nickname || acc.account['account-number']
        }))
      });

    } catch (error) {
      console.error('OTP verification error:', error.response?.data || error.message);
      const errMsg = error.response?.data?.error?.message || error.message || 'OTP verification failed';
      res.status(400).json({ success: false, error: errMsg });
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

      // Get existing config for change tracking
      const oldConfig = configManager.getConfig ? configManager.getConfig() : null;

      // Add metadata
      config.configuredAt = new Date().toISOString();

      // Record settings changes to central server (async, non-blocking)
      recordSettingsChange(oldConfig, config).catch(() => {});

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


