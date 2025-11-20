# Trading Bot Latency System

This system implements a low-latency order queue and signal broadcasting system for Tastytrade integration.

## Architecture

### Components

1. **OrderQueueManager** (`src/order-queue.js`)
   - Manages order execution queue
   - Supports priority ordering
   - Rate limiting and concurrency control
   - Scheduled orders

2. **LatencyMonitor** (`src/latency-monitor.js`)
   - Tracks signal and order latency
   - Provides statistics (min, max, avg, median, P95, P99)
   - Tracks by source (manual, queue, etc.)

3. **TradingBroadcaster** (`src/trading-broadcaster.js`)
   - Integrates Tastytrade, queue, and Discord
   - Handles account streamer for real-time fills
   - Broadcasts signals to Discord

4. **Configuration** (`config/queue-config.js`)
   - Three profiles: aggressive, balanced, conservative
   - Adjustable rate limits and concurrency

## Latency Profiles

### Aggressive (Lowest Latency)
- **Max concurrent orders:** 5
- **Delay between orders:** 0ms
- **Max orders/minute:** 30
- **Risk checks:** Disabled
- **Use case:** Day trading, scalping

### Balanced (Recommended)
- **Max concurrent orders:** 2
- **Delay between orders:** 500ms
- **Max orders/minute:** 20
- **Risk checks:** Enabled
- **Use case:** General trading

### Conservative (Safest)
- **Max concurrent orders:** 1
- **Delay between orders:** 2000ms
- **Max orders/minute:** 10
- **Risk checks:** Enabled
- **Approval workflow:** Enabled
- **Use case:** Risk-averse trading

## Usage

### Basic Setup

```javascript
const TradingBroadcaster = require('./src/trading-broadcaster');
const { Client } = require('discord.js');

const discordClient = new Client({...});
const broadcaster = new TradingBroadcaster(
  discordClient,
  '5WT00000',  // Account number
  'balanced'   // Config profile
);

await broadcaster.initialize();
await broadcaster.connectAccountStreamer();
```

### Queue an Order

```javascript
const orderData = {
  'time-in-force': 'Day',
  'order-type': 'Market',
  'size': 100,
  'underlying-symbol': 'SPY',
  'legs': [{
    'instrument-type': 'Equity',
    'symbol': 'SPY',
    'quantity': 100,
    'action': 'Buy to Open'
  }]
};

// Normal priority
await broadcaster.queueOrder(orderData);

// High priority (jumps queue)
await broadcaster.queueOrder(orderData, { priority: 10 });

// Scheduled order
await broadcaster.queueOrder(orderData, {
  scheduledFor: '2025-11-18T09:30:00-05:00'
});

// Dry run
await broadcaster.queueOrder(orderData, { dryRun: true });
```

### Check Queue Status

```javascript
const status = broadcaster.getQueueStatus();
console.log(`Queue length: ${status.queueLength}`);
console.log(`Active orders: ${status.activeOrders}`);
```

### View Latency Statistics

```javascript
// Get stats for last hour
const stats = broadcaster.getLatencyStats(3600000);

// Print stats
broadcaster.printLatencyStats(3600000);
```

## Discord Commands

The bot responds to these commands:

- `!queue-status` - Show current queue status
- `!latency-stats` - Show latency statistics
- `!queue-order SYMBOL QUANTITY ACTION [PRIORITY]` - Queue an order

## Environment Variables

Add to your `.env`:

```env
# Discord
DISCORD_TOKEN=your_discord_token

# Tastytrade
TASTYTRADE_ENV=sandbox
TASTYTRADE_CLIENT_SECRET=your_secret
TASTYTRADE_REFRESH_TOKEN=your_refresh_token
TASTYTRADE_ACCOUNT_NUMBER=5WT00000

# Queue Configuration
QUEUE_CONFIG_PROFILE=balanced  # aggressive, balanced, or conservative
```

## Latency Expectations

### Manual Trades (Tastytrade UI)
- **Best case:** 280ms
- **Typical:** 1-3 seconds
- **Worst case:** 3-5 seconds

### Queued Orders
- **Empty queue:** 2-5 seconds
- **Typical queue:** 5-15 seconds
- **Busy queue:** 15-60 seconds
- **Priority orders:** 1-3 seconds (jumps queue)

## Running the Bot

```bash
# Start the bot
node src/index.js

# Or with PM2 for production
pm2 start src/index.js --name trading-bot
```

## Monitoring

The system automatically:
- Tracks all signal latencies
- Tracks all order latencies
- Logs high latency warnings (>5 seconds)
- Prints stats every 5 minutes

## Optimization Tips

1. **Use priority for urgent orders:**
   ```javascript
   await broadcaster.queueOrder(order, { priority: 10 });
   ```

2. **Use concurrent execution:**
   ```javascript
   // In queue-config.js, set maxConcurrentOrders: 5
   ```

3. **Deploy close to Tastytrade servers:**
   - AWS US-East-1: ~20-50ms API latency
   - Reduces total latency by 80-250ms

4. **Skip non-critical processing:**
   - Broadcast immediately
   - Save to database in background

## Troubleshooting

### High Latency
- Check queue length: `!queue-status`
- Check if rate limited
- Consider using priority orders
- Review network latency

### Orders Not Executing
- Check account access
- Verify order data format
- Check rate limits
- Review error logs

### Discord Not Receiving Signals
- Verify Discord bot permissions
- Check channel name matches ('trading-signals' or 'trading')
- Verify account streamer connection

