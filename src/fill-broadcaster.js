const { EmbedBuilder } = require('discord.js');

/**
 * Fill Notification Broadcaster
 * Monitors Tastytrade order fills and broadcasts to tiered Discord channels
 */
class FillBroadcaster {
  constructor(discordClient, config = {}) {
    this.client = discordClient;
    this.config = {
      // Channel IDs for fill notifications
      vipFillsChannelId: config.vipFillsChannelId || process.env.VIP_FILLS_CHANNEL_ID,
      premiumFillsChannelId: config.premiumFillsChannelId || process.env.PREMIUM_FILLS_CHANNEL_ID,
      basicFillsChannelId: config.basicFillsChannelId || process.env.BASIC_FILLS_CHANNEL_ID,
      
      // Use same channels as signals if separate fills channels not configured
      fallbackToSignalChannels: config.fallbackToSignalChannels !== false,
      vipSignalChannelId: config.vipSignalChannelId || process.env.VIP_CHANNEL_ID,
      premiumSignalChannelId: config.premiumSignalChannelId || process.env.PREMIUM_CHANNEL_ID,
      basicSignalChannelId: config.basicSignalChannelId || process.env.BASIC_CHANNEL_ID,
      
      // Tier filtering for fills
      enableTierFiltering: config.enableTierFiltering !== false,
      
      // Track which original signals were sent to which tiers
      signalTierMap: new Map() // signalId -> [tiers]
    };
    
    // Track fills
    this.fillHistory = [];
    this.maxFillHistory = 1000;
  }

  /**
   * Track which tiers received a signal
   * @param {string} signalId - Signal identifier
   * @param {Array} tiers - Array of tier names that received it
   */
  trackSignalTiers(signalId, tiers) {
    this.config.signalTierMap.set(signalId, tiers);
    
    // Clean up old entries (keep last 1000)
    if (this.config.signalTierMap.size > 1000) {
      const firstKey = this.config.signalTierMap.keys().next().value;
      this.config.signalTierMap.delete(firstKey);
    }
  }

  /**
   * Broadcast fill notification to appropriate tiers
   * @param {Object} fill - Fill data from Tastytrade
   * @param {string} originalSignalId - ID of original signal (optional)
   * @returns {Object} Broadcast results
   */
  async broadcastFill(fill, originalSignalId = null) {
    const results = {
      vip: null,
      premium: null,
      basic: null,
      errors: [],
      validation: null
    };

    // Validate fill data
    const validation = this.validateFill(fill);
    results.validation = validation;

    if (!validation.isValid) {
      console.warn(`⚠️  Invalid fill data: ${validation.errors.join(', ')}`);
      
      // If critical fields missing, don't broadcast
      if (validation.critical) {
        results.errors.push({
          tier: 'all',
          error: `Critical validation failed: ${validation.errors.join(', ')}`
        });
        return results;
      }
      
      // Otherwise, log warning but continue with sanitized data
      console.warn(`⚠️  Proceeding with sanitized fill data`);
    }

    // Sanitize fill data
    const sanitizedFill = this.sanitizeFill(fill);

    // Store fill in history
    this.addToHistory(sanitizedFill);

    // Determine which tiers should receive this fill
    let tiers;
    
    if (originalSignalId && this.config.signalTierMap.has(originalSignalId)) {
      // Send fill to same tiers that received original signal
      tiers = this.config.signalTierMap.get(originalSignalId);
      console.log(`📋 Fill for signal ${originalSignalId} → sending to same tiers: ${tiers.join(', ')}`);
    } else {
      // Determine tiers based on fill characteristics
      tiers = this.determineTiers(sanitizedFill);
      console.log(`📋 Fill without signal mapping → determined tiers: ${tiers.join(', ')}`);
    }

    // Broadcast to all tiers in parallel for better performance
    const broadcastPromises = tiers.map(async (tier) => {
      try {
        // Get channel ID (fills channel or fallback to signal channel)
        let channelId = this.config[`${tier}FillsChannelId`];
        
        if (!channelId && this.config.fallbackToSignalChannels) {
          channelId = this.config[`${tier}SignalChannelId`];
        }
        
        if (!channelId) {
          console.warn(`⚠️  No fills channel configured for ${tier} tier`);
          return { tier, skipped: true };
        }

        const channel = await this.client.channels.fetch(channelId);
        
        if (!channel) {
          console.warn(`⚠️  Channel not found for ${tier} tier: ${channelId}`);
          return { tier, skipped: true };
        }

        // Create tier-specific embed
        const embed = this.createFillEmbed(sanitizedFill, tier);
        
        // Send message
        const message = await channel.send({ embeds: [embed] });
        
        console.log(`✅ Fill notification sent to ${tier.toUpperCase()} channel`);
        
        return {
          tier,
          success: true,
          messageId: message.id,
          channelId: channel.id
        };
        
      } catch (error) {
        console.error(`❌ Error sending fill to ${tier}:`, error.message);
        return {
          tier,
          success: false,
          error: error.message
        };
      }
    });

    // Wait for all broadcasts to complete in parallel
    const broadcastResults = await Promise.all(broadcastPromises);
    
    // Process results
    for (const result of broadcastResults) {
      if (result.skipped) {
        continue; // Skip channels that weren't configured
      }
      
      if (result.success) {
        results[result.tier] = {
          success: true,
          messageId: result.messageId,
          channelId: result.channelId
        };
      } else {
        results.errors.push({
          tier: result.tier,
          error: result.error
        });
      }
    }

    return results;
  }

  /**
   * Determine which tiers should receive this fill
   * @param {Object} fill - Fill data
   * @returns {Array} Array of tier names
   */
  determineTiers(fill) {
    if (!this.config.enableTierFiltering) {
      return ['vip', 'premium', 'basic'];
    }

    const tiers = ['vip']; // VIP always gets all fills

    // Premium gets fills for major symbols
    const majorSymbols = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL'];
    if (majorSymbols.includes(fill.symbol)) {
      tiers.push('premium');
    }

    // Basic gets only the most major symbols
    const basicSymbols = ['SPY', 'QQQ', 'IWM', 'DIA'];
    if (basicSymbols.includes(fill.symbol)) {
      tiers.push('basic');
    }

    return tiers;
  }

  /**
   * Create formatted embed for fill notification
   * @param {Object} fill - Fill data
   * @param {string} tier - Tier name
   * @returns {EmbedBuilder} Discord embed
   */
  createFillEmbed(fill, tier) {
    const colors = {
      vip: 0xFFD700,      // Gold
      premium: 0xC0C0C0,  // Silver
      basic: 0xCD7F32     // Bronze
    };

    const tierEmojis = {
      vip: '👑',
      premium: '💎',
      basic: '🥉'
    };

    // Determine fill type emoji
    const fillEmoji = fill.status === 'Filled' ? '✅' : '🔄';
    const actionColor = fill.action?.includes('Buy') ? 0x00FF00 : 0xFF4444;

    const embed = new EmbedBuilder()
      .setTitle(`${tierEmojis[tier]} ${fillEmoji} ORDER FILLED`)
      .setColor(fill.status === 'Filled' ? actionColor : colors[tier])
      .setTimestamp(fill.filledAt || fill.timestamp || new Date());

    // Order ID (always show if available)
    if (fill.orderId) {
      embed.addFields({ 
        name: 'Order ID', 
        value: String(fill.orderId), 
        inline: true 
      });
    }

    // Symbol (required field)
    if (fill.symbol) {
      embed.addFields({ 
        name: 'Symbol', 
        value: fill.symbol, 
        inline: true 
      });
    } else {
      embed.addFields({ 
        name: 'Symbol', 
        value: 'Unknown', 
        inline: true 
      });
    }

    // Action (required field)
    if (fill.action) {
      const actionEmoji = fill.action.includes('Buy') ? '🟢' : '🔴';
      embed.addFields({ 
        name: 'Action', 
        value: `${actionEmoji} ${this.formatAction(fill.action)}`, 
        inline: true 
      });
    } else {
      embed.addFields({ 
        name: 'Action', 
        value: 'Unknown', 
        inline: true 
      });
    }

    // Quantity (filled / total) - handle missing values
    if (fill.filledQuantity !== undefined && fill.filledQuantity !== null) {
      const filled = parseFloat(fill.filledQuantity) || 0;
      const total = parseFloat(fill.totalQuantity || fill.filledQuantity) || filled;
      const quantityText = total > filled ? `${filled}/${total}` : filled.toString();
      
      embed.addFields({ 
        name: 'Quantity', 
        value: quantityText, 
        inline: true 
      });
    }

    // Fill Price - handle missing/zero
    if (fill.fillPrice !== undefined && fill.fillPrice !== null) {
      const price = parseFloat(fill.fillPrice);
      if (!isNaN(price) && price >= 0) {
        embed.addFields({ 
          name: 'Fill Price', 
          value: `$${price.toFixed(2)}`, 
          inline: true 
        });
      }
    } else if (fill.price !== undefined && fill.price !== null) {
      const price = parseFloat(fill.price);
      if (!isNaN(price) && price >= 0) {
        embed.addFields({ 
          name: 'Price', 
          value: `$${price.toFixed(2)}`, 
          inline: true 
        });
      }
    }

    // Instrument Type
    if (fill.instrumentType) {
      embed.addFields({ 
        name: 'Type', 
        value: fill.instrumentType, 
        inline: true 
      });
    }

    // Option details if available
    if (fill.strike !== undefined && fill.strike !== null) {
      const strike = parseFloat(fill.strike);
      if (!isNaN(strike)) {
        embed.addFields({ 
          name: 'Strike', 
          value: `$${strike}`, 
          inline: true 
        });
      }
    }

    if (fill.expiration) {
      embed.addFields({ 
        name: 'Expiration', 
        value: String(fill.expiration), 
        inline: true 
      });
    }

    if (fill.optionType) {
      embed.addFields({ 
        name: 'Option Type', 
        value: String(fill.optionType).toUpperCase(), 
        inline: true 
      });
    }

    // Total value - only if both price and quantity available
    const fillPrice = parseFloat(fill.fillPrice || fill.price || 0);
    const filledQty = parseFloat(fill.filledQuantity || 0);
    
    if (!isNaN(fillPrice) && !isNaN(filledQty) && fillPrice > 0 && filledQty > 0) {
      const totalValue = fillPrice * filledQty;
      
      // For options, multiply by 100
      const multiplier = fill.instrumentType === 'Equity Option' ? 100 : 1;
      const displayValue = totalValue * multiplier;
      
      embed.addFields({ 
        name: 'Total Value', 
        value: `$${displayValue.toFixed(2)}`, 
        inline: true 
      });
    }

    // Status
    if (fill.status) {
      const statusEmoji = {
        'Filled': '✅',
        'Partially Filled': '🔄',
        'Pending': '⏳',
        'Cancelled': '❌'
      };
      
      embed.addFields({ 
        name: 'Status', 
        value: `${statusEmoji[fill.status] || '📊'} ${fill.status}`, 
        inline: true 
      });
    }

    // Fees if available
    const fees = parseFloat(fill.fees || 0);
    const commission = parseFloat(fill.commission || 0);
    const totalFees = fees + commission;
    
    if (!isNaN(totalFees) && totalFees > 0) {
      embed.addFields({ 
        name: 'Fees', 
        value: `$${totalFees.toFixed(2)}`, 
        inline: true 
      });
    }

    // Account (last 4 digits only for privacy)
    if (fill.accountNumber) {
      const accountStr = String(fill.accountNumber);
      const maskedAccount = accountStr.length >= 4 
        ? accountStr.slice(-4) 
        : accountStr;
      embed.addFields({ 
        name: 'Account', 
        value: `****${maskedAccount}`, 
        inline: true 
      });
    }

    // Notes or execution venue
    if (fill.executionVenue || fill.exchange) {
      embed.addFields({ 
        name: 'Venue', 
        value: String(fill.executionVenue || fill.exchange), 
        inline: true 
      });
    }

    // Footer
    embed.setFooter({ 
      text: `${tier.toUpperCase()} Tier • The Pad Fill Notifications` 
    });

    return embed;
  }

  /**
   * Format action for display
   */
  formatAction(action) {
    return action
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Add fill to history
   */
  addToHistory(fill) {
    this.fillHistory.push({
      ...fill,
      recordedAt: new Date()
    });

    // Keep only recent fills
    if (this.fillHistory.length > this.maxFillHistory) {
      this.fillHistory.shift();
    }
  }

  /**
   * Get fill statistics
   */
  getStats(timeWindow = 3600000) { // Default: last hour
    const now = Date.now();
    const recentFills = this.fillHistory.filter(f => {
      const fillTime = new Date(f.filledAt || f.timestamp || f.recordedAt).getTime();
      return now - fillTime < timeWindow;
    });

    const stats = {
      totalFills: recentFills.length,
      bySymbol: {},
      byAction: {},
      totalValue: 0
    };

    recentFills.forEach(fill => {
      // By symbol
      if (!stats.bySymbol[fill.symbol]) {
        stats.bySymbol[fill.symbol] = 0;
      }
      stats.bySymbol[fill.symbol]++;

      // By action
      if (fill.action) {
        const action = fill.action.includes('Buy') ? 'Buy' : 'Sell';
        if (!stats.byAction[action]) {
          stats.byAction[action] = 0;
        }
        stats.byAction[action]++;
      }

      // Total value
      if (fill.fillPrice && fill.filledQuantity) {
        const value = parseFloat(fill.fillPrice) * parseFloat(fill.filledQuantity);
        const multiplier = fill.instrumentType === 'Equity Option' ? 100 : 1;
        stats.totalValue += value * multiplier;
      }
    });

    return stats;
  }

  /**
   * Clear fill history
   */
  clearHistory() {
    this.fillHistory = [];
    this.config.signalTierMap.clear();
  }

  /**
   * Validate fill data
   * @param {Object} fill - Fill data to validate
   * @returns {Object} Validation result
   */
  validateFill(fill) {
    const errors = [];
    let critical = false;

    // Check for null/undefined
    if (!fill || typeof fill !== 'object') {
      return {
        isValid: false,
        critical: true,
        errors: ['Fill data is null, undefined, or not an object']
      };
    }

    // Critical fields
    if (!fill.symbol || fill.symbol === '') {
      errors.push('Missing symbol');
      critical = true;
    }

    if (!fill.action || fill.action === '') {
      errors.push('Missing action');
      critical = true;
    }

    // Important but not critical fields
    if (!fill.filledQuantity && fill.filledQuantity !== 0) {
      errors.push('Missing filledQuantity');
    }

    if (!fill.fillPrice && fill.fillPrice !== 0) {
      errors.push('Missing fillPrice');
    }

    // Type validation
    if (fill.filledQuantity !== undefined && fill.filledQuantity !== null) {
      const qty = parseFloat(fill.filledQuantity);
      if (isNaN(qty)) {
        errors.push('filledQuantity is not a valid number');
      } else if (qty < 0) {
        errors.push('filledQuantity is negative');
      }
    }

    if (fill.fillPrice !== undefined && fill.fillPrice !== null) {
      const price = parseFloat(fill.fillPrice);
      if (isNaN(price)) {
        errors.push('fillPrice is not a valid number');
      } else if (price < 0) {
        errors.push('fillPrice is negative');
      }
    }

    // Date validation
    if (fill.filledAt) {
      const date = new Date(fill.filledAt);
      if (isNaN(date.getTime())) {
        errors.push('filledAt is not a valid date');
      }
    }

    return {
      isValid: errors.length === 0,
      critical,
      errors
    };
  }

  /**
   * Sanitize fill data - fix malformed data where possible
   * @param {Object} fill - Fill data to sanitize
   * @returns {Object} Sanitized fill data
   */
  sanitizeFill(fill) {
    const sanitized = { ...fill };

    // Ensure symbol is uppercase string
    if (sanitized.symbol) {
      sanitized.symbol = String(sanitized.symbol).toUpperCase().trim();
    }

    // Normalize action
    if (sanitized.action) {
      sanitized.action = this.normalizeAction(String(sanitized.action));
    }

    // Parse numbers safely
    if (sanitized.filledQuantity !== undefined && sanitized.filledQuantity !== null) {
      const qty = parseFloat(sanitized.filledQuantity);
      sanitized.filledQuantity = isNaN(qty) ? 0 : Math.abs(qty);
    }

    if (sanitized.totalQuantity !== undefined && sanitized.totalQuantity !== null) {
      const qty = parseFloat(sanitized.totalQuantity);
      sanitized.totalQuantity = isNaN(qty) ? sanitized.filledQuantity : Math.abs(qty);
    }

    if (sanitized.fillPrice !== undefined && sanitized.fillPrice !== null) {
      const price = parseFloat(sanitized.fillPrice);
      sanitized.fillPrice = isNaN(price) ? 0 : Math.abs(price);
    }

    if (sanitized.price !== undefined && sanitized.price !== null) {
      const price = parseFloat(sanitized.price);
      sanitized.price = isNaN(price) ? 0 : Math.abs(price);
    }

    // Parse fees/commission
    if (sanitized.fees !== undefined && sanitized.fees !== null) {
      const fees = parseFloat(sanitized.fees);
      sanitized.fees = isNaN(fees) ? 0 : fees;
    }

    if (sanitized.commission !== undefined && sanitized.commission !== null) {
      const commission = parseFloat(sanitized.commission);
      sanitized.commission = isNaN(commission) ? 0 : commission;
    }

    // Parse strike
    if (sanitized.strike !== undefined && sanitized.strike !== null) {
      const strike = parseFloat(sanitized.strike);
      sanitized.strike = isNaN(strike) ? null : strike;
    }

    // Ensure dates are Date objects
    if (sanitized.filledAt) {
      const date = new Date(sanitized.filledAt);
      sanitized.filledAt = isNaN(date.getTime()) ? new Date() : date;
    } else {
      sanitized.filledAt = new Date();
    }

    if (sanitized.timestamp && !(sanitized.timestamp instanceof Date)) {
      const date = new Date(sanitized.timestamp);
      sanitized.timestamp = isNaN(date.getTime()) ? new Date() : date;
    }

    // Default status if missing
    if (!sanitized.status) {
      sanitized.status = 'Filled';
    }

    // Default instrument type if missing
    if (!sanitized.instrumentType) {
      // Guess based on presence of option fields
      sanitized.instrumentType = (sanitized.strike || sanitized.optionType) 
        ? 'Equity Option' 
        : 'Equity';
    }

    // Ensure orderId exists
    if (!sanitized.orderId) {
      sanitized.orderId = `fill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // Sanitize orderId to string
    sanitized.orderId = String(sanitized.orderId);

    return sanitized;
  }

  /**
   * Normalize action strings
   * @param {string} action - Action to normalize
   * @returns {string} Normalized action
   */
  normalizeAction(action) {
    const upper = action.toUpperCase().trim();
    
    // Map common variations
    const actionMap = {
      'BUY': 'Buy to Open',
      'BTO': 'Buy to Open',
      'BUY TO OPEN': 'Buy to Open',
      'SELL': 'Sell to Open',
      'STO': 'Sell to Open',
      'SELL TO OPEN': 'Sell to Open',
      'BTC': 'Buy to Close',
      'BUY TO CLOSE': 'Buy to Close',
      'STC': 'Sell to Close',
      'SELL TO CLOSE': 'Sell to Close',
      'BOUGHT': 'Buy to Open',
      'SOLD': 'Sell to Open'
    };
    
    return actionMap[upper] || action;
  }
}

module.exports = FillBroadcaster;
