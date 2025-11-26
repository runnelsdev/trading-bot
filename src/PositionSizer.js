const TastytradeClient = require('@tastytrade/api').default;

/**
 * Position Sizer
 * Calculates position size based on configuration
 */
class PositionSizer {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  /**
   * Initialize Tastytrade client for account queries
   */
  async initialize() {
    if (!this.client) {
      const TastytradeClient = require('@tastytrade/api').default;
      this.client = new TastytradeClient({
        baseUrl: process.env.TASTYTRADE_ENV === 'production' 
          ? 'https://api.tastytrade.com'
          : 'https://api.cert.tastyworks.com'
      });

      await this.client.sessionService.login(
        this.config.tastytradeUsername,
        this.config.tastytradePassword
      );
    }
  }

  /**
   * Calculate position size for a signal
   */
  async calculate(signal) {
    await this.initialize();

    switch (this.config.sizingMethod) {
      case 'fixed':
        return this.config.quantity || 1;

      case 'multiplier':
        return Math.floor((signal.quantity || 1) * (this.config.multiplier || 1));

      case 'percentage':
        return await this.calculatePercentage(signal);

      default:
        return 1;
    }
  }

  /**
   * Calculate position size based on account percentage
   */
  async calculatePercentage(signal) {
    try {
      // Get account balance
      const balances = await this.client.balancesAndPositionsService.getAccountBalanceValues(
        this.config.tastytradeAccountNumber
      );

      // Get buying power
      const buyingPower = parseFloat(
        balances['day-trading-buying-power'] || 
        balances['overnight-buying-power'] || 
        '0'
      );

      if (buyingPower <= 0) {
        console.warn('⚠️  No buying power available, using fixed quantity');
        return this.config.quantity || 1;
      }

      // Calculate percentage
      const percentage = this.config.percentage || 5;
      const targetAmount = buyingPower * (percentage / 100);

      // Estimate position size (simplified - would need current price)
      // For now, use a conservative estimate
      const estimatedPrice = 100; // Would need to fetch actual price
      const quantity = Math.floor(targetAmount / estimatedPrice);

      return Math.max(1, quantity); // At least 1 contract/share
    } catch (error) {
      console.error('Error calculating percentage size:', error.message);
      return this.config.quantity || 1; // Fallback to fixed
    }
  }
}

module.exports = PositionSizer;



