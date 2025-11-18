const { Client, GatewayIntentBits } = require('discord.js');

/**
 * Discord Listener
 * Listens to Discord channel for trading signals
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
  }

  /**
   * Start listening to Discord
   */
  async start() {
    console.log('🔌 Connecting to Discord...');
    
    // Login
    await this.client.login(this.config.discordBotToken);
    
    // Wait for ready
    await new Promise((resolve) => {
      this.client.once('ready', () => {
        console.log(`✅ Discord connected as ${this.client.user.tag}`);
        
        // Get channel
        this.channel = this.client.channels.cache.get(this.config.channelId);
        
        if (!this.channel) {
          console.error(`❌ Channel ${this.config.channelId} not found`);
          throw new Error('Channel not found');
        }
        
        console.log(`📡 Listening to channel: #${this.channel.name}`);
        this.isRunning = true;
        resolve();
      });
    });
    
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
    
    // Ignore bot messages
    if (message.author.bot) return;
    
    // Check for signal in embeds
    if (message.embeds.length > 0) {
      const signal = this.parseSignalFromEmbed(message.embeds[0]);
      if (signal) {
        console.log(`🎯 Signal detected: ${signal.action} ${signal.quantity} ${signal.symbol}`);
        await this.executor.executeTrade(signal);
      }
      return;
    }
    
    // Check for signal in message content (alternative format)
    const signal = this.parseSignalFromText(message.content);
    if (signal) {
      console.log(`🎯 Signal detected: ${signal.action} ${signal.quantity} ${signal.symbol}`);
      await this.executor.executeTrade(signal);
    }
  }

  /**
   * Parse signal from Discord embed
   */
  parseSignalFromEmbed(embed) {
    // Check if it's a signal
    const title = embed.title || '';
    const description = embed.description || '';
    
    if (!title.toUpperCase().includes('SIGNAL') && 
        !description.toUpperCase().includes('SIGNAL')) {
      return null;
    }
    
    const fields = {};
    embed.fields.forEach(field => {
      const key = field.name.toLowerCase().replace(/\s+/g, '');
      fields[key] = field.value;
    });
    
    // Extract signal data
    const symbol = fields.symbol || fields.ticker || this.extractSymbol(description);
    const action = fields.action || this.extractAction(description);
    const quantity = parseInt(fields.quantity || fields.size || '1');
    const orderType = fields.type || fields['ordertype'] || 'Market';
    
    if (!symbol || !action) {
      return null;
    }
    
    return {
      id: embed.footer?.text?.split('ID: ')[1] || `signal_${Date.now()}`,
      symbol: symbol.toUpperCase(),
      action: this.normalizeAction(action),
      quantity: quantity || 1,
      orderType: orderType,
      timestamp: embed.timestamp || new Date(),
      source: 'discord_embed'
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
}

module.exports = DiscordListener;


