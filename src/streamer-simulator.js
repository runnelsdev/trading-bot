/**
 * Tastytrade Account Streamer Simulator
 * 
 * Simulates the messages that come from Tastytrade's account streamer
 * so you can test your fill notification system without making real trades.
 * 
 * Usage:
 *   node src/streamer-simulator.js
 * 
 * Then use Discord commands:
 *   !sim fill SPY 450 BTO          - Simulate a fill
 *   !sim partial QQQ 380 STC 5/10  - Simulate partial fill
 *   !sim spread SPY 450/455 CALL   - Simulate spread fill
 *   !sim random                     - Random fill
 *   !sim burst 5                    - 5 rapid fills
 *   !sim status                     - Show simulator status
 */

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const FillBroadcaster = require('./fill-broadcaster');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let fillBroadcaster = null;
let simulationStats = {
  totalSimulated: 0,
  bySymbol: {},
  byAction: {},
  startTime: new Date()
};

// ============================================================
// TASTYTRADE MESSAGE FORMATS
// These mirror the actual formats from Tastytrade's streamer
// ============================================================

/**
 * Generate a realistic Tastytrade Order message
 * This is the primary format for filled orders
 */
function generateOrderMessage(options = {}) {
  const {
    symbol = 'SPY',
    action = 'Buy to Open',
    quantity = 1,
    filledQuantity = quantity,
    price = 450.00,
    strike = null,
    expiration = null,
    optionType = null,
    status = 'Filled'
  } = options;

  const isOption = strike || optionType || expiration;
  const orderId = `SIM-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  
  // This matches Tastytrade's actual streamer format
  return {
    type: 'Order',
    channel: 'account-subscribe',
    data: {
      order: {
        'id': orderId,
        'order-id': orderId,
        'account-number': process.env.TASTYTRADE_ACCOUNT_NUMBER || '5WT12345',
        'status': status,
        'underlying-symbol': symbol,
        'symbol': isOption ? generateOCCSymbol(symbol, strike, expiration, optionType) : symbol,
        'order-action': action,
        'action': action,
        'size': quantity,
        'order-quantity': quantity,
        'filled-quantity': filledQuantity,
        'average-fill-price': price,
        'price': price,
        'fill-price': price,
        'instrument-type': isOption ? 'Equity Option' : 'Equity',
        'strike': strike,
        'strike-price': strike,
        'expiration': expiration,
        'expiration-date': expiration,
        'option-type': optionType,
        'put-call': optionType,
        'filled-at': new Date().toISOString(),
        'received-at': new Date().toISOString(),
        'updated-at': Date.now(),
        'time-in-force': 'Day',
        'order-type': 'Limit',
        'legs': isOption ? [{
          'instrument-type': 'Equity Option',
          'symbol': generateOCCSymbol(symbol, strike, expiration, optionType),
          'action': action,
          'quantity': quantity,
          'strike': strike,
          'strike-price': strike,
          'expiration': expiration,
          'expiration-date': expiration,
          'option-type': optionType,
          'put-call': optionType
        }] : [],
        'fees': 0.50,
        'commission': 0.65,
        'regulatory-fees': 0.03,
        'clearing-fees': 0.02
      }
    }
  };
}

/**
 * Generate a Fill event message (alternative format)
 */
function generateFillMessage(options = {}) {
  const {
    symbol = 'SPY',
    action = 'Buy to Open',
    quantity = 1,
    price = 450.00
  } = options;

  return {
    type: 'Fill',
    channel: 'account-subscribe',
    data: {
      type: 'Fill',
      'order-id': `FILL-${Date.now()}`,
      'symbol': symbol,
      'underlying-symbol': symbol,
      'action': action,
      'order-action': action,
      'quantity': quantity,
      'filled-quantity': quantity,
      'price': price,
      'fill-price': price,
      'instrument-type': 'Equity',
      'executed-at': new Date().toISOString(),
      'timestamp': Date.now(),
      'account-number': process.env.TASTYTRADE_ACCOUNT_NUMBER || '5WT12345',
      'venue': 'NASDAQ'
    }
  };
}

/**
 * Generate a Trade execution message (another format)
 */
function generateTradeMessage(options = {}) {
  const {
    symbol = 'SPY',
    side = 'Buy',
    quantity = 100,
    price = 450.00
  } = options;

  return {
    type: 'Trade',
    data: {
      type: 'Trade',
      id: `TRADE-${Date.now()}`,
      symbol: symbol,
      side: side,
      action: side === 'Buy' ? 'Buy to Open' : 'Sell to Close',
      quantity: quantity,
      size: quantity,
      price: price,
      type: 'Equity',
      timestamp: new Date().toISOString(),
      venue: 'NYSE'
    }
  };
}

/**
 * Generate OCC option symbol
 */
function generateOCCSymbol(underlying, strike, expiration, optionType) {
  if (!strike || !expiration || !optionType) {
    return underlying;
  }
  
  // Format: SPY241220C00450000
  const exp = expiration.replace(/-/g, '').slice(2); // YYMMDD
  const type = optionType.toUpperCase().charAt(0); // C or P
  const strikeStr = (strike * 1000).toString().padStart(8, '0');
  
  return `${underlying}${exp}${type}${strikeStr}`;
}

/**
 * Generate random fill for testing
 */
function generateRandomFill() {
  const symbols = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'AMD', 'IWM', 'DIA'];
  const actions = ['Buy to Open', 'Sell to Close', 'Buy to Close', 'Sell to Open'];
  const isOption = Math.random() > 0.3; // 70% options
  
  const symbol = symbols[Math.floor(Math.random() * symbols.length)];
  const action = actions[Math.floor(Math.random() * actions.length)];
  
  const options = {
    symbol,
    action,
    quantity: Math.floor(Math.random() * 10) + 1,
    price: (Math.random() * 50 + 1).toFixed(2)
  };
  
  if (isOption) {
    options.strike = Math.round((Math.random() * 100 + 400) / 5) * 5; // Round to 5
    options.expiration = generateFutureDate();
    options.optionType = Math.random() > 0.5 ? 'CALL' : 'PUT';
  }
  
  return generateOrderMessage(options);
}

/**
 * Generate a future expiration date
 */
function generateFutureDate() {
  const days = Math.floor(Math.random() * 60) + 7; // 7-67 days out
  const date = new Date();
  date.setDate(date.getDate() + days);
  
  // Find next Friday
  while (date.getDay() !== 5) {
    date.setDate(date.getDate() + 1);
  }
  
  return date.toISOString().split('T')[0];
}

/**
 * Process simulated message through the fill broadcaster
 */
async function processSimulatedMessage(message, sourceChannel) {
  console.log('\n📨 Simulating streamer message:');
  console.log(JSON.stringify(message, null, 2));
  
  // Extract fill data (same logic as live-fills-integration.js)
  const fillData = extractFillFromMessage(message);
  
  if (!fillData) {
    console.log('❌ Could not extract fill data from message');
    return { success: false, error: 'Could not extract fill data' };
  }
  
  console.log('\n✅ Extracted fill:', fillData);
  
  // Update stats
  simulationStats.totalSimulated++;
  simulationStats.bySymbol[fillData.symbol] = (simulationStats.bySymbol[fillData.symbol] || 0) + 1;
  simulationStats.byAction[fillData.action] = (simulationStats.byAction[fillData.action] || 0) + 1;
  
  // Broadcast to Discord
  const result = await fillBroadcaster.broadcastFill(fillData);
  
  return result;
}

/**
 * Extract fill data from streamer message (mirrors live integration)
 */
function extractFillFromMessage(message) {
  try {
    // Format 1: Order update
    if (message.data?.order || message.order) {
      const order = message.data?.order || message.order;
      
      if (!['Filled', 'Partially Filled', 'PartiallyFilled'].includes(order.status)) {
        return null;
      }
      
      return {
        orderId: order.id || order['order-id'],
        symbol: order['underlying-symbol'] || order.symbol,
        action: order.action || order['order-action'],
        status: order.status,
        filledQuantity: order['filled-quantity'] || order.filledQuantity || order.size,
        totalQuantity: order.size || order['order-quantity'],
        fillPrice: order['average-fill-price'] || order.price || order['fill-price'],
        instrumentType: order['instrument-type'] || 'Equity',
        strike: order.strike || order['strike-price'],
        expiration: order.expiration || order['expiration-date'],
        optionType: order['option-type'] || order['put-call'],
        filledAt: order['filled-at'] || new Date().toISOString(),
        accountNumber: order['account-number'],
        fees: (order.fees || 0) + (order.commission || 0) + (order['regulatory-fees'] || 0),
        legs: order.legs
      };
    }
    
    // Format 2: Fill event
    if (message.type === 'Fill' || message.data?.type === 'Fill') {
      const fill = message.data || message;
      return {
        orderId: fill['order-id'],
        symbol: fill.symbol || fill['underlying-symbol'],
        action: fill.action || fill['order-action'],
        status: 'Filled',
        filledQuantity: fill.quantity || fill['filled-quantity'],
        totalQuantity: fill.quantity || fill['filled-quantity'],
        fillPrice: fill.price || fill['fill-price'],
        instrumentType: fill['instrument-type'] || 'Equity',
        filledAt: fill['executed-at'] || fill.timestamp,
        accountNumber: fill['account-number']
      };
    }
    
    // Format 3: Trade
    if (message.type === 'Trade' || message.data?.type === 'Trade') {
      const trade = message.data || message;
      return {
        orderId: trade.id,
        symbol: trade.symbol,
        action: trade.action || (trade.side === 'Buy' ? 'Buy to Open' : 'Sell to Close'),
        status: 'Filled',
        filledQuantity: trade.quantity || trade.size,
        fillPrice: trade.price,
        instrumentType: trade.type || 'Equity',
        filledAt: trade.timestamp
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting fill:', error);
    return null;
  }
}

/**
 * Parse simulation command
 */
function parseSimCommand(args) {
  const [subcommand, ...rest] = args;
  
  switch (subcommand?.toLowerCase()) {
    case 'fill':
      // !sim fill SPY 450 BTO [qty] [price]
      return {
        type: 'fill',
        symbol: rest[0]?.toUpperCase() || 'SPY',
        strike: parseFloat(rest[1]) || null,
        action: parseAction(rest[2]) || 'Buy to Open',
        quantity: parseInt(rest[3]) || 1,
        price: parseFloat(rest[4]) || (Math.random() * 10 + 1).toFixed(2)
      };
      
    case 'option':
      // !sim option SPY 450 CALL BTO [exp]
      return {
        type: 'option',
        symbol: rest[0]?.toUpperCase() || 'SPY',
        strike: parseFloat(rest[1]) || 450,
        optionType: rest[2]?.toUpperCase() || 'CALL',
        action: parseAction(rest[3]) || 'Buy to Open',
        expiration: rest[4] || generateFutureDate(),
        quantity: parseInt(rest[5]) || 1
      };
      
    case 'partial':
      // !sim partial SPY 450 STC 5/10
      const [filled, total] = (rest[3] || '5/10').split('/').map(n => parseInt(n));
      return {
        type: 'partial',
        symbol: rest[0]?.toUpperCase() || 'SPY',
        strike: parseFloat(rest[1]) || 450,
        action: parseAction(rest[2]) || 'Sell to Close',
        filledQuantity: filled || 5,
        quantity: total || 10
      };
      
    case 'spread':
      // !sim spread SPY 450/455 CALL
      const [strike1, strike2] = (rest[1] || '450/455').split('/').map(n => parseFloat(n));
      return {
        type: 'spread',
        symbol: rest[0]?.toUpperCase() || 'SPY',
        strike1: strike1 || 450,
        strike2: strike2 || 455,
        optionType: rest[2]?.toUpperCase() || 'CALL'
      };
      
    case 'equity':
      // !sim equity AAPL BTO 100 175.50
      return {
        type: 'equity',
        symbol: rest[0]?.toUpperCase() || 'AAPL',
        action: parseAction(rest[1]) || 'Buy to Open',
        quantity: parseInt(rest[2]) || 100,
        price: parseFloat(rest[3]) || 175.50
      };
      
    case 'random':
      return { type: 'random' };
      
    case 'burst':
      return { 
        type: 'burst', 
        count: parseInt(rest[0]) || 5,
        delay: parseInt(rest[1]) || 1000
      };
      
    case 'formats':
      return { type: 'formats' };
      
    case 'status':
      return { type: 'status' };
      
    case 'help':
    default:
      return { type: 'help' };
  }
}

/**
 * Parse action shorthand
 */
function parseAction(action) {
  if (!action) return null;
  
  const actionMap = {
    'BTO': 'Buy to Open',
    'BTC': 'Buy to Close',
    'STO': 'Sell to Open',
    'STC': 'Sell to Close',
    'BUY': 'Buy to Open',
    'SELL': 'Sell to Close'
  };
  
  return actionMap[action.toUpperCase()] || action;
}

// ============================================================
// DISCORD BOT
// ============================================================

client.once('ready', () => {
  console.log(`✅ Simulator connected as: ${client.user.tag}`);
  
  // Initialize fill broadcaster
  fillBroadcaster = new FillBroadcaster(client, {
    vipChannelId: process.env.VIP_CHANNEL_ID,
    premiumChannelId: process.env.PREMIUM_CHANNEL_ID,
    basicChannelId: process.env.BASIC_CHANNEL_ID
  });
  
  console.log('✅ Fill broadcaster initialized');
  console.log('\n🎮 Streamer Simulator Ready!');
  console.log('   Use !sim help in Discord for commands\n');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.toLowerCase().startsWith('!sim')) return;
  
  const args = message.content.slice(5).trim().split(/\s+/);
  const command = parseSimCommand(args);
  
  let result;
  let streamerMessage;
  
  switch (command.type) {
    case 'fill':
      streamerMessage = generateOrderMessage({
        symbol: command.symbol,
        strike: command.strike,
        action: command.action,
        quantity: command.quantity,
        price: command.price,
        optionType: command.strike ? 'CALL' : null,
        expiration: command.strike ? generateFutureDate() : null
      });
      result = await processSimulatedMessage(streamerMessage, message.channel);
      await message.reply(`📤 Simulated ${command.symbol} fill → ${result.errors?.length ? '⚠️ Some errors' : '✅ Broadcast complete'}`);
      break;
      
    case 'option':
      streamerMessage = generateOrderMessage({
        symbol: command.symbol,
        strike: command.strike,
        optionType: command.optionType,
        action: command.action,
        expiration: command.expiration,
        quantity: command.quantity,
        price: (Math.random() * 10 + 0.5).toFixed(2)
      });
      result = await processSimulatedMessage(streamerMessage, message.channel);
      await message.reply(`📤 Simulated ${command.symbol} ${command.strike}${command.optionType.charAt(0)} → ${result.errors?.length ? '⚠️ Errors' : '✅ Done'}`);
      break;
      
    case 'partial':
      streamerMessage = generateOrderMessage({
        symbol: command.symbol,
        strike: command.strike,
        action: command.action,
        quantity: command.quantity,
        filledQuantity: command.filledQuantity,
        status: 'Partially Filled',
        optionType: 'PUT',
        expiration: generateFutureDate()
      });
      result = await processSimulatedMessage(streamerMessage, message.channel);
      await message.reply(`📤 Simulated partial fill (${command.filledQuantity}/${command.quantity}) → ✅`);
      break;
      
    case 'spread':
      // Simulate a spread as a single fill (net debit/credit)
      streamerMessage = generateOrderMessage({
        symbol: command.symbol,
        strike: command.strike1,
        action: 'Buy to Open',
        quantity: 1,
        price: 2.50, // Net debit for vertical
        optionType: command.optionType,
        expiration: generateFutureDate()
      });
      // Add second leg info
      streamerMessage.data.order.legs.push({
        'instrument-type': 'Equity Option',
        'symbol': generateOCCSymbol(command.symbol, command.strike2, streamerMessage.data.order.expiration, command.optionType),
        'action': 'Sell to Open',
        'quantity': 1,
        'strike': command.strike2,
        'option-type': command.optionType
      });
      result = await processSimulatedMessage(streamerMessage, message.channel);
      await message.reply(`📤 Simulated ${command.symbol} ${command.strike1}/${command.strike2} spread → ✅`);
      break;
      
    case 'equity':
      streamerMessage = generateOrderMessage({
        symbol: command.symbol,
        action: command.action,
        quantity: command.quantity,
        price: command.price
      });
      result = await processSimulatedMessage(streamerMessage, message.channel);
      await message.reply(`📤 Simulated ${command.quantity} ${command.symbol} @ $${command.price} → ✅`);
      break;
      
    case 'random':
      streamerMessage = generateRandomFill();
      result = await processSimulatedMessage(streamerMessage, message.channel);
      const fill = streamerMessage.data.order;
      await message.reply(`🎲 Random: ${fill['underlying-symbol']} ${fill.action} → ✅`);
      break;
      
    case 'burst':
      await message.reply(`🚀 Sending ${command.count} rapid fills...`);
      for (let i = 0; i < command.count; i++) {
        streamerMessage = generateRandomFill();
        await processSimulatedMessage(streamerMessage, message.channel);
        if (command.delay > 0) {
          await new Promise(r => setTimeout(r, command.delay));
        }
      }
      await message.reply(`✅ Burst complete: ${command.count} fills sent`);
      break;
      
    case 'formats':
      // Test all three message formats
      await message.reply('📝 Testing all message formats...');
      
      // Format 1: Order
      await processSimulatedMessage(generateOrderMessage({ symbol: 'SPY', action: 'Buy to Open' }), message.channel);
      await new Promise(r => setTimeout(r, 1000));
      
      // Format 2: Fill
      await processSimulatedMessage(generateFillMessage({ symbol: 'QQQ', action: 'Sell to Close' }), message.channel);
      await new Promise(r => setTimeout(r, 1000));
      
      // Format 3: Trade
      await processSimulatedMessage(generateTradeMessage({ symbol: 'AAPL', side: 'Buy' }), message.channel);
      
      await message.reply('✅ All 3 message formats tested!');
      break;
      
    case 'status':
      const uptime = Math.floor((Date.now() - simulationStats.startTime) / 1000 / 60);
      const embed = new EmbedBuilder()
        .setTitle('📊 Simulator Status')
        .setColor(0x00FF00)
        .addFields(
          { name: 'Total Simulated', value: simulationStats.totalSimulated.toString(), inline: true },
          { name: 'Uptime', value: `${uptime} minutes`, inline: true },
          { name: 'By Symbol', value: Object.entries(simulationStats.bySymbol).map(([s, c]) => `${s}: ${c}`).join('\n') || 'None', inline: true },
          { name: 'By Action', value: Object.entries(simulationStats.byAction).map(([a, c]) => `${a}: ${c}`).join('\n') || 'None', inline: true }
        )
        .setTimestamp();
      await message.reply({ embeds: [embed] });
      break;
      
    case 'help':
    default:
      const helpEmbed = new EmbedBuilder()
        .setTitle('🎮 Streamer Simulator Commands')
        .setColor(0x5865F2)
        .setDescription('Simulate Tastytrade account streamer messages for testing')
        .addFields(
          { name: '**Options**', value: 
            '`!sim option SPY 450 CALL BTO` - Option fill\n' +
            '`!sim option QQQ 380 PUT STC` - Put sell\n' +
            '`!sim partial SPY 450 STC 5/10` - Partial fill'
          },
          { name: '**Equity**', value:
            '`!sim equity AAPL BTO 100 175` - Stock buy\n' +
            '`!sim equity TSLA STC 50 250` - Stock sell'
          },
          { name: '**Spreads**', value:
            '`!sim spread SPY 450/455 CALL` - Vertical spread'
          },
          { name: '**Testing**', value:
            '`!sim random` - Random fill\n' +
            '`!sim burst 5` - 5 rapid fills\n' +
            '`!sim formats` - Test all formats'
          },
          { name: '**Info**', value:
            '`!sim status` - Show statistics\n' +
            '`!sim help` - This message'
          },
          { name: '**Action Shortcuts**', value:
            '`BTO` = Buy to Open\n' +
            '`STO` = Sell to Open\n' +
            '`BTC` = Buy to Close\n' +
            '`STC` = Sell to Close'
          }
        )
        .setFooter({ text: 'Simulates real Tastytrade streamer message formats' });
      await message.reply({ embeds: [helpEmbed] });
      break;
  }
});

// Login
client.login(process.env.DISCORD_BOT_TOKEN);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down simulator...');
  client.destroy();
  process.exit(0);
});
