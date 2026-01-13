const TastytradeClient = require('@tastytrade/api').default;
const PositionSizer = require('./PositionSizer');
const ConfigClient = require('./ConfigClient');

/**
 * Tastytrade Executor
 * Executes trades in Tastytrade account
 * Integrates with Central Server for subscription tier validation
 */
class TastytradeExecutor {
  constructor(config) {
    this.config = config;
    
    const baseUrl = process.env.TASTYTRADE_ENV === 'production'
      ? 'https://api.tastytrade.com'
      : 'https://api.cert.tastyworks.com';
    
    this.client = new TastytradeClient(
      process.env.TASTYTRADE_ENV === 'production'
        ? TastytradeClient.ProdConfig
        : TastytradeClient.SandboxConfig
    );
    
    this.sizer = new PositionSizer(config);
    this.tradesExecutedToday = 0;
    this.lossToday = 0;
    this.lastResetDate = new Date().toDateString();
    
    // Initialize Central Server ConfigClient (optional)
    // Need CENTRAL_SERVER_URL, CENTRAL_BOT_TOKEN, and either CENTRAL_SUBSCRIBER_ID or DEPLOYMENT_ID
    this.configClient = null;
    if (process.env.CENTRAL_SERVER_URL && process.env.CENTRAL_BOT_TOKEN && (process.env.CENTRAL_SUBSCRIBER_ID || process.env.DEPLOYMENT_ID)) {
      try {
        this.configClient = new ConfigClient({
          serverUrl: process.env.CENTRAL_SERVER_URL,
          subscriberId: process.env.CENTRAL_SUBSCRIBER_ID,
          deploymentId: process.env.DEPLOYMENT_ID,
          botToken: process.env.CENTRAL_BOT_TOKEN
        });
        console.log('🔗 Central Server ConfigClient initialized');
      } catch (error) {
        console.warn('⚠️  Failed to initialize ConfigClient:', error.message);
        this.configClient = null;
      }
    }
  }

  /**
   * Connect to Tastytrade and Central Server
   */
  async connect() {
    console.log('🔌 Connecting to Tastytrade...');
    
    // Use OAuth if available, otherwise session
    if (this.config.tastytradeClientSecret && this.config.tastytradeRefreshToken) {
      // OAuth authentication
      console.log('   Using OAuth authentication...');
      this.client = new TastytradeClient({
        ...(process.env.TASTYTRADE_ENV === 'production' 
          ? TastytradeClient.ProdConfig 
          : TastytradeClient.SandboxConfig),
        clientSecret: this.config.tastytradeClientSecret,
        refreshToken: this.config.tastytradeRefreshToken,
        oauthScopes: ['read', 'trade', 'openid']
      });
      
      // Make a request to trigger OAuth token refresh before using streamer
      try {
        await this.client.accountsAndCustomersService.getCustomerAccounts();
        console.log('   OAuth token validated');
      } catch (e) {
        console.error('   OAuth token validation failed:', e.message);
        throw e;
      }
      
      console.log('✅ Tastytrade connected (OAuth)');
    } else {
      // Session-based authentication
      console.log('   Using session authentication...');
      await this.client.sessionService.login(
        this.config.tastytradeUsername,
        this.config.tastytradePassword
      );
      console.log('✅ Tastytrade connected (Session)');
    }
    
    // Connect to Central Server for tier validation (optional)
    if (this.configClient && process.env.CENTRAL_DISCORD_USER_ID) {
      try {
        await this.configClient.authenticate(process.env.CENTRAL_DISCORD_USER_ID);
        console.log('✅ Central Server connected');
      } catch (error) {
        console.warn('⚠️  Central Server connection failed:', error.message);
        console.warn('   Trading will continue without tier validation');
      }
    }

    // Initialize proportional sizing if configured
    if (this.config.sizingMethod === 'proportional') {
      await this.initializeProportionalSizing();
    }
  }

  /**
   * Initialize proportional position sizing
   * Queries follower balance and computes ratio with coach balance
   */
  async initializeProportionalSizing() {
    const coachBalance = this.config.coachBalance || parseFloat(process.env.COACH_ACCOUNT_BALANCE) || 0;

    if (!coachBalance || coachBalance <= 0) {
      console.warn('⚠️  Coach balance not configured for proportional sizing');
      console.warn('   Set coachBalance in config or COACH_ACCOUNT_BALANCE env var');
      console.warn('   Falling back to fixed quantity sizing');
      this.config.sizingMethod = 'fixed';
      return;
    }

    try {
      await this.sizer.initializeProportionalSizing(coachBalance);

      // Start periodic balance refresh (every 60 seconds by default)
      const refreshInterval = this.config.balanceCacheTTL || 60000;
      this.balanceRefreshInterval = setInterval(async () => {
        try {
          await this.sizer.refreshFollowerBalance();
        } catch (error) {
          console.warn('⚠️  Background balance refresh failed:', error.message);
        }
      }, refreshInterval);

      console.log(`📊 Balance refresh scheduled every ${refreshInterval / 1000}s`);
    } catch (error) {
      console.error('❌ Failed to initialize proportional sizing:', error.message);
      console.warn('   Falling back to fixed quantity sizing');
      this.config.sizingMethod = 'fixed';
    }
  }

  /**
   * Reset daily counters if new day
   */
  resetDailyCounters() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.tradesExecutedToday = 0;
      this.lossToday = 0;
      this.lastResetDate = today;
      console.log('📅 Daily counters reset');
    }
  }

  /**
   * Get appropriate time-in-force based on current time
   * Valid Tastytrade values: Day, GTC (Good Till Canceled), IOC (Immediate or Cancel), FOK (Fill or Kill)
   * Note: "EXT" is not a valid time-in-force value. For extended hours, we use "Day" and let Tastytrade handle routing.
   * Regular hours: 9:30am - 3:15pm CT (14:30 - 20:15 UTC)
   */
  getTimeInForce() {
    // Tastytrade doesn't have "EXT" as a time-in-force value
    // The API will automatically route Day orders during extended hours if the account allows it
    // If Day orders fail outside hours, we'll need to handle that with retry logic
    return 'Day';
  }

  /**
   * Execute trade from signal
   */
  async executeTrade(signal) {
    try {
      // Reset counters if new day
      this.resetDailyCounters();
      
      // Check Central Server tier validation (if connected)
      if (this.configClient) {
        if (!this.configClient.canTradeToday()) {
          const info = this.configClient.getBlockingInfo();
          console.log(`⛔ Trading blocked by Central Server: ${info?.message || 'Unknown reason'}`);
          return { success: false, reason: 'tier_blocked', message: info?.message };
        }
      }
      
      // Check daily limits
      if (this.tradesExecutedToday >= this.config.maxDailyTrades) {
        console.log(`⚠️  Daily trade limit reached (${this.config.maxDailyTrades}), skipping`);
        return { success: false, reason: 'daily_limit' };
      }
      
      if (this.lossToday >= this.config.maxDailyLoss) {
        console.log(`⚠️  Daily loss limit reached ($${this.config.maxDailyLoss}), skipping`);
        return { success: false, reason: 'loss_limit' };
      }
      
      // Calculate position size
      const quantity = await this.sizer.calculate(signal);
      
      if (quantity <= 0) {
        console.log('⚠️  Invalid quantity calculated, skipping');
        return { success: false, reason: 'invalid_quantity' };
      }
      
      console.log(`📊 Executing: ${signal.action} ${quantity} ${signal.symbol}`);
      
      // Determine time-in-force based on market hours
      // EXT allows extended hours trading, Day only works during regular hours (9:30am-3:15pm CT)
      // Use EXT by default to allow trading outside regular hours
      const timeInForce = signal.timeInForce || this.getTimeInForce();
      
      // Build order - check if this is an options trade
      const isOptions = signal.instrumentType === 'Equity Option' || 
                        (signal.strike && signal.expiration && signal.optionType);
      
      let orderData;
      
      if (isOptions) {
        // Build option symbol in OCC format: SYMBOL + YYMMDD + P/C + Strike*1000
        // Example: SPY251128P00664000
        const expDate = this.formatExpirationDate(signal.expiration);
        const optionChar = signal.optionType?.toUpperCase().startsWith('P') ? 'P' : 'C';
        const strikeFormatted = String(Math.round(signal.strike * 1000)).padStart(8, '0');
        const optionSymbol = `${signal.symbol.padEnd(6)}${expDate}${optionChar}${strikeFormatted}`;
        
        console.log(`🎯 Options order: ${optionSymbol}`);
        
        orderData = {
          'time-in-force': timeInForce,
          'order-type': signal.orderType || 'Market',
          'price-effect': signal.action.includes('Buy') ? 'Debit' : 'Credit',
          'legs': [{
            'instrument-type': 'Equity Option',
            'symbol': optionSymbol,
            'quantity': quantity,
            'action': signal.action
          }]
        };
        
        // Add price for limit orders
        if (signal.price && signal.orderType === 'Limit') {
          orderData.price = signal.price.toFixed(2);
        }
      } else {
        // Build equity order
        orderData = {
          'time-in-force': timeInForce,
          'order-type': signal.orderType || 'Market',
          'legs': [{
            'instrument-type': 'Equity',
            'symbol': signal.symbol,
            'quantity': quantity,
            'action': signal.action
          }]
        };
      }
      
      // Log order data for debugging
      console.log(`📦 Order data:`, JSON.stringify(orderData, null, 2));
      
      // Execute order
      const isComplex = signal.legs && signal.legs.length > 1;
      let result;
      
      try {
        if (isComplex) {
          result = await this.client.orderService.createComplexOrder(
            this.config.tastytradeAccountNumber,
            orderData
          );
        } else {
          result = await this.client.orderService.createOrder(
            this.config.tastytradeAccountNumber,
            orderData
          );
        }
        
        this.tradesExecutedToday++;
        
        const orderId = result.data?.order?.id || result.data?.order?.['order-id'] || 'unknown';
        console.log(`✅ Trade executed: Order ID ${orderId}`);
        
        // Report trade to Central Server (async, non-blocking)
        if (this.configClient) {
          this.configClient.reportTrade({
            symbol: signal.symbol,
            quantity: quantity,
            fillPrice: signal.price || 0,
            pnl: 0, // Will be updated when position closes
            timestamp: new Date().toISOString()
          });
        }
        
        return {
          success: true,
          orderId,
          quantity,
          symbol: signal.symbol,
          action: signal.action
        };
      } catch (orderError) {
        // Enhanced error logging for 422 validation errors
        if (orderError.response) {
          console.error(`❌ API Error (${orderError.response.status}):`, orderError.response.statusText);
          console.error(`📋 Response data:`, JSON.stringify(orderError.response.data, null, 2));
          
          if (orderError.response.status === 422) {
            console.error(`\n💡 Validation Error Details:`);
            let shouldRetry = false;
            
            if (orderError.response.data?.errors) {
              for (const err of orderError.response.data.errors) {
                console.error(`   - ${err.code || 'unknown'}: ${err.message || err}`);
                
                // Auto-fix suggestion for time-in-force errors
                if (err.code === 'tif_day_invalid_intersession') {
                  shouldRetry = true;
                }
              }
            }
            
            if (orderError.response.data?.message) {
              console.error(`   Message: ${orderError.response.data.message}`);
            }
            
            // Retry with GTC if we got the time-in-force error (GTC works outside regular hours)
            if (shouldRetry) {
              console.error(`\n💡 Suggestion: Retry with GTC (Good Till Canceled) time-in-force`);
              console.error(`   GTC orders can be placed outside regular trading hours`);
              console.error(`   The order will be retried automatically with GTC...`);
              
              // Retry with GTC (Good Till Canceled) which works outside regular hours
              orderData['time-in-force'] = 'GTC';
              console.log(`🔄 Retrying order with GTC time-in-force...`);
              
              try {
                if (isComplex) {
                  result = await this.client.orderService.createComplexOrder(
                    this.config.tastytradeAccountNumber,
                    orderData
                  );
                } else {
                  result = await this.client.orderService.createOrder(
                    this.config.tastytradeAccountNumber,
                    orderData
                  );
                }
                
                this.tradesExecutedToday++;
                const orderId = result.data?.order?.id || result.data?.order?.['order-id'] || 'unknown';
                console.log(`✅ Trade executed (with GTC): Order ID ${orderId}`);
                
                // Report trade to Central Server (async, non-blocking)
                if (this.configClient) {
                  this.configClient.reportTrade({
                    symbol: signal.symbol,
                    quantity: quantity,
                    fillPrice: signal.price || 0,
                    pnl: 0,
                    timestamp: new Date().toISOString()
                  });
                }
                
                return {
                  success: true,
                  orderId,
                  quantity,
                  symbol: signal.symbol,
                  action: signal.action,
                  timeInForce: 'GTC'
                };
              } catch (retryError) {
                console.error(`❌ Retry also failed: ${retryError.message}`);
                if (retryError.response) {
                  console.error(`   Status: ${retryError.response.status}`);
                  console.error(`   Data:`, JSON.stringify(retryError.response.data, null, 2));
                }
                throw retryError;
              }
            }
          }
        }
        throw orderError; // Re-throw to be caught by outer catch
      }
      
    } catch (error) {
      console.error('❌ Trade execution failed:', error.message);
      
      // Log full error details if available
      if (error.response) {
        console.error(`   Status: ${error.response.status}`);
        console.error(`   Data:`, JSON.stringify(error.response.data, null, 2));
      }
      
      // Update loss if it was a losing trade (simplified)
      // In production, you'd track actual P&L
      
      return {
        success: false,
        reason: 'execution_error',
        error: error.message,
        statusCode: error.response?.status,
        details: error.response?.data
      };
    }
  }

  /**
   * Get execution stats
   */
  getStats() {
    return {
      tradesExecutedToday: this.tradesExecutedToday,
      maxDailyTrades: this.config.maxDailyTrades,
      lossToday: this.lossToday,
      maxDailyLoss: this.config.maxDailyLoss
    };
  }

  /**
   * Get Central Server status (for display/debugging)
   */
  getCentralServerStatus() {
    if (!this.configClient) {
      return { connected: false, reason: 'not_configured' };
    }
    
    const status = this.configClient.getStatus();
    if (!status) {
      return { connected: false, reason: 'not_authenticated' };
    }
    
    return {
      connected: true,
      canTrade: this.configClient.canTradeToday(),
      tier: status.tier,
      monthlyProfitUsed: status.monthlyProfitUsed,
      monthlyCapLimit: status.monthlyCapLimit,
      maxPositionSize: status.maxPositionSize,
      validUntil: status.validUntil
    };
  }

  /**
   * Get ConfigClient instance (for external access if needed)
   */
  getConfigClient() {
    return this.configClient;
  }
}

module.exports = TastytradeExecutor;


