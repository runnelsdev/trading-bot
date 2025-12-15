const { Client, GatewayIntentBits } = require('discord.js');

/**
 * Discord Listener
 * Listens to Discord channel for trading signals
 * 
 * Enhanced features:
 * - Duplicate signal detection
 * - Symbol filtering
 * - Max quantity cap
 * - Message reactions on trade execution
 */
class DiscordListener {
  constructor(config, executor) {
    this.config = config;
    this.executor = executor;
    
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
    
    this.isRunning = false;
    this.channel = null;
    
    // Duplicate detection - track processed signals
    this.processedSignals = new Set();
    
    // Parse symbol filter from env (comma-separated list)
    this.enabledSymbols = process.env.ENABLED_SYMBOLS
      ? process.env.ENABLED_SYMBOLS.split(',').map(s => s.trim().toUpperCase())
      : null; // null = all symbols allowed
    
    // Max quantity cap (safety limit)
    this.maxQuantity = parseInt(process.env.MAX_QUANTITY) || 100;
    
    if (this.enabledSymbols) {
      console.log(`🎯 Symbol filter enabled: ${this.enabledSymbols.join(', ')}`);
    }
    console.log(`📊 Max quantity cap: ${this.maxQuantity}`);
  }

  /**
   * Start listening to Discord
   */
  async start() {
    console.log('🔌 Connecting to Discord...');
    
    // Set up error handlers before login
    this.client.on('error', (error) => {
      console.error('❌ Discord client error:', error.message);
    });
    
    this.client.on('warn', (warning) => {
      console.warn('⚠️  Discord warning:', warning);
    });
    
    // Wait for ready with timeout
    const readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Discord connection timeout after 15 seconds. Check your token and network connection.'));
      }, 15000); // 15 second timeout
      
      // Use clientReady for Discord.js v14+ (ready is deprecated)
      this.client.once('clientReady', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      // Fallback for older versions
      this.client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      this.client.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    
    try {
      // Login
      await this.client.login(this.config.discordBotToken);
      console.log('⏳ Waiting for Discord ready event...');
      
      // Wait for ready event
      await readyPromise;
      
      console.log(`✅ Discord connected as ${this.client.user.tag}`);
      
      // Get channel
      this.channel = this.client.channels.cache.get(this.config.channelId);
      
      if (!this.channel) {
        console.error(`❌ Channel ${this.config.channelId} not found`);
        console.error(`💡 Available channels in server:`);
        this.client.guilds.cache.forEach(guild => {
          guild.channels.cache.forEach(channel => {
            if (channel.type === 0) { // Text channel
              console.error(`   - #${channel.name} (${channel.id})`);
            }
          });
        });
        throw new Error(`Channel ${this.config.channelId} not found. Check your channel ID in config.`);
      }
      
      console.log(`📡 Listening to channel: #${this.channel.name}`);
      this.isRunning = true;
      
    } catch (error) {
      console.error('❌ Failed to connect to Discord:', error.message);
      if (error.message.includes('Invalid token')) {
        console.error('💡 Check that DISCORD_BOT_TOKEN in .env is correct');
      } else if (error.message.includes('timeout')) {
        console.error('💡 Discord connection timed out. Check:');
        console.error('   1. Your internet connection');
        console.error('   2. Discord service status');
        console.error('   3. Bot token is valid');
      }
      throw error;
    }
    
    // Listen for messages
    this.client.on('messageCreate', async (message) => {
      await this.handleMessage(message);
    });
  }

  /**
   * Handle incoming messages
   */
  async handleMessage(message) {
    // Only process messages from subscribed channel
    if (message.channel.id !== this.config.channelId) return;
    
    // Log all messages for monitoring
    const timestamp = new Date().toISOString();
    const author = message.author.tag;
    const content = message.content || '[No text content]';
    const hasEmbeds = message.embeds.length > 0;
    const isBot = message.author.bot;
    
    console.log(`📨 [${timestamp}] ${author}${isBot ? ' (BOT)' : ''} in #${message.channel.name}:`);
    if (content && content !== '[No text content]') {
      console.log(`   ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`);
    }
    if (hasEmbeds) {
      console.log(`   📎 ${message.embeds.length} embed(s) attached`);
      // Log embed title for debugging
      message.embeds.forEach((embed, i) => {
        console.log(`   📋 Embed ${i + 1} title: ${embed.title || '[no title]'}`);
      });
    }
    
    // Check for signal/fill in embeds (process from bots too - fill notifications)
    if (message.embeds.length > 0) {
      const signal = this.parseSignalFromEmbed(message.embeds[0]);
      if (signal) {
        console.log(`🎯 Parsed signal from embed: ${JSON.stringify(signal)}`);
        await this.processSignal(signal, message);
        return;
      }
    }
    
    // For text-based signals, ignore bot messages (prevent loops)
    if (message.author.bot) return;
    
    // Check for signal in message content (alternative format)
    const signal = this.parseSignalFromText(message.content);
    if (signal) {
      await this.processSignal(signal, message);
    }
  }

  /**
   * Process a detected signal with all filters and safety checks
   */
  async processSignal(signal, message) {
    // Generate unique key for duplicate detection
    const signalKey = `${signal.symbol}_${signal.action}_${signal.id}`;
    
    // Check for duplicate
    if (this.processedSignals.has(signalKey)) {
      console.log(`⏭️  Skipping duplicate signal: ${signalKey}`);
      return;
    }
    
    // Check symbol filter
    if (this.enabledSymbols && !this.enabledSymbols.includes(signal.symbol)) {
      console.log(`⏭️  Symbol ${signal.symbol} not in enabled list, skipping`);
      return;
    }
    
    // Apply max quantity cap
    const originalQuantity = signal.quantity;
    signal.quantity = Math.min(signal.quantity, this.maxQuantity);
    if (signal.quantity !== originalQuantity) {
      console.log(`📊 Quantity capped: ${originalQuantity} → ${signal.quantity} (max: ${this.maxQuantity})`);
    }
    
    console.log(`🎯 Signal detected: ${signal.action} ${signal.quantity} ${signal.symbol}`);
    
    // Execute the trade
    const result = await this.executor.executeTrade(signal);
    
    if (result.success) {
      // Mark as processed
      this.processedSignals.add(signalKey);
      
      // Clean up old processed signals (keep last 500)
      if (this.processedSignals.size > 500) {
        const iterator = this.processedSignals.values();
        this.processedSignals.delete(iterator.next().value);
      }
      
      // React to message to show we processed it
      try {
        await message.react('✅');
      } catch (e) {
        // Ignore reaction errors (may not have permission)
      }
      
      console.log(`✅ Signal processed and marked: ${signalKey}`);
    } else {
      // React with warning if trade failed
      try {
        await message.react('⚠️');
      } catch (e) {
        // Ignore reaction errors
      }
    }
  }

  /**
   * Parse signal from Discord embed
   */
  parseSignalFromEmbed(embed) {
    // Check if it's a signal or fill notification
    const title = embed.title || '';
    const description = embed.description || '';
    const upperTitle = title.toUpperCase();
    
    const isSignal = upperTitle.includes('SIGNAL') || description.toUpperCase().includes('SIGNAL');
    const isFill = upperTitle.includes('FILL') || upperTitle.includes('ORDER');
    
    if (!isSignal && !isFill) {
      return null;
    }
    
    const fields = {};
    embed.fields?.forEach(field => {
      const key = field.name.toLowerCase().replace(/\s+/g, '');
      fields[key] = field.value;
    });
    
    // Extract signal data - handle both signal and fill formats
    const symbol = fields.symbol || fields.ticker || this.extractSymbol(description) || this.extractSymbol(title);
    const action = fields.action || this.extractAction(description) || this.extractAction(title);
    const quantity = parseInt(fields.quantity || fields.size || fields.filledquantity || fields['filled'] || '1');
    
    // Get order type - but filter out instrument types that might be in a "type" field
    let orderType = fields['ordertype'] || 'Market';
    if (fields.type && !['Equity', 'Equity Option', 'Future', 'Cryptocurrency'].includes(fields.type)) {
      orderType = fields.type;
    }
    
    // For fill notifications, also check orderid field
    const orderId = fields.orderid || fields['order-id'] || embed.footer?.text?.split('ID: ')[1] || `signal_${Date.now()}`;
    
    if (!symbol || !action) {
      console.log(`   ⚠️ Could not extract symbol (${symbol}) or action (${action}) from embed`);
      console.log(`   📋 Fields found: ${Object.keys(fields).join(', ')}`);
      return null;
    }
    
    const source = isFill ? 'fill_notification' : 'discord_embed';
    console.log(`   ✅ Parsed ${source}: ${action} ${quantity} ${symbol}`);
    
    return {
      id: orderId,
      symbol: symbol.toUpperCase(),
      action: this.normalizeAction(action),
      quantity: quantity || 1,
      orderType: orderType,
      timestamp: embed.timestamp || new Date(),
      source: source
    };
  }

  /**
   * Parse signal from text message
   */
  parseSignalFromText(text) {
    // Look for patterns like: "BUY 10 SPY" or "SIGNAL: SELL 5 AAPL"
    const signalPattern = /(?:signal|trade)[:\s]*(buy|sell|bto|sto|btc|stc)\s+(\d+)\s+([A-Z]+)/i;
    const match = text.match(signalPattern);
    
    if (!match) {
      return null;
    }
    
    return {
      id: `signal_${Date.now()}`,
      symbol: match[3].toUpperCase(),
      action: this.normalizeAction(match[1]),
      quantity: parseInt(match[2]),
      orderType: 'Market',
      timestamp: new Date(),
      source: 'discord_text'
    };
  }

  /**
   * Normalize action to Tastytrade format
   */
  normalizeAction(action) {
    const upper = action.toUpperCase();
    
    if (upper.includes('BUY') || upper === 'BTO') {
      return 'Buy to Open';
    } else if (upper.includes('SELL') || upper === 'STO') {
      return 'Sell to Open';
    } else if (upper === 'BTC') {
      return 'Buy to Close';
    } else if (upper === 'STC') {
      return 'Sell to Close';
    }
    
    return action;
  }

  /**
   * Extract symbol from text
   */
  extractSymbol(text) {
    const symbolPattern = /\b([A-Z]{1,5})\b/g;
    const matches = text.match(symbolPattern);
    return matches ? matches[0] : null;
  }

  /**
   * Extract action from text
   */
  extractAction(text) {
    const upper = text.toUpperCase();
    if (upper.includes('BUY')) return 'Buy to Open';
    if (upper.includes('SELL')) return 'Sell to Open';
    return null;
  }

  /**
   * Stop listening
   */
  async stop() {
    if (this.client) {
      await this.client.destroy();
      this.isRunning = false;
    }
  }

  /**
   * Get listener stats
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      processedSignalsCount: this.processedSignals.size,
      enabledSymbols: this.enabledSymbols,
      maxQuantity: this.maxQuantity
    };
  }
}

module.exports = DiscordListener;


