const TastytradeClient = require('@tastytrade/api').default;

/**
 * Position Sizer
 * Calculates position size based on configuration
 *
 * Supports multiple sizing methods:
 * - 'fixed': Always trade a fixed quantity
 * - 'multiplier': Coach's quantity × multiplier
 * - 'percentage': % of follower's buying power
 * - 'proportional': Mirror coach's position as % of account (LOW LATENCY)
 */
class PositionSizer {
  constructor(config) {
    this.config = config;
    this.client = null;

    // Cached balances for low-latency proportional sizing
    this.cachedFollowerBalance = null;
    this.cachedCoachBalance = null;
    this.cachedRatio = null;  // follower_balance / coach_balance (pre-computed)
    this.balancesCachedAt = null;
    this.balanceCacheTTL = config.balanceCacheTTL || 60000; // 1 minute default
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
   * Initialize proportional sizing with cached balances
   * Call this at startup and periodically (e.g., every minute) for low latency
   *
   * @param {number} coachBalance - Coach's account balance (net liquidating value)
   * @param {number} followerBalance - Optional: override follower balance query
   */
  async initializeProportionalSizing(coachBalance, followerBalance = null) {
    await this.initialize();

    console.log('📊 Initializing proportional position sizing...');

    // Cache coach balance (provided externally from broadcast or config)
    if (coachBalance && coachBalance > 0) {
      this.cachedCoachBalance = coachBalance;
      console.log(`   Coach balance: $${coachBalance.toLocaleString()}`);
    } else {
      throw new Error('Coach balance is required for proportional sizing');
    }

    // Get or use provided follower balance
    if (followerBalance && followerBalance > 0) {
      this.cachedFollowerBalance = followerBalance;
    } else {
      // Query follower's account balance
      this.cachedFollowerBalance = await this.getFollowerNetLiq();
    }

    console.log(`   Follower balance: $${this.cachedFollowerBalance.toLocaleString()}`);

    // Pre-compute ratio for instant calculations
    this.cachedRatio = this.cachedFollowerBalance / this.cachedCoachBalance;
    this.balancesCachedAt = Date.now();

    console.log(`   Size ratio: ${this.cachedRatio.toFixed(4)} (follower/coach)`);
    console.log(`   Example: Coach 10 contracts → Follower ${Math.round(10 * this.cachedRatio)} contracts`);
    console.log('✅ Proportional sizing initialized');

    return {
      coachBalance: this.cachedCoachBalance,
      followerBalance: this.cachedFollowerBalance,
      ratio: this.cachedRatio
    };
  }

  /**
   * Update coach balance (call when receiving coach account updates)
   * This is non-blocking for the hot path
   */
  updateCoachBalance(newBalance) {
    if (newBalance && newBalance > 0) {
      this.cachedCoachBalance = newBalance;
      if (this.cachedFollowerBalance) {
        this.cachedRatio = this.cachedFollowerBalance / this.cachedCoachBalance;
      }
      this.balancesCachedAt = Date.now();
    }
  }

  /**
   * Update follower balance (call after fills or periodically)
   * This is non-blocking for the hot path
   */
  updateFollowerBalance(newBalance) {
    if (newBalance && newBalance > 0) {
      this.cachedFollowerBalance = newBalance;
      if (this.cachedCoachBalance) {
        this.cachedRatio = this.cachedFollowerBalance / this.cachedCoachBalance;
      }
      this.balancesCachedAt = Date.now();
    }
  }

  /**
   * Refresh follower balance from Tastytrade (async, non-blocking)
   * Call this periodically or after trades settle
   */
  async refreshFollowerBalance() {
    try {
      const newBalance = await this.getFollowerNetLiq();
      this.updateFollowerBalance(newBalance);
      console.log(`📊 Follower balance refreshed: $${newBalance.toLocaleString()}`);
      return newBalance;
    } catch (error) {
      console.error('⚠️  Failed to refresh follower balance:', error.message);
      return this.cachedFollowerBalance;
    }
  }

  /**
   * Get follower's net liquidating value
   */
  async getFollowerNetLiq() {
    await this.initialize();

    const balances = await this.client.balancesAndPositionsService.getAccountBalanceValues(
      this.config.tastytradeAccountNumber
    );

    // Prefer net-liquidating-value, fallback to buying power
    const netLiq = parseFloat(
      balances['net-liquidating-value'] ||
      balances['equity-value'] ||
      balances['cash-balance'] ||
      '0'
    );

    return netLiq;
  }

  /**
   * Calculate position size for a signal
   * LOW LATENCY: For 'proportional' method, uses cached ratio (no network calls)
   */
  async calculate(signal) {
    switch (this.config.sizingMethod) {
      case 'fixed':
        return this.config.quantity || 1;

      case 'multiplier':
        return Math.floor((signal.quantity || 1) * (this.config.multiplier || 1));

      case 'percentage':
        return await this.calculatePercentage(signal);

      case 'proportional':
        return this.calculateProportional(signal);

      default:
        return 1;
    }
  }

  /**
   * Calculate proportional position size (LOW LATENCY)
   * Mirrors coach's position as percentage of account
   *
   * Formula: follower_qty = coach_qty × (follower_balance / coach_balance)
   *
   * @param {Object} signal - Trade signal with quantity
   * @returns {number} Position size for follower
   */
  calculateProportional(signal) {
    const coachQuantity = signal.quantity || 1;

    // Fast path: use pre-computed ratio
    if (this.cachedRatio !== null) {
      const rawQuantity = coachQuantity * this.cachedRatio;

      // Apply min/max limits
      let quantity = Math.round(rawQuantity);

      // Ensure at least minQuantity (default 1)
      const minQty = this.config.minQuantity || 1;
      quantity = Math.max(minQty, quantity);

      // Apply max limit if configured
      if (this.config.maxQuantity) {
        quantity = Math.min(quantity, this.config.maxQuantity);
      }

      // Log sizing decision (only if significant)
      if (quantity !== coachQuantity) {
        console.log(`📊 Proportional: Coach ${coachQuantity} → Follower ${quantity} (ratio: ${this.cachedRatio.toFixed(3)})`);
      }

      return quantity;
    }

    // Fallback: ratio not initialized
    console.warn('⚠️  Proportional sizing not initialized, using coach quantity');
    return Math.max(1, coachQuantity);
  }

  /**
   * Calculate position size based on account percentage
   */
  async calculatePercentage(signal) {
    try {
      await this.initialize();

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

  /**
   * Get current sizing configuration and cached values
   */
  getSizingInfo() {
    return {
      method: this.config.sizingMethod,
      coachBalance: this.cachedCoachBalance,
      followerBalance: this.cachedFollowerBalance,
      ratio: this.cachedRatio,
      cachedAt: this.balancesCachedAt,
      cacheAge: this.balancesCachedAt ? Date.now() - this.balancesCachedAt : null,
      minQuantity: this.config.minQuantity || 1,
      maxQuantity: this.config.maxQuantity || null
    };
  }

  /**
   * Check if cache needs refresh
   */
  needsCacheRefresh() {
    if (!this.balancesCachedAt) return true;
    return (Date.now() - this.balancesCachedAt) > this.balanceCacheTTL;
  }
}

module.exports = PositionSizer;




