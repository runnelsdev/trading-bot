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

    const ConfigManager = require('./ConfigManager');
    const cm = new ConfigManager();

    // Helper: save session cache after successful login
    const saveSession = (rememberToken) => {
      try {
        const sessionToken = this.client.session?.authToken
          || this.client.httpClient?.session?.authToken;
        cm.saveSessionCache(sessionToken, rememberToken || this.config.tastytradeRememberToken);
      } catch (e) {
        console.warn('   Could not save session cache:', e.message);
      }
    };

    // Helper: save updated remember-token to config
    const saveRememberToken = async (token) => {
      if (token && token !== this.config.tastytradeRememberToken) {
        console.log('   Refreshed remember-token');
        this.config.tastytradeRememberToken = token;
        try { await cm.save(this.config); } catch (e) {
          console.warn('   Could not save remember-token:', e.message);
        }
      }
    };

    let connected = false;

    // OAuth path (if configured)
    if (this.config.tastytradeClientSecret && this.config.tastytradeRefreshToken) {
      console.log('   Using OAuth authentication...');
      this.client = new TastytradeClient({
        ...(process.env.TASTYTRADE_ENV === 'production'
          ? TastytradeClient.ProdConfig
          : TastytradeClient.SandboxConfig),
        clientSecret: this.config.tastytradeClientSecret,
        refreshToken: this.config.tastytradeRefreshToken,
        oauthScopes: ['read', 'trade', 'openid']
      });
      try {
        await this.client.accountsAndCustomersService.getCustomerAccounts();
        console.log('✅ Tastytrade connected (OAuth)');
        connected = true;
      } catch (e) {
        console.error('   OAuth token validation failed:', e.message);
        throw e;
      }
    }

    // Tier 1: Try cached session token (no login call)
    if (!connected) {
      const cache = cm.loadSessionCache();
      if (cache?.sessionToken) {
        console.log('   Trying cached session token...');
        try {
          if (this.client.session) {
            this.client.session.authToken = cache.sessionToken;
          }
          if (this.client.httpClient?.session) {
            this.client.httpClient.session.authToken = cache.sessionToken;
          }
          await this.client.accountsAndCustomersService.getCustomerAccounts();
          if (cache.rememberToken) {
            this.config.tastytradeRememberToken = cache.rememberToken;
          }
          console.log('✅ Tastytrade connected (Cached Session)');
          connected = true;
        } catch (e) {
          console.log('   Cached session expired, trying next method...');
          cm.clearSessionCache();
        }
      }
    }

    // Tier 2: Try remember-token (1 login call, lighter than password)
    if (!connected && this.config.tastytradeRememberToken) {
      console.log('   Using remember-token authentication...');
      try {
        const sessionData = await this.client.sessionService.loginWithRememberToken(
          this.config.tastytradeUsername,
          this.config.tastytradeRememberToken,
          true
        );
        await saveRememberToken(sessionData['remember-token']);
        saveSession(sessionData['remember-token']);
        console.log('✅ Tastytrade connected (Remember Token)');
        connected = true;
      } catch (rememberError) {
        console.warn('⚠️  Remember-token failed:', rememberError.response?.status);
      }
    }

    // Tier 3: Password login (last resort)
    if (!connected) {
      console.log('   Using password login...');
      try {
        const sessionData = await this.client.sessionService.login(
          this.config.tastytradeUsername,
          this.config.tastytradePassword,
          true
        );
        await saveRememberToken(sessionData?.['remember-token']);
        saveSession(sessionData?.['remember-token']);
        console.log('✅ Tastytrade connected (Password)');
        connected = true;
      } catch (passwordError) {
        const pwErrData = passwordError.response?.data;
        const errCode = pwErrData?.error?.code;
        console.error('❌ Password login failed:', passwordError.response?.status, JSON.stringify(pwErrData));
        cm.clearSessionCache();
        if (errCode === 'device_challenge_required') {
          throw new Error('Device verification required. Visit the setup page to verify this device.');
        }
        throw new Error('Tastytrade login failed: ' + (pwErrData?.error?.message || passwordError.message));
      }
    }

    // Share authenticated client with PositionSizer (avoids duplicate login)
    this.sizer.setClient(this.client);

    // Connect to Central Server for tier validation (optional)
    if (this.configClient && process.env.CENTRAL_DISCORD_USER_ID) {
      try {
        await this.configClient.authenticate(process.env.CENTRAL_DISCORD_USER_ID);
        console.log('✅ Central Server connected');

        // Start heartbeat with metrics callback
        this.configClient.startHeartbeat(60000, () => ({
          tradesToday: this.tradesExecutedToday,
          cpu: process.cpuUsage ? process.cpuUsage().user / 1000000 : null,
          memory: process.memoryUsage ? Math.round(process.memoryUsage().heapUsed / 1024 / 1024) : null
        }));
      } catch (error) {
        console.warn('⚠️  Central Server connection failed:', error.message);
        console.warn('   Trading will continue without tier validation');
      }
    }

    // Initialize sizing cache if using proportional or percentage methods
    if (this.config.sizingMethod === 'proportional' || this.config.sizingMethod === 'percentage') {
      await this.initializeSizingCache();
    }
  }

  /**
   * Initialize position sizing cache
   * Caches balances for low-latency trade execution
   * For proportional: needs both coach and follower balance
   * For percentage: only needs follower balance
   */
  async initializeSizingCache() {
    let coachBalance = null;

    // Only fetch coach balance for proportional sizing
    if (this.config.sizingMethod === 'proportional') {
      // Try to fetch coach balance from central server first
      if (this.configClient) {
        try {
          coachBalance = await this.configClient.getCoachBalance();
          if (coachBalance > 0) {
            console.log(`📊 Coach balance from central server: $${coachBalance.toLocaleString()}`);
          }
        } catch (error) {
          console.warn('⚠️  Failed to fetch coach balance from central server:', error.message);
        }
      }

      // Fall back to local config if central server didn't provide balance
      if (!coachBalance || coachBalance <= 0) {
        coachBalance = this.config.coachBalance || parseFloat(process.env.COACH_ACCOUNT_BALANCE) || 0;
        if (coachBalance > 0) {
          console.log(`📊 Coach balance from local config: $${coachBalance.toLocaleString()}`);
        }
      }

      if (!coachBalance || coachBalance <= 0) {
        console.warn('⚠️  Coach balance not configured for proportional sizing');
        console.warn('   Admin should set coach balance on central server');
        console.warn('   Falling back to fixed quantity sizing');
        this.config.sizingMethod = 'fixed';
        return;
      }
    }

    try {
      // Initialize sizer with balance caching (coachBalance can be null for percentage method)
      await this.sizer.initializeSizing(coachBalance);

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
      console.error('❌ Failed to initialize position sizing:', error.message);
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
      
      const isClose = signal.action === 'Sell to Close' || signal.action === 'Buy to Close';

      // Calculate position size — only used for opening orders
      // Close orders determine quantity from actual position, not the sizer
      let quantity;
      if (!isClose) {
        quantity = await this.sizer.calculate(signal);
        if (quantity <= 0) {
          console.log('⚠️  Invalid quantity calculated, skipping');
          return { success: false, reason: 'invalid_quantity' };
        }
      }

      // Close orders: quantity based on actual position, not sizing method
      if (isClose) {
        try {
          const positions = await this.client.balancesAndPositionsService.getPositionsList(
            this.config.tastytradeAccountNumber
          );
          const pos = positions.find(p => p.symbol === signal.symbol);
          const held = pos ? Math.abs(parseFloat(pos.quantity || pos['quantity-direction'] || 0)) : 0;

          if (held === 0) {
            console.log(`⚠️  No open position for ${signal.symbol}, skipping close`);
            return { success: false, reason: 'no_position' };
          }

          // Full close from coach → close everything regardless of sizing method
          if (signal.fullClose) {
            console.log(`📊 Close (full): coach closed out → closing all ${held}`);
            quantity = held;

          } else {
            const method = this.config.sizingMethod;
            const coachQty = signal.quantity || 1;

            if (method === 'multiplier') {
              // Exact follow: close same quantity as coach, capped at position
              quantity = Math.min(coachQty, held);
              console.log(`📊 Close (exact): coach ${coachQty} → closing ${quantity} of ${held}`);

            } else if (method === 'proportional') {
              // Proportional partial close: scale coach's close qty by balance ratio
              if (this.sizer.cachedRatio !== null) {
                quantity = Math.round(coachQty * this.sizer.cachedRatio);
              }
              quantity = Math.min(quantity, held);
              // Orphan failsafe: if closing would leave 1-2 contracts, close all
              const remaining = held - quantity;
              if (remaining > 0 && remaining <= 2) {
                console.log(`📊 Close (proportional): ${quantity} + ${remaining} orphan cleanup → ${held}`);
                quantity = held;
              } else {
                console.log(`📊 Close (proportional): coach ${coachQty} → closing ${quantity} of ${held}`);
              }

            } else {
              // Fixed / percentage: always close full position
              console.log(`📊 Close (${method}): closing full position ${held}`);
              quantity = held;
            }
          }
        } catch (e) {
          console.warn(`⚠️  Could not verify position size: ${e.message}, proceeding with ${quantity}`);
        }
      }

      console.log(`📊 Executing: ${signal.action} ${quantity} ${signal.symbol}`);
      
      // Determine time-in-force based on market hours
      // EXT allows extended hours trading, Day only works during regular hours (9:30am-3:15pm CT)
      // Use EXT by default to allow trading outside regular hours
      const timeInForce = signal.timeInForce || this.getTimeInForce();
      
      // Build order - check if this is an options trade
      const isOccFormat = true; // HARDCODED: Always treat as options
      const isOptions = true; // HARDCODED: Always options
      const _unused = isOccFormat || signal.instrumentType === "Equity Option" || 
                        (signal.strike && signal.expiration && signal.optionType);
      
      let orderData;
      
      if (isOptions) {
        // Determine option symbol - use existing OCC format or build from components
        let optionSymbol;
        if (isOccFormat) {
          // Symbol is already in OCC format, use directly
          optionSymbol = signal.symbol;
          console.log('🎯 Using OCC symbol directly:', optionSymbol);
        } else {
          // Build option symbol in OCC format: SYMBOL + YYMMDD + P/C + Strike*1000
          const expDate = this.formatExpirationDate(signal.expiration);
          const optionChar = signal.optionType?.toUpperCase().startsWith('P') ? 'P' : 'C';
          const strikeFormatted = String(Math.round(signal.strike * 1000)).padStart(8, '0');
          optionSymbol = `${signal.symbol.padEnd(6)}${expDate}${optionChar}${strikeFormatted}`;
        }
        
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
      
      // Execute order with margin retry
      const isComplex = signal.legs && signal.legs.length > 1;
      let result;
      let attemptQty = quantity;

      const submitOrder = async (data) => {
        if (isComplex) {
          return this.client.orderService.createComplexOrder(this.config.tastytradeAccountNumber, data);
        }
        return this.client.orderService.createOrder(this.config.tastytradeAccountNumber, data);
      };

      const hasError = (errorData, code) => {
        return errorData?.errors?.some(e => e.code === code)
          || errorData?.error?.errors?.some(e => e.code === code);
      };

      while (attemptQty > 0) {
        orderData.legs[0].quantity = attemptQty;

        try {
          result = await submitOrder(orderData);

          this.tradesExecutedToday++;

          const orderId = result.data?.order?.id || result.data?.order?.['order-id'] || 'unknown';
          console.log(`✅ Trade executed: Order ID ${orderId}`);

          // Report trade to Central Server (async, non-blocking)
          if (this.configClient) {
            this.configClient.reportTrade({
              symbol: signal.symbol,
              quantity: attemptQty,
              fillPrice: signal.price || 0,
              pnl: 0,
              timestamp: new Date().toISOString()
            });
          }

          return {
            success: true,
            orderId,
            quantity: attemptQty,
            symbol: signal.symbol,
            action: signal.action
          };
        } catch (orderError) {
          if (!orderError.response) throw orderError;

          console.error(`❌ API Error (${orderError.response.status}):`, orderError.response.statusText);
          console.error(`📋 Response data:`, JSON.stringify(orderError.response.data, null, 2));

          const errData = orderError.response.data;

          // Margin check failed — reduce quantity and retry
          if (orderError.response.status === 422 && hasError(errData, 'margin_check_failed')) {
            attemptQty--;
            if (attemptQty > 0) {
              console.log(`📊 Margin insufficient for ${attemptQty + 1} contracts, retrying with ${attemptQty}`);
              continue;
            }
            console.log(`⚠️  Margin insufficient even for 1 contract, skipping`);
            return { success: false, reason: 'insufficient_buying_power', error: 'margin_check_failed' };
          }

          // Time-in-force error — retry with GTC
          if (orderError.response.status === 422 && hasError(errData, 'tif_day_invalid_intersession')) {
            console.log(`🔄 Retrying order with GTC time-in-force...`);
            orderData['time-in-force'] = 'GTC';
            continue;
          }

          throw orderError;
        }
      }

      // Should not reach here, but just in case
      return { success: false, reason: 'insufficient_buying_power', error: 'quantity reduced to zero' };
      
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


