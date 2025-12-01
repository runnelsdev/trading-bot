# Fill Follower Bot 📡

A subscriber bot that watches Discord fill notifications and automatically places matching orders on your Tastytrade account.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  1. Fill Notification Posted to Discord                      │
│     (from the main trading bot)                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Fill Follower Bot Detects Notification                   │
│     - Parses embed fields                                    │
│     - Extracts: symbol, action, quantity, price              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Apply Filters & Limits                                   │
│     - Check symbol filter                                    │
│     - Check daily trade limit                                │
│     - Check daily loss limit                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Calculate Position Size                                  │
│     - Fixed quantity, OR                                     │
│     - Match fill quantity, OR                                │
│     - Percentage of fill                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Execute Trade on YOUR Tastytrade Account                 │
│     - Sandbox (testing) or Production (real money)           │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Copy Environment File

```bash
cp .env.follower.example .env
```

### 2. Edit .env with Your Settings

```env
# Discord
DISCORD_BOT_TOKEN=your_bot_token
FILLS_CHANNEL_ID=channel_where_fills_are_posted

# Tastytrade
TASTYTRADE_ACCOUNT_NUMBER=your_account
TASTYTRADE_USERNAME=your_username
TASTYTRADE_PASSWORD=your_password

# Position Sizing
SIZING_METHOD=fixed
FIXED_QUANTITY=1
MAX_QUANTITY=10
```

### 3. Choose Environment (Sandbox vs Production)

Edit `src/fill-follower-bot.js` and comment/uncomment:

```javascript
// ============================================================================
// ENVIRONMENT CONFIGURATION - COMMENT/UNCOMMENT TO SWITCH
// ============================================================================

// 🧪 SANDBOX MODE (for testing - no real money)
const TASTYTRADE_ENV = 'sandbox';

// 💰 PRODUCTION MODE (real money - use with caution!)
// const TASTYTRADE_ENV = 'production';
```

### 4. Run the Bot

```bash
npm run fill-follower
```

## Position Sizing Methods

| Method | Description |
|--------|-------------|
| `fixed` | Always trade `FIXED_QUANTITY` shares/contracts |
| `match` | Trade the same quantity as the fill notification |
| `percentage` | Trade `PERCENTAGE_OF_FILL`% of the fill quantity |

All methods respect `MAX_QUANTITY` as a safety cap.

## Safety Limits

| Setting | Description |
|---------|-------------|
| `MAX_DAILY_TRADES` | Maximum trades per day (default: 20) |
| `MAX_DAILY_LOSS` | Stop trading after this loss (default: $500) |
| `MAX_QUANTITY` | Maximum shares/contracts per trade |
| `ENABLED_SYMBOLS` | Only trade these symbols (empty = all) |

## Symbol Filter Example

Only trade SPY and QQQ:
```env
ENABLED_SYMBOLS=SPY,QQQ
```

## Environment Toggle

The sandbox/production toggle is **in the code** (not .env) for extra safety:

**Sandbox (Default - Testing):**
```javascript
const TASTYTRADE_ENV = 'sandbox';
// const TASTYTRADE_ENV = 'production';
```

**Production (Real Money):**
```javascript
// const TASTYTRADE_ENV = 'sandbox';
const TASTYTRADE_ENV = 'production';
```

⚠️ **WARNING:** Production mode trades real money. Test thoroughly in sandbox first!

## Running with PM2 (Production)

```bash
# Start
pm2 start src/fill-follower-bot.js --name fill-follower

# Monitor
pm2 logs fill-follower

# Stop
pm2 stop fill-follower

# Restart after code changes
pm2 restart fill-follower
```

## Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" → Create bot
4. Copy the token → paste in `.env` as `DISCORD_BOT_TOKEN`
5. Enable these Privileged Gateway Intents:
   - Message Content Intent
   - Server Members Intent
6. Invite bot to your server with these permissions:
   - Read Messages/View Channels
   - Send Messages
   - Add Reactions

## Troubleshooting

### "Channel not found"
- Make sure the bot is in the server with that channel
- Verify the channel ID is correct (enable Developer Mode in Discord settings)

### "Account not found"
- Double-check your `TASTYTRADE_ACCOUNT_NUMBER`
- Make sure credentials are correct for sandbox vs production

### "Time-in-force error"
- The bot automatically retries with GTC if Day orders fail outside market hours

### "Daily limit reached"
- Reset at midnight automatically
- Or restart the bot to reset counters

## Architecture

```
fill-follower-bot.js
├── FillFollowerBot (class)
│   ├── connectTastytrade()    - API authentication
│   ├── connectDiscord()       - Discord connection
│   ├── processFillEmbed()     - Parse fill notifications
│   ├── shouldExecuteFill()    - Apply filters/limits
│   ├── calculateQuantity()    - Position sizing
│   ├── executeTrade()         - Submit to Tastytrade
│   └── buildOptionSymbol()    - OCC format for options
```

## Support

For issues, check:
1. Console output for error messages
2. Tastytrade API response details
3. Discord bot permissions
