// ConfigClient.js - Bot-side client for central server (Batch Validation)
const axios = require('axios');

class ConfigClient {
  constructor(config) {
    if (!config.serverUrl) {
      throw new Error('serverUrl is required');
    }
    if (!config.botToken) {
      throw new Error('botToken is required');
    }
    // Need either subscriberId or deploymentId
    if (!config.subscriberId && !config.deploymentId) {
      throw new Error('subscriberId or deploymentId is required');
    }

    this.serverUrl = config.serverUrl.replace(/\/$/, ''); // Remove trailing slash
    this.subscriberId = config.subscriberId;
    this.deploymentId = config.deploymentId;
    this.botToken = config.botToken;
    this.sessionToken = null;
    this.botId = null;  // Will be set after authentication
    this.tradingStatus = null;

    console.log(`🔗 ConfigClient initialized: ${this.serverUrl}`);
    if (this.deploymentId) {
      console.log(`   Deployment: ${this.deploymentId}`);
    }
  }

  /**
   * Authenticate with central server and get today's trading status
   * Call this once when bot starts up (before market opens)
   */
  async authenticate(discordUserId) {
    if (!discordUserId) {
      throw new Error('discordUserId is required for authentication');
    }
    
    console.log('🔐 Authenticating with central server...');
    
    try {
      const response = await axios.post(
        `${this.serverUrl}/api/v1/bot/authenticate`,
        {
          subscriberId: this.subscriberId,
          botToken: this.botToken,
          discordUserId: discordUserId,
          deploymentId: this.deploymentId  // For multi-bot support
        },
        {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      this.sessionToken = response.data.sessionToken;
      this.botId = response.data.botId;  // Store botId for tracking
      this.subscriberId = response.data.subscriberId || this.subscriberId;  // Update if server returned it
      this.tradingStatus = response.data.status;
      
      // Validate status is current
      const validUntil = new Date(this.tradingStatus.validUntil);
      const now = new Date();
      
      if (now > validUntil) {
        console.log('⚠️  Trading status expired (market closed)');
        console.log('   Will be refreshed at midnight before next market open');
        this.tradingStatus.canTrade = false;
      }
      
      // Log authentication result
      console.log('✅ Authenticated with central server');
      if (this.botId) {
        console.log(`   Bot ID: ${this.botId}`);
      }
      console.log(`   Subscriber: ${this.subscriberId}`);
      console.log(`   Status: ${this.tradingStatus.canTrade ? '✅ ENABLED' : '⛔ DISABLED'}`);
      
      if (this.tradingStatus.canTrade) {
        console.log(`   Tier: ${this.tradingStatus.tier}`);
        console.log(`   Monthly Profit: $${this.tradingStatus.monthlyProfitUsed.toLocaleString()} / $${this.tradingStatus.monthlyCapLimit.toLocaleString()}`);
        console.log(`   Max Position Size: $${this.tradingStatus.maxPositionSize.toLocaleString()}`);
        console.log(`   Valid Until: ${validUntil.toLocaleString()}`);
      } else {
        console.log(`   Reason: ${this.tradingStatus.reason}`);
        console.log(`   Message: ${this.tradingStatus.message}`);
      }
      
      return this.tradingStatus;
      
    } catch (error) {
      if (error.response) {
        // Server responded with error
        const status = error.response.status;
        const data = error.response.data;
        
        if (status === 401) {
          throw new Error(`Authentication failed: ${data.error || 'Invalid credentials'}`);
        } else if (status === 403) {
          throw new Error(`Access denied: ${data.error || 'Account inactive'}`);
        } else if (status === 404) {
          throw new Error(`Subscriber not found: ${data.error}`);
        } else {
          throw new Error(`Server error (${status}): ${data.error || 'Unknown error'}`);
        }
      } else if (error.request) {
        // No response received
        throw new Error(`Cannot reach central server at ${this.serverUrl}. Check network connectivity.`);
      } else {
        // Request setup error
        throw new Error(`Authentication error: ${error.message}`);
      }
    }
  }

  /**
   * Check if trading is allowed today
   * This is a simple local check - no HTTP call
   * 
   * @returns {boolean} true if trading is allowed
   */
  canTradeToday() {
    if (!this.tradingStatus) {
      console.log('⚠️  No trading status - not authenticated yet');
      return false;
    }
    
    // Check if status is still valid
    const validUntil = new Date(this.tradingStatus.validUntil);
    const now = new Date();
    
    if (now > validUntil) {
      console.log('⚠️  Trading status expired');
      return false;
    }
    
    return this.tradingStatus.canTrade;
  }

  /**
   * Check if a position size is within tier limits
   * This is a simple local check - no HTTP call
   * 
   * @param {number} positionValue - Dollar value of the position
   * @returns {boolean} true if position is within limits
   */
  canExecutePosition(positionValue) {
    if (!this.canTradeToday()) {
      return false;
    }
    
    return positionValue <= this.tradingStatus.maxPositionSize;
  }

  /**
   * Get current trading status (for display purposes)
   * 
   * @returns {object} Current trading status
   */
  getStatus() {
    return this.tradingStatus;
  }

  /**
   * Report a trade result to the central server
   * This is non-blocking (fire-and-forget) - doesn't affect trading
   * 
   * @param {object} trade - Trade details
   * @param {string} trade.symbol - Trade symbol
   * @param {number} trade.quantity - Number of contracts/shares
   * @param {number} trade.fillPrice - Fill price per contract/share
   * @param {number} trade.pnl - Profit/loss (optional, 0 if not closed yet)
   * @param {string} trade.timestamp - Execution timestamp (optional, defaults to now)
   */
  async reportTrade(trade) {
    if (!this.sessionToken) {
      console.log('⚠️  Cannot report trade - not authenticated');
      return;
    }
    
    // Don't block on reporting - fire and forget
    setImmediate(async () => {
      try {
        await axios.post(
          `${this.serverUrl}/api/v1/report-trade`,
          {
            symbol: trade.symbol,
            quantity: trade.quantity,
            fillPrice: trade.fillPrice,
            pnl: trade.pnl || 0,
            timestamp: trade.timestamp || new Date().toISOString()
          },
          {
            timeout: 5000,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.sessionToken}`
            }
          }
        );
        
        console.log(`📊 Trade reported: ${trade.symbol} ${trade.quantity}@${trade.fillPrice}`);
        
      } catch (error) {
        // Don't throw - reporting failures shouldn't affect trading
        console.log(`⚠️  Failed to report trade: ${error.message}`);
        // Trade will still be reconciled from brokerage data
      }
    });
  }

  /**
   * Update PnL for a previously reported trade (when position closes)
   * This is non-blocking (fire-and-forget)
   * 
   * @param {string} tradeId - ID from original trade report
   * @param {number} pnl - Final profit/loss
   */
  async updateTradePnL(tradeId, pnl) {
    if (!this.sessionToken) {
      console.log('⚠️  Cannot update PnL - not authenticated');
      return;
    }
    
    // Don't block on update - fire and forget
    setImmediate(async () => {
      try {
        await axios.post(
          `${this.serverUrl}/api/v1/update-pnl`,
          {
            tradeId,
            pnl
          },
          {
            timeout: 5000,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.sessionToken}`
            }
          }
        );
        
        console.log(`📊 PnL updated: ${tradeId} = $${pnl}`);
        
      } catch (error) {
        console.log(`⚠️  Failed to update PnL: ${error.message}`);
      }
    });
  }

  /**
   * Refresh trading status from server (optional - for manual refresh)
   * Normally status is set at authentication and valid all day
   */
  async refreshStatus() {
    if (!this.sessionToken) {
      throw new Error('Not authenticated - call authenticate() first');
    }
    
    console.log('🔄 Refreshing trading status from server...');
    
    try {
      const response = await axios.get(
        `${this.serverUrl}/api/v1/bot/status`,
        {
          timeout: 5000,
          headers: {
            'Authorization': `Bearer ${this.sessionToken}`
          }
        }
      );
      
      this.tradingStatus = response.data.status;
      
      console.log(`✅ Status refreshed: ${this.tradingStatus.canTrade ? 'ENABLED' : 'DISABLED'}`);
      
      return this.tradingStatus;
      
    } catch (error) {
      console.error('⚠️  Failed to refresh status:', error.message);
      // Keep existing status
      return this.tradingStatus;
    }
  }

  /**
   * Get blocking reason and message (for error display)
   */
  getBlockingInfo() {
    if (!this.tradingStatus) {
      return {
        reason: 'not_authenticated',
        message: 'Not authenticated with central server'
      };
    }
    
    if (this.tradingStatus.canTrade) {
      return null;
    }
    
    return {
      reason: this.tradingStatus.reason,
      message: this.tradingStatus.message
    };
  }
}

module.exports = ConfigClient;
