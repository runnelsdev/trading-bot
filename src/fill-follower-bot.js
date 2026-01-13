require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const TastytradeClient = require('@tastytrade/api').default;
const PositionSizer = require('./PositionSizer');

/**
 * Fill Follower Bot
 * Listens to Discord fill notifications and places matching orders
 *
 * ENVIRONMENT TOGGLE:
 * Comment/uncomment the appropriate line below to switch between sandbox and production
 *
 * POSITION SIZING:
 * Supports 'proportional' sizing to mirror coach's position as % of account
 */

// ============================================================================
// ENVIRONMENT CONFIGURATION - COMMENT/UNCOMMENT TO SWITCH
// ============================================================================

// 🧪 SANDBOX MODE (for testing - no real money)
const TASTYTRADE_ENV = 'sandbox';

// 💰 PRODUCTION MODE (real money - use with caution!)
// const TASTYTRADE_ENV = 'production';

// ============================================================================
// END ENVIRONMENT CONFIGURATION
// ============================================================================

console.log(`\n${'='.repeat(60)}`);
console.log(`🔧 ENVIRONMENT: ${TASTYTRADE_ENV.toUpperCase()}`);
console.log(`${'='.repeat(60)}\n`);

if (TASTYTRADE_ENV === 'production') {
  console.log('⚠️  WARNING: Running in PRODUCTION mode!');
  console.log('⚠️  Real money trades will be executed!\n');
}

/**
 * Fill Follower Bot Class
 */
class FillFollowerBot {
  constructor() {
    // Discord client
    this.discord = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });

    // Tastytrade client - configured based on environment
    this.tastytrade = new TastytradeClient(
      TASTYTRADE_ENV === 'production'
        ? TastytradeClient.ProdConfig
        : TastytradeClient.SandboxConfig
    );

    // Configuration
    this.config = {
      // Discord settings
      discordToken: process.env.DISCORD_BOT_TOKEN,
      fillsChannelId: process.env.FILLS_CHANNEL_ID,

      // Tastytrade settings (use FOLLOWER_ vars, fallback to TASTYTRADE_ vars)
      accountNumber: process.env.FOLLOWER_ACCOUNT_NUMBER || process.env.TASTYTRADE_ACCOUNT_NUMBER,
      username: process.env.FOLLOWER_USERNAME || process.env.TASTYTRADE_USERNAME,
      password: process.env.FOLLOWER_PASSWORD || process.env.TASTYTRADE_PASSWORD,

      // Position sizing - supports: 'fixed', 'match', 'percentage', 'proportional'
      sizingMethod: process.env.SIZING_METHOD || 'fixed',
      fixedQuantity: parseInt(process.env.FIXED_QUANTITY) || 1,
      percentageOfFill: parseFloat(process.env.PERCENTAGE_OF_FILL) || 100,
      maxQuantity: parseInt(process.env.MAX_QUANTITY) || 10,
      minQuantity: parseInt(process.env.MIN_QUANTITY) || 1,

      // Proportional sizing settings (for sizingMethod: 'proportional')
      // Coach's account balance - required for proportional sizing
      coachAccountBalance: parseFloat(process.env.COACH_ACCOUNT_BALANCE) || 0,
      // How often to refresh balances (ms) - default 1 minute
      balanceCacheTTL: parseInt(process.env.BALANCE_CACHE_TTL) || 60000,

      // Safety limits
      maxDailyTrades: parseInt(process.env.MAX_DAILY_TRADES) || 20,
      maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS) || 500,

      // Filters
      enabledSymbols: process.env.ENABLED_SYMBOLS
        ? process.env.ENABLED_SYMBOLS.split(',').map(s => s.trim().toUpperCase())
        : null, // null = all symbols
      enabledActions: process.env.ENABLED_ACTIONS
        ? process.env.ENABLED_ACTIONS.split(',').map(s => s.trim())
        : ['Buy to Open', 'Sell to Close', 'Buy to Close', 'Sell to Open']
    };

    // Initialize position sizer for proportional sizing
    this.positionSizer = null;
    if (this.config.sizingMethod === 'proportional') {
      this.positionSizer = new PositionSizer({
        sizingMethod: 'proportional',
        tastytradeAccountNumber: this.config.accountNumber,
        tastytradeUsername: this.config.username,
        tastytradePassword: this.config.password,
        minQuantity: this.config.minQuantity,
        maxQuantity: this.config.maxQuantity,
        balanceCacheTTL: this.config.balanceCacheTTL
      });
    }

    // State tracking
    this.tradesExecutedToday = 0;
    this.lossToday = 0;
    this.lastResetDate = new Date().toDateString();
    this.processedFills = new Set(); // Track processed fill IDs to avoid duplicates
    this.isConnected = false;
  }

  /**
   * Initialize and start the bot
   */
  async start() {
    console.log('🚀 Starting Fill Follower Bot...\n');

    // Validate configuration
    this.validateConfig();

    // Connect to Tastytrade
    await this.connectTastytrade();

    // Initialize proportional sizing if enabled
    if (this.config.sizingMethod === 'proportional') {
      await this.initializeProportionalSizing();
    }

    // Connect to Discord
    await this.connectDiscord();

    // Setup message listener
    this.setupMessageListener();

    // Start balance refresh interval for proportional sizing
    if (this.config.sizingMethod === 'proportional') {
      this.startBalanceRefreshInterval();
    }

    console.log('\n✅ Fill Follower Bot is running!');
    console.log(`📡 Listening to channel: ${this.config.fillsChannelId}`);
    console.log(`💼 Trading on account: ${this.config.accountNumber}`);
    console.log(`🔧 Environment: ${TASTYTRADE_ENV.toUpperCase()}`);
    console.log(`📊 Sizing method: ${this.config.sizingMethod}`);
    if (this.config.sizingMethod === 'proportional' && this.positionSizer) {
      const info = this.positionSizer.getSizingInfo();
      console.log(`   Coach balance: $${info.coachBalance?.toLocaleString() || 'N/A'}`);
      console.log(`   Follower balance: $${info.followerBalance?.toLocaleString() || 'N/A'}`);
      console.log(`   Ratio: ${info.ratio?.toFixed(4) || 'N/A'}`);
    }
    if (this.config.enabledSymbols) {
      console.log(`🎯 Enabled symbols: ${this.config.enabledSymbols.join(', ')}`);
    }
    console.log('');
  }

  /**
   * Initialize proportional sizing with coach's account balance
   */
  async initializeProportionalSizing() {
    if (!this.positionSizer) return;

    const coachBalance = this.config.coachAccountBalance;

    if (!coachBalance || coachBalance <= 0) {
      console.error('❌ COACH_ACCOUNT_BALANCE is required for proportional sizing');
      console.error('   Set COACH_ACCOUNT_BALANCE in your .env file');
      console.error('   Example: COACH_ACCOUNT_BALANCE=500000');
      process.exit(1);
    }

    try {
      await this.positionSizer.initializeProportionalSizing(coachBalance);
    } catch (error) {
      console.error('❌ Failed to initialize proportional sizing:', error.message);
      process.exit(1);
    }
  }

  /**
   * Start periodic balance refresh for proportional sizing
   * Refreshes follower balance every balanceCacheTTL ms (default 1 min)
   */
  startBalanceRefreshInterval() {
    if (!this.positionSizer) return;

    const interval = this.config.balanceCacheTTL || 60000;

    this.balanceRefreshInterval = setInterval(async () => {
      try {
        await this.positionSizer.refreshFollowerBalance();
      } catch (error) {
        console.error('⚠️  Balance refresh failed:', error.message);
      }
    }, interval);

    console.log(`📊 Balance refresh scheduled every ${interval / 1000}s`);
  }

  /**
   * Update coach balance (call this when you receive coach account updates)
   * Can be triggered by Discord messages with coach balance info
   */
  updateCoachBalance(newBalance) {
    if (this.positionSizer && newBalance > 0) {
      this.positionSizer.updateCoachBalance(newBalance);
      console.log(`📊 Coach balance updated: $${newBalance.toLocaleString()}`);
    }
  }

  /**
   * Validate required configuration
   */
  validateConfig() {
    const required = [
      'discordToken',
      'fillsChannelId',
      'accountNumber',
      'username',
      'password'
    ];

    const missing = required.filter(key => !this.config[key]);
    
    if (missing.length > 0) {
      console.error('❌ Missing required configuration:');
      missing.forEach(key => console.error(`   - ${key}`));
      console.error('\n💡 Set these in your .env file');
      process.exit(1);
    }
  }

  /**
   * Connect to Tastytrade API
   */
  async connectTastytrade() {
    console.log(`🔌 Connecting to Tastytrade (${TASTYTRADE_ENV})...`);
    
    try {
      await this.tastytrade.sessionService.login(
        this.config.username,
        this.config.password
      );
      
      console.log('✅ Tastytrade connected');
      
      // Verify account access
      const accounts = await this.tastytrade.accountsAndCustomersService.getCustomerAccounts();
      const accountExists = accounts.some(
        a => a.account['account-number'] === this.config.accountNumber
      );
      
      if (!accountExists) {
        console.error(`❌ Account ${this.config.accountNumber} not found`);
        console.error('💡 Available accounts:');
        accounts.forEach(a => {
          console.error(`   - ${a.account['account-number']}`);
        });
        process.exit(1);
      }
      
      console.log(`✅ Account ${this.config.accountNumber} verified`);
      
    } catch (error) {
      console.error('❌ Failed to connect to Tastytrade:', error.message);
      if (error.response?.data) {
        console.error('   Details:', JSON.stringify(error.response.data, null, 2));
      }
      process.exit(1);
    }
  }

  /**
   * Connect to Discord
   */
  async connectDiscord() {
    console.log('🔌 Connecting to Discord...');
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Discord connection timeout'));
      }, 15000);

      this.discord.once('ready', () => {
        clearTimeout(timeout);
        console.log(`✅ Discord connected as ${this.discord.user.tag}`);
        
        // Set presence
        this.discord.user.setActivity('Fill Notifications', { type: ActivityType.Watching });
        this.discord.user.setStatus('online');
        
        this.isConnected = true;
        resolve();
      });

      this.discord.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.discord.login(this.config.discordToken).catch(reject);
    });
  }

  /**
   * Setup Discord message listener
   */
  setupMessageListener() {
    this.discord.on('messageCreate', async (message) => {
      // Debug: log all messages from any channel for troubleshooting
      const isTargetChannel = message.channel.id === this.config.fillsChannelId;
      
      // Log message receipt for debugging
      console.log(`\n📩 Message received:`);
      console.log(`   Channel: ${message.channel.name || message.channel.id} ${isTargetChannel ? '✅' : '(not target)'}`);
      console.log(`   Author: ${message.author.tag} ${message.author.bot ? '🤖' : ''}`);
      console.log(`   Content: ${message.content?.substring(0, 100) || '[no text]'}`);
      console.log(`   Embeds: ${message.embeds.length}`);
      
      if (message.embeds.length > 0) {
        message.embeds.forEach((embed, i) => {
          console.log(`   Embed ${i + 1}:`);
          console.log(`      Title: ${embed.title || '[no title]'}`);
          console.log(`      Description: ${embed.description?.substring(0, 100) || '[no desc]'}`);
          console.log(`      Fields: ${embed.fields?.length || 0}`);
          if (embed.fields) {
            embed.fields.forEach(f => console.log(`         - ${f.name}: ${f.value}`));
          }
        });
      }

      // Only process messages from the fills channel
      if (!isTargetChannel) return;

      // Test command: !test-fill (simulates a fill to test the bot)
      if (message.content === '!test-fill') {
        console.log('\n🧪 Test fill triggered!');
        const testFill = {
          symbol: 'SPY',
          action: 'Buy to Open',
          quantity: 1,
          price: 600.00,
          instrumentType: 'Equity',
          orderId: `test_${Date.now()}`
        };
        
        console.log(`   Test fill: ${testFill.action} ${testFill.quantity} ${testFill.symbol}`);
        
        // Check filters
        if (!this.shouldExecuteFill(testFill)) {
          await message.reply('⚠️ Test fill was filtered out by safety limits');
          return;
        }
        
        const quantity = this.calculateQuantity(testFill);
        const result = await this.executeTrade(testFill, quantity);
        
        if (result.success) {
          await message.reply(`✅ Test fill executed! Order ID: ${result.orderId}`);
        } else {
          await message.reply(`❌ Test fill failed: ${result.error}`);
        }
        return;
      }

      // Process embeds (fill notifications are sent as embeds)
      if (message.embeds.length > 0) {
        for (const embed of message.embeds) {
          await this.processFillEmbed(embed, message);
        }
      }
    });
  }

  /**
   * Process a fill notification embed
   */
  async processFillEmbed(embed, message) {
    try {
      // Check if this looks like a fill notification
      const title = embed.title || '';
      if (!title.includes('FILLED') && !title.includes('FILL')) {
        return; // Not a fill notification
      }

      // Parse the fill data from embed
      const fill = this.parseFillEmbed(embed);
      
      if (!fill) {
        console.log('⚠️  Could not parse fill from embed');
        return;
      }

      // Check for duplicate
      const fillKey = `${fill.orderId || ''}_${fill.symbol}_${fill.action}_${fill.quantity}`;
      if (this.processedFills.has(fillKey)) {
        console.log(`⏭️  Skipping duplicate fill: ${fillKey}`);
        return;
      }

      console.log(`\n📨 Fill notification received:`);
      console.log(`   Symbol: ${fill.symbol}`);
      console.log(`   Action: ${fill.action}`);
      console.log(`   Quantity: ${fill.quantity}`);
      console.log(`   Price: $${fill.price || 'Market'}`);
      if (fill.instrumentType === 'Equity Option') {
        console.log(`   Strike: $${fill.strike}`);
        console.log(`   Expiration: ${fill.expiration}`);
        console.log(`   Type: ${fill.optionType}`);
      }

      // Apply filters
      if (!this.shouldExecuteFill(fill)) {
        return;
      }

      // Calculate position size
      const quantity = this.calculateQuantity(fill);
      
      if (quantity <= 0) {
        console.log('⚠️  Calculated quantity is 0, skipping');
        return;
      }

      // Execute the trade
      const result = await this.executeTrade(fill, quantity);
      
      if (result.success) {
        // Mark as processed
        this.processedFills.add(fillKey);
        
        // Clean up old processed fills (keep last 1000)
        if (this.processedFills.size > 1000) {
          const iterator = this.processedFills.values();
          this.processedFills.delete(iterator.next().value);
        }

        // React to the message to show we processed it
        try {
          await message.react('✅');
        } catch (e) {
          // Ignore reaction errors
        }
      }

    } catch (error) {
      console.error('❌ Error processing fill embed:', error.message);
    }
  }

  /**
   * Parse fill data from Discord embed
   */
  parseFillEmbed(embed) {
    const fill = {
      timestamp: embed.timestamp || new Date()
    };

    // Parse fields
    const fields = {};
    if (embed.fields) {
      embed.fields.forEach(field => {
        const key = field.name.toLowerCase().replace(/\s+/g, '');
        fields[key] = field.value;
      });
    }

    // Extract order ID
    fill.orderId = fields.orderid || fields.order || null;

    // Extract symbol
    fill.symbol = fields.symbol?.toUpperCase() || null;

    // Extract action (remove emoji if present)
    if (fields.action) {
      fill.action = fields.action.replace(/[🟢🔴]/g, '').trim();
    }

    // Extract quantity
    const quantityField = fields.quantity || fields.filled || fields.size;
    if (quantityField) {
      // Handle "X / Y" format
      const match = quantityField.match(/(\d+)/);
      if (match) {
        fill.quantity = parseInt(match[1]);
      }
    }

    // Extract price
    const priceField = fields.fillprice || fields.price || fields.avgprice;
    if (priceField) {
      const priceMatch = priceField.match(/\$?([\d.]+)/);
      if (priceMatch) {
        fill.price = parseFloat(priceMatch[1]);
      }
    }

    // Extract instrument type
    fill.instrumentType = fields.type || fields.instrumenttype || 'Equity';
    if (fill.instrumentType.toLowerCase().includes('option')) {
      fill.instrumentType = 'Equity Option';
    }

    // Extract option details if present
    if (fields.strike) {
      const strikeMatch = fields.strike.match(/\$?([\d.]+)/);
      if (strikeMatch) {
        fill.strike = parseFloat(strikeMatch[1]);
      }
    }

    if (fields.expiration || fields.exp) {
      fill.expiration = fields.expiration || fields.exp;
    }

    if (fields.optiontype || fields.put || fields.call) {
      fill.optionType = fields.optiontype || 
        (fields.put ? 'Put' : null) || 
        (fields.call ? 'Call' : null);
    }

    // Also check description for option details
    if (embed.description) {
      // Look for patterns like "SPY 600P 12/6" or "SPY $600 Put 12/06"
      const optionMatch = embed.description.match(
        /([A-Z]+)\s*\$?([\d.]+)\s*(P|C|Put|Call)\s*(\d+\/\d+(?:\/\d+)?)/i
      );
      if (optionMatch) {
        fill.symbol = fill.symbol || optionMatch[1];
        fill.strike = fill.strike || parseFloat(optionMatch[2]);
        fill.optionType = fill.optionType || 
          (optionMatch[3].toUpperCase().startsWith('P') ? 'Put' : 'Call');
        fill.expiration = fill.expiration || optionMatch[4];
        fill.instrumentType = 'Equity Option';
      }
    }

    // Validate required fields
    if (!fill.symbol || !fill.action) {
      return null;
    }

    // Default quantity to 1 if not found
    fill.quantity = fill.quantity || 1;

    return fill;
  }

  /**
   * Check if fill should be executed based on filters
   */
  shouldExecuteFill(fill) {
    // Reset daily counters if new day
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.tradesExecutedToday = 0;
      this.lossToday = 0;
      this.lastResetDate = today;
      console.log('📅 Daily counters reset');
    }

    // Check daily trade limit
    if (this.tradesExecutedToday >= this.config.maxDailyTrades) {
      console.log(`⚠️  Daily trade limit reached (${this.config.maxDailyTrades})`);
      return false;
    }

    // Check daily loss limit
    if (this.lossToday >= this.config.maxDailyLoss) {
      console.log(`⚠️  Daily loss limit reached ($${this.config.maxDailyLoss})`);
      return false;
    }

    // Check symbol filter
    if (this.config.enabledSymbols && !this.config.enabledSymbols.includes(fill.symbol)) {
      console.log(`⏭️  Symbol ${fill.symbol} not in enabled list, skipping`);
      return false;
    }

    // Check action filter
    if (!this.config.enabledActions.includes(fill.action)) {
      console.log(`⏭️  Action "${fill.action}" not enabled, skipping`);
      return false;
    }

    return true;
  }

  /**
   * Calculate quantity based on sizing method
   * LOW LATENCY: 'proportional' method uses cached ratio (no network calls)
   */
  calculateQuantity(fill) {
    let quantity;

    switch (this.config.sizingMethod) {
      case 'match':
        // Match the exact quantity from the fill
        quantity = fill.quantity;
        break;

      case 'percentage':
        // Use percentage of the fill quantity
        quantity = Math.round(fill.quantity * (this.config.percentageOfFill / 100));
        break;

      case 'proportional':
        // Use proportional sizing (mirrors coach's % of account)
        // This is LOW LATENCY - uses pre-computed ratio, no network calls
        if (this.positionSizer) {
          quantity = this.positionSizer.calculateProportional(fill);
        } else {
          console.warn('⚠️  PositionSizer not initialized, falling back to match');
          quantity = fill.quantity;
        }
        break;

      case 'fixed':
      default:
        // Use fixed quantity
        quantity = this.config.fixedQuantity;
        break;
    }

    // Apply max limit
    quantity = Math.min(quantity, this.config.maxQuantity);

    // Ensure at least minQuantity
    quantity = Math.max(quantity, this.config.minQuantity || 1);

    console.log(`📊 Position size: ${quantity} (method: ${this.config.sizingMethod})`);

    return quantity;
  }

  /**
   * Execute trade on Tastytrade
   */
  async executeTrade(fill, quantity) {
    try {
      console.log(`\n🎯 Executing: ${fill.action} ${quantity} ${fill.symbol}`);

      // Build order data
      let orderData;

      if (fill.instrumentType === 'Equity Option' && fill.strike && fill.expiration) {
        // Build option order
        const optionSymbol = this.buildOptionSymbol(fill);
        console.log(`   Option symbol: ${optionSymbol}`);

        orderData = {
          'time-in-force': 'Day',
          'order-type': 'Market',
          'price-effect': fill.action.includes('Buy') ? 'Debit' : 'Credit',
          'legs': [{
            'instrument-type': 'Equity Option',
            'symbol': optionSymbol,
            'quantity': quantity,
            'action': fill.action
          }]
        };
      } else {
        // Build equity order
        orderData = {
          'time-in-force': 'Day',
          'order-type': 'Market',
          'legs': [{
            'instrument-type': 'Equity',
            'symbol': fill.symbol,
            'quantity': quantity,
            'action': fill.action
          }]
        };
      }

      console.log(`📦 Order:`, JSON.stringify(orderData, null, 2));

      // Submit order
      const result = await this.tastytrade.orderService.createOrder(
        this.config.accountNumber,
        orderData
      );

      const orderId = result.data?.order?.id || result.data?.order?.['order-id'] || 'unknown';
      
      console.log(`✅ Order submitted! ID: ${orderId}`);
      
      this.tradesExecutedToday++;

      return {
        success: true,
        orderId,
        quantity,
        symbol: fill.symbol
      };

    } catch (error) {
      console.error('❌ Trade execution failed:', error.message);
      
      if (error.response?.data) {
        console.error('   Details:', JSON.stringify(error.response.data, null, 2));
        
        // If time-in-force error, retry with GTC
        if (error.response.status === 422) {
          const errors = error.response.data?.errors || [];
          const tifError = errors.some(e => e.code?.includes('tif'));
          
          if (tifError) {
            console.log('🔄 Retrying with GTC time-in-force...');
            return this.retryWithGTC(fill, quantity);
          }
        }
      }

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Retry order with GTC time-in-force
   */
  async retryWithGTC(fill, quantity) {
    try {
      let orderData;

      if (fill.instrumentType === 'Equity Option' && fill.strike && fill.expiration) {
        const optionSymbol = this.buildOptionSymbol(fill);
        orderData = {
          'time-in-force': 'GTC',
          'order-type': 'Market',
          'price-effect': fill.action.includes('Buy') ? 'Debit' : 'Credit',
          'legs': [{
            'instrument-type': 'Equity Option',
            'symbol': optionSymbol,
            'quantity': quantity,
            'action': fill.action
          }]
        };
      } else {
        orderData = {
          'time-in-force': 'GTC',
          'order-type': 'Market',
          'legs': [{
            'instrument-type': 'Equity',
            'symbol': fill.symbol,
            'quantity': quantity,
            'action': fill.action
          }]
        };
      }

      const result = await this.tastytrade.orderService.createOrder(
        this.config.accountNumber,
        orderData
      );

      const orderId = result.data?.order?.id || result.data?.order?.['order-id'] || 'unknown';
      console.log(`✅ Order submitted (GTC)! ID: ${orderId}`);
      
      this.tradesExecutedToday++;

      return {
        success: true,
        orderId,
        quantity,
        symbol: fill.symbol,
        timeInForce: 'GTC'
      };

    } catch (error) {
      console.error('❌ GTC retry also failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Build OCC option symbol
   * Format: SYMBOL + YYMMDD + P/C + Strike*1000 (8 digits)
   * Example: SPY   251206P00600000
   */
  buildOptionSymbol(fill) {
    // Parse expiration date
    let expDate;
    const expStr = fill.expiration;
    
    // Try different date formats
    if (expStr.includes('/')) {
      const parts = expStr.split('/');
      if (parts.length === 2) {
        // MM/DD format - assume current year
        const month = parts[0].padStart(2, '0');
        const day = parts[1].padStart(2, '0');
        const year = new Date().getFullYear().toString().slice(-2);
        expDate = `${year}${month}${day}`;
      } else if (parts.length === 3) {
        // MM/DD/YY or MM/DD/YYYY
        const month = parts[0].padStart(2, '0');
        const day = parts[1].padStart(2, '0');
        const year = parts[2].length === 4 ? parts[2].slice(-2) : parts[2];
        expDate = `${year}${month}${day}`;
      }
    } else if (expStr.match(/^\d{6}$/)) {
      // Already in YYMMDD format
      expDate = expStr;
    }

    if (!expDate) {
      throw new Error(`Cannot parse expiration date: ${expStr}`);
    }

    // Option type
    const optionChar = fill.optionType?.toUpperCase().startsWith('P') ? 'P' : 'C';

    // Strike price (multiply by 1000, pad to 8 digits)
    const strikeFormatted = String(Math.round(fill.strike * 1000)).padStart(8, '0');

    // Symbol (pad to 6 characters)
    const symbolPadded = fill.symbol.padEnd(6, ' ');

    return `${symbolPadded}${expDate}${optionChar}${strikeFormatted}`;
  }

  /**
   * Get bot statistics
   */
  getStats() {
    const stats = {
      environment: TASTYTRADE_ENV,
      tradesExecutedToday: this.tradesExecutedToday,
      maxDailyTrades: this.config.maxDailyTrades,
      lossToday: this.lossToday,
      maxDailyLoss: this.config.maxDailyLoss,
      processedFillsCount: this.processedFills.size,
      isConnected: this.isConnected,
      sizingMethod: this.config.sizingMethod
    };

    // Add proportional sizing info if enabled
    if (this.positionSizer) {
      stats.proportionalSizing = this.positionSizer.getSizingInfo();
    }

    return stats;
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('\n🛑 Shutting down Fill Follower Bot...');

    // Clear balance refresh interval
    if (this.balanceRefreshInterval) {
      clearInterval(this.balanceRefreshInterval);
    }

    if (this.discord) {
      await this.discord.destroy();
    }

    console.log('👋 Goodbye!');
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

const bot = new FillFollowerBot();

bot.start().catch(error => {
  console.error('❌ Failed to start bot:', error.message);
  process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await bot.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await bot.shutdown();
  process.exit(0);
});

module.exports = FillFollowerBot;
