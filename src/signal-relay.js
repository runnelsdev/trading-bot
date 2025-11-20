const { EmbedBuilder } = require('discord.js');

/**
 * Signal Relay
 * Distributes trading signals to tiered subscriber channels
 */
class SignalRelay {
  constructor(discordClient, config = {}) {
    this.client = discordClient;
    this.config = {
      // Channel IDs for different tiers
      vipChannelId: config.vipChannelId || process.env.VIP_CHANNEL_ID,
      premiumChannelId: config.premiumChannelId || process.env.PREMIUM_CHANNEL_ID,
      basicChannelId: config.basicChannelId || process.env.BASIC_CHANNEL_ID,
      
      // Filtering rules
      enableTierFiltering: config.enableTierFiltering !== false,
      
      // VIP gets all signals
      vipFilter: config.vipFilter || (() => true),
      
      // Premium gets high/medium confidence
      premiumFilter: config.premiumFilter || ((signal) => {
        return signal.confidence === 'HIGH' || signal.confidence === 'MEDIUM';
      }),
      
      // Basic gets only high confidence major symbols
      basicFilter: config.basicFilter || ((signal) => {
        const majorSymbols = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'TSLA', 'NVDA'];
        return signal.confidence === 'HIGH' && majorSymbols.includes(signal.symbol);
      })
    };
  }

  /**
   * Distribute signal to appropriate tier channels
   * @param {Object} signal - Parsed trading signal
   * @returns {Object} Distribution results
   */
  async distribute(signal) {
    const results = {
      vip: null,
      premium: null,
      basic: null,
      errors: []
    };

    // Determine which tiers should receive this signal
    const tiers = this.determineTiers(signal);
    
    console.log(`📡 Distributing signal to tiers: ${tiers.join(', ')}`);

    // Send to each tier
    for (const tier of tiers) {
      try {
        const channelId = this.config[`${tier}ChannelId`];
        
        if (!channelId) {
          console.warn(`⚠️  No channel ID configured for ${tier} tier`);
          continue;
        }

        const channel = await this.client.channels.fetch(channelId);
        
        if (!channel) {
          console.warn(`⚠️  Channel not found for ${tier} tier: ${channelId}`);
          continue;
        }

        // Create tier-specific embed
        const embed = this.createEmbed(signal, tier);
        
        // Send message
        const message = await channel.send({ embeds: [embed] });
        
        results[tier] = {
          success: true,
          messageId: message.id,
          channelId: channel.id
        };
        
        console.log(`✅ Signal sent to ${tier.toUpperCase()} channel`);
        
      } catch (error) {
        console.error(`❌ Error sending to ${tier}:`, error.message);
        results.errors.push({
          tier,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Determine which tiers should receive this signal
   * @param {Object} signal - Trading signal
   * @returns {Array} Array of tier names
   */
  determineTiers(signal) {
    if (!this.config.enableTierFiltering) {
      // If filtering disabled, send to all tiers
      return ['vip', 'premium', 'basic'];
    }

    const tiers = [];

    // VIP always gets all signals
    if (this.config.vipFilter(signal)) {
      tiers.push('vip');
    }

    // Premium gets filtered signals
    if (this.config.premiumFilter(signal)) {
      tiers.push('premium');
    }

    // Basic gets most filtered signals
    if (this.config.basicFilter(signal)) {
      tiers.push('basic');
    }

    return tiers;
  }

  /**
   * Create formatted embed for signal
   * @param {Object} signal - Trading signal
   * @param {string} tier - Tier name (vip, premium, basic)
   * @returns {EmbedBuilder} Discord embed
   */
  createEmbed(signal, tier) {
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

    const embed = new EmbedBuilder()
      .setTitle(`${tierEmojis[tier]} ${tier.toUpperCase()} TRADE SIGNAL`)
      .setColor(colors[tier])
      .setTimestamp(signal.timestamp || new Date());

    // Add basic fields
    if (signal.symbol) {
      embed.addFields({ name: 'Symbol', value: signal.symbol, inline: true });
    }
    
    if (signal.action) {
      embed.addFields({ 
        name: 'Action', 
        value: this.formatAction(signal.action), 
        inline: true 
      });
    }
    
    if (signal.quantity) {
      embed.addFields({ name: 'Quantity', value: signal.quantity.toString(), inline: true });
    }

    // Add order type
    if (signal.orderType) {
      embed.addFields({ name: 'Order Type', value: signal.orderType, inline: true });
    }

    // Add option details if available
    if (signal.contractType) {
      embed.addFields({ name: 'Contract', value: signal.contractType, inline: true });
    }
    
    if (signal.strike) {
      embed.addFields({ name: 'Strike', value: `$${signal.strike}`, inline: true });
    }
    
    if (signal.expiration) {
      embed.addFields({ name: 'Expiration', value: signal.expiration, inline: true });
    }

    // Add pricing info
    if (signal.entryPrice || signal.price) {
      const price = signal.entryPrice || signal.price;
      embed.addFields({ 
        name: 'Entry Price', 
        value: `$${parseFloat(price).toFixed(2)}`, 
        inline: true 
      });
    }

    if (signal.stopLoss) {
      embed.addFields({ 
        name: 'Stop Loss', 
        value: `$${parseFloat(signal.stopLoss).toFixed(2)}`, 
        inline: true 
      });
    }

    if (signal.target || signal.takeProfit) {
      const target = signal.target || signal.takeProfit;
      embed.addFields({ 
        name: 'Target', 
        value: `$${parseFloat(target).toFixed(2)}`, 
        inline: true 
      });
    }

    // Calculate and add risk/reward if available
    if (signal.entryPrice && signal.stopLoss && (signal.target || signal.takeProfit)) {
      const entry = parseFloat(signal.entryPrice);
      const stop = parseFloat(signal.stopLoss);
      const target = parseFloat(signal.target || signal.takeProfit);
      
      const risk = Math.abs(entry - stop);
      const reward = Math.abs(target - entry);
      
      if (risk > 0) {
        const ratio = (reward / risk).toFixed(2);
        embed.addFields({ 
          name: 'Risk/Reward', 
          value: `1:${ratio}`, 
          inline: true 
        });
      }
    }

    // Add strategy/notes if available
    if (signal.strategy || signal.notes) {
      embed.addFields({ 
        name: 'Strategy', 
        value: signal.strategy || signal.notes, 
        inline: false 
      });
    }

    // Add confidence level
    if (signal.confidence) {
      const confidenceEmoji = {
        HIGH: '🟢',
        MEDIUM: '🟡',
        LOW: '🔴'
      };
      embed.addFields({ 
        name: 'Confidence', 
        value: `${confidenceEmoji[signal.confidence] || ''} ${signal.confidence}`, 
        inline: true 
      });
    }

    // Add footer
    embed.setFooter({ 
      text: `${tier.toUpperCase()} Tier • The Pad Trading Signals` 
    });

    return embed;
  }

  /**
   * Format action for display
   * @param {string} action - Action string
   * @returns {string} Formatted action
   */
  formatAction(action) {
    return action
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Update tier filters dynamically
   * @param {Object} filters - New filter functions
   */
  updateFilters(filters) {
    if (filters.vipFilter) this.config.vipFilter = filters.vipFilter;
    if (filters.premiumFilter) this.config.premiumFilter = filters.premiumFilter;
    if (filters.basicFilter) this.config.basicFilter = filters.basicFilter;
    
    console.log('✅ Tier filters updated');
  }

  /**
   * Get distribution statistics
   * @returns {Object} Stats object
   */
  getStats() {
    return {
      vipChannelId: this.config.vipChannelId,
      premiumChannelId: this.config.premiumChannelId,
      basicChannelId: this.config.basicChannelId,
      filteringEnabled: this.config.enableTierFiltering
    };
  }
}

module.exports = SignalRelay;
