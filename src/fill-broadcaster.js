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
      errors: []
    };

    // Store fill in history
    this.addToHistory(fill);

    // Determine which tiers should receive this fill
    let tiers;
    
    if (originalSignalId && this.config.signalTierMap.has(originalSignalId)) {
      // Send fill to same tiers that received original signal
      tiers = this.config.signalTierMap.get(originalSignalId);
      console.log(`📋 Fill for signal ${originalSignalId} → sending to same tiers: ${tiers.join(', ')}`);
    } else {
      // Determine tiers based on fill characteristics
      tiers = this.determineTiers(fill);
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
        const embed = this.createFillEmbed(fill, tier);
        
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

    // Order ID
    if (fill.orderId) {
      embed.addFields({ 
        name: 'Order ID', 
        value: fill.orderId.toString(), 
        inline: true 
      });
    }

    // Symbol
    if (fill.symbol) {
      embed.addFields({ 
        name: 'Symbol', 
        value: fill.symbol, 
        inline: true 
      });
    }

    // Action
    if (fill.action) {
      const actionEmoji = fill.action.includes('Buy') ? '🟢' : '🔴';
      embed.addFields({ 
        name: 'Action', 
        value: `${actionEmoji} ${this.formatAction(fill.action)}`, 
        inline: true 
      });
    }

    // Quantity (filled / total)
    if (fill.filledQuantity || fill.quantity) {
      const filled = fill.filledQuantity || fill.quantity;
      const total = fill.totalQuantity || fill.quantity;
      const quantityText = total > filled ? `${filled}/${total}` : filled.toString();
      
      embed.addFields({ 
        name: 'Quantity', 
        value: quantityText, 
        inline: true 
      });
    }

    // Fill Price
    if (fill.fillPrice || fill.price) {
      const price = fill.fillPrice || fill.price;
      embed.addFields({ 
        name: 'Fill Price', 
        value: `$${parseFloat(price).toFixed(2)}`, 
        inline: true 
      });
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
    if (fill.strike) {
      embed.addFields({ 
        name: 'Strike', 
        value: `$${fill.strike}`, 
        inline: true 
      });
    }

    if (fill.expiration) {
      embed.addFields({ 
        name: 'Expiration', 
        value: fill.expiration, 
        inline: true 
      });
    }

    if (fill.optionType) {
      embed.addFields({ 
        name: 'Option Type', 
        value: fill.optionType, 
        inline: true 
      });
    }

    // Total value
    if (fill.fillPrice && fill.filledQuantity) {
      const totalValue = parseFloat(fill.fillPrice) * parseFloat(fill.filledQuantity);
      
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
    if (fill.fees || fill.commission) {
      const totalFees = (parseFloat(fill.fees || 0) + parseFloat(fill.commission || 0)).toFixed(2);
      if (parseFloat(totalFees) > 0) {
        embed.addFields({ 
          name: 'Fees', 
          value: `$${totalFees}`, 
          inline: true 
        });
      }
    }

    // Account (last 4 digits only for privacy)
    if (fill.accountNumber) {
      const maskedAccount = fill.accountNumber.slice(-4);
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
        value: fill.executionVenue || fill.exchange, 
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
}

module.exports = FillBroadcaster;
