const TastytradeClient = require('@tastytrade/api').default;
const PositionSizer = require('./PositionSizer');

/**
 * Tastytrade Executor
 * Executes trades in Tastytrade account
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
  }

  /**
   * Connect to Tastytrade
   */
  async connect() {
    console.log('🔌 Connecting to Tastytrade...');
    
    // Use OAuth if available, otherwise session
    if (this.config.tastytradeClientSecret && this.config.tastytradeRefreshToken) {
      // OAuth authentication
      this.client = new TastytradeClient({
        ...(process.env.TASTYTRADE_ENV === 'production' 
          ? TastytradeClient.ProdConfig 
          : TastytradeClient.SandboxConfig),
        clientSecret: this.config.tastytradeClientSecret,
        refreshToken: this.config.tastytradeRefreshToken,
        oauthScopes: ['read', 'trade', 'openid']
      });
    } else {
      // Session-based authentication
      await this.client.sessionService.login(
        this.config.tastytradeUsername,
        this.config.tastytradePassword
      );
    }
    
    console.log('✅ Tastytrade connected');
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
      
      // Build order for equity
      // For simple equity orders, we don't need 'underlying-symbol' or 'legs' structure
      const orderData = {
        'time-in-force': timeInForce,
        'order-type': signal.orderType || 'Market',
        'size': quantity,
        'legs': [{
          'instrument-type': 'Equity',
          'symbol': signal.symbol,
          'quantity': quantity,
          'action': signal.action
        }]
      };
      
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
}

module.exports = TastytradeExecutor;


