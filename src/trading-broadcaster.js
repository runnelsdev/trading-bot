require('dotenv').config();
const { EmbedBuilder } = require('discord.js');
const TastytradeIntegration = require('./tastytrade-client');
const OrderQueueManager = require('./order-queue');
const LatencyMonitor = require('./latency-monitor');
const MarketDataHelper = require('./market-data-helper');
const queueConfig = require('../config/queue-config');

/**
 * Trading Broadcaster
 * Integrates Tastytrade, order queue, and Discord broadcasting
 */
class TradingBroadcaster {
  constructor(discordClient, accountNumber, configProfile = 'balanced') {
    this.discordClient = discordClient;
    this.accountNumber = accountNumber;
    
    // Initialize Tastytrade client
    this.tastytrade = new TastytradeIntegration();
    
    // Initialize order queue with selected config
    const config = queueConfig[configProfile] || queueConfig.balanced;
    this.queueManager = new OrderQueueManager(this.tastytrade, accountNumber, config);
    
    // Initialize latency monitor
    this.latencyMonitor = new LatencyMonitor();
    
    // Initialize market data helper
    this.marketDataHelper = new MarketDataHelper(this.tastytrade);
    
    // Setup event handlers
    this.setupEventHandlers();
    
    // Account streamer for fill notifications
    this.accountStreamer = null;
    this.streamerConnected = false;
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Order completion handler
    this.queueManager.onOrderComplete = (item, result) => {
      this.handleOrderComplete(item, result);
    };

    // Order error handler
    this.queueManager.onOrderError = (item, error) => {
      this.handleOrderError(item, error);
    };

    // Queue update handler
    this.queueManager.onQueueUpdate = (status) => {
      this.handleQueueUpdate(status);
    };
  }

  /**
   * Initialize and authenticate
   */
  async initialize() {
    await this.tastytrade.authenticate();
    
    // Connect to market data if available
    await this.connectMarketData();
    
    console.log('✅ Trading Broadcaster initialized');
  }

  /**
   * Connect to account streamer for real-time fill notifications
   */
  async connectAccountStreamer() {
    if (this.streamerConnected) {
      return;
    }

    try {
      this.accountStreamer = this.tastytrade.client.accountStreamer;
      
      if (!this.accountStreamer) {
        console.log('⚠️  Account streamer not available on client');
        return;
      }
      
      // Add message observer
      this.accountStreamer.addMessageObserver((message) => {
        this.handleStreamerMessage(message);
      });

      // Start streamer
      await this.accountStreamer.start();
      
      // Subscribe to account
      await this.accountStreamer.subscribeToAccounts([this.accountNumber]);
      
      this.streamerConnected = true;
      console.log('✅ Account streamer connected');
    } catch (error) {
      console.error('❌ Failed to connect account streamer:', error.message);
      // Stop the streamer if it started to prevent heartbeat errors
      if (this.accountStreamer) {
        try {
          await this.accountStreamer.stop();
        } catch (stopError) {
          // Ignore stop errors
        }
        this.accountStreamer = null;
      }
      // Continue without streamer - can still use queue
    }
  }

  /**
   * NEW: Connect to market data streamer
   */
  async connectMarketData() {
    try {
      await this.marketDataHelper.connect();
      console.log('✅ Market data connected');
    } catch (error) {
      console.warn('⚠️  Market data not available:', error.message);
    }
  }

  /**
   * Handle account streamer messages (fill notifications)
   */
  handleStreamerMessage(message) {
    try {
      // DEBUG: Log all incoming messages
      console.log('\n📨 Account Streamer Message Received:');
      console.log(JSON.stringify(message, null, 2));
      
      // Parse message to extract fill information
      const fillData = this.extractFillData(message);
      
      if (fillData) {
        console.log('✅ Fill data extracted:', fillData);
        // Track latency
        this.latencyMonitor.trackSignal(fillData, 'manual');
        
        // Broadcast to Discord
        this.broadcastToDiscord(fillData);
      } else {
        console.log('ℹ️  Message was not a fill notification');
      }
    } catch (error) {
      console.error('Error handling streamer message:', error);
    }
  }

  /**
   * Extract fill data from streamer message
   */
  extractFillData(message) {
    // Parse Tastytrade streamer message format
    // Handle multiple possible message structures
    
    // Structure 1: message.data.order
    if (message.data && message.data.order) {
      const order = message.data.order;
      
      // Check if order was filled
      if (order.status === 'Filled' || order.status === 'Partially Filled') {
        return {
          type: 'fill',
          timestamp: new Date().toISOString(),
          orderId: order.id || order['order-id'],
          symbol: order['underlying-symbol'] || order.symbol,
          quantity: order.size || order.quantity || order['filled-quantity'],
          price: order.price || order['avg-fill-price'],
          status: order.status,
          legs: order.legs || []
        };
      }
    }
    
    // Structure 2: Direct order object
    if (message.order) {
      const order = message.order;
      if (order.status === 'Filled' || order.status === 'Partially Filled') {
        return {
          type: 'fill',
          timestamp: new Date().toISOString(),
          orderId: order.id || order['order-id'],
          symbol: order['underlying-symbol'] || order.symbol,
          quantity: order.size || order.quantity || order['filled-quantity'],
          price: order.price || order['avg-fill-price'],
          status: order.status,
          legs: order.legs || []
        };
      }
    }
    
    // Structure 3: Message type-based (common in websocket APIs)
    if (message.type === 'Order' || message.type === 'order') {
      const order = message.data || message;
      const status = order.status || order['order-status'];
      if (status === 'Filled' || status === 'Partially Filled') {
        return {
          type: 'fill',
          timestamp: new Date().toISOString(),
          orderId: order.id || order['order-id'],
          symbol: order['underlying-symbol'] || order.symbol,
          quantity: order.size || order.quantity || order['filled-quantity'],
          price: order.price || order['avg-fill-price'],
          status: status,
          legs: order.legs || []
        };
      }
    }
    
    // Structure 4: Account notification format
    if (message.action === 'order-updated' || message.action === 'order-filled') {
      const order = message.value || message.data || message;
      return {
        type: 'fill',
        timestamp: new Date().toISOString(),
        orderId: order.id || order['order-id'],
        symbol: order['underlying-symbol'] || order.symbol,
        quantity: order.size || order.quantity || order['filled-quantity'],
        price: order.price || order['avg-fill-price'],
        status: order.status || 'Filled',
        legs: order.legs || []
      };
    }
    
    return null;
  }

  /**
   * Queue an order
   * NEW: Automatically enhances with market data pricing if available
   */
  async queueOrder(orderData, options = {}) {
    // Enhance order with intelligent pricing if market data available
    try {
      const enhancedOrder = await this.marketDataHelper.enhanceOrderWithPricing(orderData);
      return await this.queueManager.queueOrder(enhancedOrder, options);
    } catch (error) {
      // If market data fails, continue without it
      console.warn('Market data enhancement failed, using original order:', error.message);
      return await this.queueManager.queueOrder(orderData, options);
    }
  }

  /**
   * Handle order completion
   */
  async handleOrderComplete(item, result) {
    // Track latency
    this.latencyMonitor.trackOrder(item);
    
    // Create signal
    const signal = {
      type: 'order_complete',
      timestamp: item.completedAt.toISOString(),
      orderId: item.id,
      orderData: item.orderData,
      result: result
    };
    
    // Broadcast to Discord
    await this.broadcastToDiscord(signal);
  }

  /**
   * Handle order error
   */
  async handleOrderError(item, error) {
    console.error(`Order ${item.id} failed:`, error.message);
    
    // Optionally broadcast errors to Discord
    if (this.discordClient) {
      const channel = this.discordClient.channels.cache.find(
        ch => ch.name === 'trading-alerts' || ch.name === 'trading-errors'
      );
      
      if (channel) {
        await channel.send(`❌ Order failed: ${error.message}\nOrder ID: ${item.id}`);
      }
    }
  }

  /**
   * Handle queue update
   */
  handleQueueUpdate(status) {
    // Optionally log or broadcast queue status
    if (status.queueLength > 10) {
      console.log(`⚠️  Queue length: ${status.queueLength}`);
    }
  }

  /**
   * Broadcast signal to Discord
   * Fill notifications are sent as embeds (parseable by subscriber bots)
   * Other signals are sent as plain text
   */
  async broadcastToDiscord(signal) {
    if (!this.discordClient) {
      console.log('Discord client not available');
      return;
    }

    try {
      // Get channel IDs from environment
      const channelIds = [
        process.env.VIP_CHANNEL_ID,
        process.env.PREMIUM_CHANNEL_ID,
        process.env.BASIC_CHANNEL_ID
      ].filter(Boolean);

      // Prepare message content based on signal type
      let messagePayload;
      if (signal.type === 'fill') {
        // Send fills as embeds so subscriber bots can parse them
        const embed = this.createFillEmbed(signal);
        messagePayload = { embeds: [embed] };
        console.log(`📤 Preparing fill embed for ${signal.symbol} x${signal.quantity}`);
      } else {
        // Other signals as plain text
        messagePayload = this.formatSignalMessage(signal);
      }

      if (channelIds.length === 0) {
        // Fallback to finding channel by name
        const channel = this.discordClient.channels.cache.find(
          ch => ch.name === 'trading-signals' || ch.name === 'trading'
        );

        if (!channel) {
          console.warn('Trading channel not found - set VIP_CHANNEL_ID, PREMIUM_CHANNEL_ID, or BASIC_CHANNEL_ID in .env');
          return;
        }

        await channel.send(messagePayload);
        console.log('✅ Signal broadcasted to Discord (fallback channel)');
        return;
      }

      // Send to all configured channels
      for (const channelId of channelIds) {
        try {
          const channel = await this.discordClient.channels.fetch(channelId);
          if (channel) {
            await channel.send(messagePayload);
            console.log(`✅ Signal broadcasted to channel ${channel.name || channelId}`);
          }
        } catch (channelError) {
          console.error(`Failed to send to channel ${channelId}:`, channelError.message);
        }
      }
    } catch (error) {
      console.error('Error broadcasting to Discord:', error);
    }
  }

  /**
   * Format signal message for Discord (fallback for non-fill signals)
   */
  formatSignalMessage(signal) {
    if (signal.type === 'order_complete') {
      return `✅ **Order Completed**\n` +
             `Order ID: ${signal.orderId}\n` +
             `Symbol: ${signal.orderData['underlying-symbol'] || 'N/A'}\n` +
             `Time: ${new Date(signal.timestamp).toLocaleString()}`;
    }

    return `📊 Signal: ${JSON.stringify(signal, null, 2)}`;
  }

  /**
   * Create Discord embed for fill notifications
   * This format is parseable by subscriber bots' DiscordListener
   */
  createFillEmbed(signal) {
    // Determine action based on legs or default to Buy
    let action = 'Buy to Open';
    if (signal.legs && signal.legs.length > 0) {
      const leg = signal.legs[0];
      action = leg.action || leg['action-type'] || 'Buy to Open';
    }

    // Determine color based on action
    const isBuy = action.toLowerCase().includes('buy');
    const color = isBuy ? 0x00FF00 : 0xFF4444; // Green for buy, red for sell

    const embed = new EmbedBuilder()
      .setTitle('🎯 Fill Notification')
      .setColor(color)
      .setTimestamp(new Date(signal.timestamp));

    // Add fields that DiscordListener expects
    embed.addFields(
      { name: 'Symbol', value: signal.symbol || 'Unknown', inline: true },
      { name: 'Action', value: action, inline: true },
      { name: 'Quantity', value: String(signal.quantity || 1), inline: true }
    );

    // Add price if available
    if (signal.price) {
      embed.addFields({ name: 'Price', value: `$${signal.price}`, inline: true });
    }

    // Add status
    embed.addFields({ name: 'Status', value: signal.status || 'Filled', inline: true });

    // Add order ID in footer (DiscordListener can extract from here)
    if (signal.orderId) {
      embed.setFooter({ text: `Order ID: ${signal.orderId}` });
    }

    return embed;
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return this.queueManager.getStatus();
  }

  /**
   * Get latency statistics
   */
  getLatencyStats(timeWindow = 3600000) {
    return this.latencyMonitor.getStats(timeWindow);
  }

  /**
   * Print latency statistics
   */
  printLatencyStats(timeWindow = 3600000) {
    this.latencyMonitor.printStats(timeWindow);
  }
}

module.exports = TradingBroadcaster;

