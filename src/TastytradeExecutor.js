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
      
      // Build order
      const orderData = {
        'time-in-force': 'Day',
        'order-type': signal.orderType || 'Market',
        'size': quantity,
        'underlying-symbol': signal.symbol,
        'legs': [{
          'instrument-type': 'Equity',
          'symbol': signal.symbol,
          'quantity': quantity,
          'action': signal.action
        }]
      };
      
      // Execute order
      const isComplex = signal.legs && signal.legs.length > 1;
      let result;
      
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
      
    } catch (error) {
      console.error('❌ Trade execution failed:', error.message);
      
      // Update loss if it was a losing trade (simplified)
      // In production, you'd track actual P&L
      
      return {
        success: false,
        reason: 'execution_error',
        error: error.message
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


