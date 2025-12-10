require('dotenv').config();
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
      // Parse message to extract fill information
      const fillData = this.extractFillData(message);
      
      if (fillData) {
        // Track latency
        this.latencyMonitor.trackSignal(fillData, 'manual');
        
        // Broadcast to Discord
        this.broadcastToDiscord(fillData);
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
    // This will need to be adjusted based on actual message format
    if (message.data && message.data.order) {
      const order = message.data.order;
      
      // Check if order was filled
      if (order.status === 'Filled' || order.status === 'Partially Filled') {
        return {
          type: 'fill',
          timestamp: new Date().toISOString(),
          orderId: order.id || order['order-id'],
          symbol: order['underlying-symbol'] || order.symbol,
          quantity: order.size,
          price: order.price,
          status: order.status,
          legs: order.legs || []
        };
      }
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
   */
  async broadcastToDiscord(signal) {
    if (!this.discordClient) {
      console.log('Discord client not available');
      return;
    }

    try {
      // Find trading channel
      const channel = this.discordClient.channels.cache.find(
        ch => ch.name === 'trading-signals' || ch.name === 'trading'
      );

      if (!channel) {
        console.warn('Trading channel not found');
        return;
      }

      // Format message based on signal type
      const message = this.formatSignalMessage(signal);
      
      // Send to Discord
      await channel.send(message);
      
      console.log('✅ Signal broadcasted to Discord');
    } catch (error) {
      console.error('Error broadcasting to Discord:', error);
    }
  }

  /**
   * Format signal message for Discord
   */
  formatSignalMessage(signal) {
    if (signal.type === 'fill') {
      return `🎯 **Fill Notification**\n` +
             `Symbol: ${signal.symbol}\n` +
             `Quantity: ${signal.quantity}\n` +
             `Price: $${signal.price}\n` +
             `Status: ${signal.status}\n` +
             `Time: ${new Date(signal.timestamp).toLocaleString()}`;
    } else if (signal.type === 'order_complete') {
      return `✅ **Order Completed**\n` +
             `Order ID: ${signal.orderId}\n` +
             `Symbol: ${signal.orderData['underlying-symbol'] || 'N/A'}\n` +
             `Time: ${new Date(signal.timestamp).toLocaleString()}`;
    }
    
    return `📊 Signal: ${JSON.stringify(signal, null, 2)}`;
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

