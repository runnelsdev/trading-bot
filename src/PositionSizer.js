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
   * Initialize sizing with cached balances (works for both percentage and proportional)
   * Call this at startup for low latency trade execution
   *
   * @param {number} coachBalance - Coach's account balance (required for proportional, optional for percentage)
   * @param {number} followerBalance - Optional: override follower balance query
   */
  async initializeSizing(coachBalance = null, followerBalance = null) {
    await this.initialize();

    console.log('📊 Initializing position sizing...');

    // Get or use provided follower balance
    if (followerBalance && followerBalance > 0) {
      this.cachedFollowerBalance = followerBalance;
    } else {
      // Query follower's account balance
      this.cachedFollowerBalance = await this.getFollowerNetLiq();
    }

    console.log(`   Follower balance: $${this.cachedFollowerBalance.toLocaleString()}`);

    // Cache coach balance if provided (for proportional sizing)
    if (coachBalance && coachBalance > 0) {
      this.cachedCoachBalance = coachBalance;
      console.log(`   Coach balance: $${coachBalance.toLocaleString()}`);

      // Pre-compute ratio for instant proportional calculations
      this.cachedRatio = this.cachedFollowerBalance / this.cachedCoachBalance;
      console.log(`   Size ratio: ${this.cachedRatio.toFixed(4)} (follower/coach)`);
    }

    this.balancesCachedAt = Date.now();

    // Show method-specific info
    const method = this.config.sizingMethod;
    if (method === 'percentage') {
      const pct = this.config.percentage || 5;
      const riskAmount = this.cachedFollowerBalance * (pct / 100);
      console.log(`   Risk per trade: ${pct}% = $${riskAmount.toLocaleString()}`);
    }

    console.log('✅ Position sizing initialized (cached for low latency)');

    return {
      coachBalance: this.cachedCoachBalance,
      followerBalance: this.cachedFollowerBalance,
      ratio: this.cachedRatio
    };
  }

  /**
   * Alias for backward compatibility
   */
  async initializeProportionalSizing(coachBalance, followerBalance = null) {
    return this.initializeSizing(coachBalance, followerBalance);
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
   * LOW LATENCY: Uses cached balances (no network calls during hot path)
   */
  calculate(signal) {
    switch (this.config.sizingMethod) {
      case 'fixed':
        return this.config.quantity || 1;

      case 'multiplier':
        return Math.floor((signal.quantity || 1) * (this.config.multiplier || 1));

      case 'percentage':
        return this.calculatePercentage(signal);

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
      const rawRounded = quantity;

      // Ensure at least minQuantity (default 1)
      const minQty = this.config.minQuantity !== undefined ? this.config.minQuantity : 1;
      quantity = Math.max(minQty, quantity);

      // Apply max limit if configured
      if (this.config.maxQuantity) {
        quantity = Math.min(quantity, this.config.maxQuantity);
      }

      // Log sizing decision
      if (rawRounded < minQty) {
        console.log(`📊 Proportional: Coach ${coachQuantity} → Follower ${quantity} (min ${minQty} applied, raw: ${rawRounded})`);
      } else if (quantity !== coachQuantity) {
        console.log(`📊 Proportional: Coach ${coachQuantity} → Follower ${quantity} (ratio: ${this.cachedRatio.toFixed(3)})`);
      }

      return quantity;
    }

    // Fallback: ratio not initialized
    console.warn('⚠️  Proportional sizing not initialized, using coach quantity');
    return Math.max(1, coachQuantity);
  }

  /**
   * Calculate position size based on account percentage (LOW LATENCY)
   * Uses cached balance - no API calls during trade execution
   */
  calculatePercentage(signal) {
    // Use cached follower balance (NO API CALL - low latency)
    const balance = this.cachedFollowerBalance;

    if (!balance || balance <= 0) {
      console.warn('⚠️  No cached balance for percentage sizing, using fixed quantity');
      return this.config.quantity || 1;
    }

    // Calculate risk amount based on percentage
    const percentage = this.config.percentage || 5;
    const riskAmount = balance * (percentage / 100);

    // Get price from signal if available, otherwise estimate
    let pricePerContract = signal.price || signal.premium || 100;

    // Options are quoted per share but represent 100 shares
    if (signal.assetType === 'option' || signal.instrumentType === 'option') {
      pricePerContract = pricePerContract * 100;
    }

    // Calculate quantity based on risk amount / price
    const rawQuantity = riskAmount / pricePerContract;
    let quantity = Math.floor(rawQuantity);

    // Apply min/max limits
    const minQty = this.config.minQuantity !== undefined ? this.config.minQuantity : 1;
    quantity = Math.max(minQty, quantity);

    if (this.config.maxQuantity) {
      quantity = Math.min(quantity, this.config.maxQuantity);
    }

    console.log(`📊 Percentage: ${percentage}% of $${balance.toLocaleString()} = $${riskAmount.toLocaleString()} → ${quantity} contracts`);

    return quantity;
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




