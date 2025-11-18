/**
 * Market Data Helper
 * Provides real-time quotes for better order pricing
 */
class MarketDataHelper {
  constructor(tastytradeClient) {
    this.client = tastytradeClient;
    this.quoteStreamer = null;
    this.quoteCache = new Map(); // Cache recent quotes
    this.cacheTimeout = 5000; // 5 seconds
  }

  /**
   * Connect to quote streamer
   */
  async connect() {
    if (this.quoteStreamer) {
      return;
    }

    try {
      this.quoteStreamer = this.client.client.quoteStreamer;
      
      // Add event listener
      this.quoteStreamer.addEventListener((events) => {
        this.handleQuoteEvents(events);
      });

      await this.quoteStreamer.connect();
      console.log('✅ Market data streamer connected');
    } catch (error) {
      console.warn('⚠️  Market data not available (may be sandbox limitation):', error.message);
      // Continue without market data
    }
  }

  /**
   * Handle quote events
   */
  handleQuoteEvents(events) {
    events.forEach(event => {
      if (event.symbol) {
        this.quoteCache.set(event.symbol, {
          ...event,
          timestamp: Date.now()
        });
      }
    });
  }

  /**
   * Get current quote for symbol
   */
  getQuote(symbol) {
    const cached = this.quoteCache.get(symbol);
    
    // Check if cache is still valid
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached;
    }
    
    return null;
  }

  /**
   * Subscribe to symbol for real-time quotes
   */
  async subscribe(symbols) {
    if (!this.quoteStreamer) {
      await this.connect();
    }

    if (this.quoteStreamer) {
      this.quoteStreamer.subscribe(Array.isArray(symbols) ? symbols : [symbols]);
    }
  }

  /**
   * Get intelligent pricing for limit orders
   * Uses mid-price for better fills
   */
  getIntelligentPrice(symbol, side = 'buy') {
    const quote = this.getQuote(symbol);
    
    if (!quote) {
      return null; // No quote available
    }

    // Extract bid/ask prices
    const bid = parseFloat(quote.bid || quote.bidPrice || 0);
    const ask = parseFloat(quote.ask || quote.askPrice || 0);
    
    if (bid === 0 || ask === 0) {
      return null;
    }

    const midPrice = (bid + ask) / 2;
    const spread = ask - bid;

    // For buys: use mid-price or slightly above for better fills
    // For sells: use mid-price or slightly below for better fills
    if (side === 'buy') {
      // Slightly above mid for better chance of fill
      return midPrice + (spread * 0.1);
    } else {
      // Slightly below mid for better chance of fill
      return midPrice - (spread * 0.1);
    }
  }

  /**
   * Enhance order with intelligent pricing
   */
  async enhanceOrderWithPricing(orderData) {
    const symbol = orderData['underlying-symbol'] || orderData.symbol;
    
    if (!symbol) {
      return orderData; // No symbol, can't enhance
    }

    // Subscribe to symbol for real-time data
    await this.subscribe(symbol);

    // Wait a bit for quote to arrive
    await new Promise(resolve => setTimeout(resolve, 100));

    // If limit order without price, add intelligent pricing
    if (orderData['order-type'] === 'Limit' && !orderData.price) {
      const legs = orderData.legs || [];
      
      if (legs.length > 0) {
        // Determine side from first leg
        const firstLeg = legs[0];
        const side = firstLeg.action && firstLeg.action.includes('Buy') ? 'buy' : 'sell';
        
        const intelligentPrice = this.getIntelligentPrice(symbol, side);
        
        if (intelligentPrice) {
          orderData.price = intelligentPrice.toFixed(2);
          console.log(`💡 Using intelligent pricing: $${orderData.price} for ${symbol}`);
        }
      }
    }

    return orderData;
  }

  /**
   * Disconnect
   */
  async disconnect() {
    if (this.quoteStreamer) {
      try {
        await this.quoteStreamer.disconnect();
        this.quoteStreamer = null;
      } catch (error) {
        console.error('Error disconnecting market data:', error);
      }
    }
  }
}

module.exports = MarketDataHelper;


