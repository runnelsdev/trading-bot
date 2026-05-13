# Trading Bot

Automated trading bot integrating [Tastytrade](https://tastytrade.com) for order execution and [Discord](https://discord.com) for signal broadcasting.

## Project Structure

```
src/
├── bots/           # Entry points — each can run independently or via bot-manager
│   ├── index.js              Main trading bot (Discord commands + order execution)
│   ├── subscriber-bot.js     Subscriber bot with setup wizard & management UI
│   ├── fill-follower-bot.js  Mirrors fills from a coach account
│   ├── signal-relay-bot.js   Relays Tastytrade Discord signals to tiered channels
│   ├── live-fills-integration.js  Real-time fill monitoring & broadcasting
│   └── bot-manager.js        Runs all bots as managed child processes
├── services/       # Core business logic
│   ├── TastytradeExecutor.js   Trade execution with multi-tier auth
│   ├── PositionSizer.js        Position sizing (fixed, proportional, percentage)
│   ├── trading-broadcaster.js  Integrates Tastytrade, order queue, Discord
│   ├── fill-broadcaster.js     Tiered fill notifications (VIP/Premium/Basic)
│   ├── signal-relay.js         Signal relay with tier-based distribution
│   └── order-queue.js          Rate-limited order queue with priorities
├── clients/        # External API clients
│   ├── tastytrade-client.js    Tastytrade API wrapper
│   ├── ConfigClient.js         Central server client (auth, heartbeats)
│   └── DiscordListener.js      Discord signal listener with duplicate detection
├── config/         # Configuration management
│   ├── ConfigManager.js        Encrypted config storage (AES-256-CBC)
│   ├── queue-config.js         Order queue profiles (aggressive/balanced/conservative)
│   └── setup-server.js         Express routes for web-based bot configuration
├── monitoring/     # Observability
│   ├── latency-monitor.js      Signal & order latency tracking
│   └── market-data-helper.js   Market data utilities
└── utils/          # Utilities
    ├── update-sidecar.js       Auto-update sidecar (git pull, npm install, env sync)
    └── streamer-simulator.js   Fill streamer simulator for testing
scripts/            # Dev & test scripts
config/             # Runtime config data (encrypted, gitignored)
docs/               # Documentation
public/             # Web UI assets (setup wizard)
tests/              # Test files
```

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template and fill in credentials
cp .env.example .env

# Run the subscriber bot (includes setup wizard)
npm run subscriber

# Or run the main trading bot
npm start
```

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `npm start` | Main trading bot |
| `subscriber` | `npm run subscriber` | Subscriber bot with management UI |
| `fill-follower` | `npm run fill-follower` | Fill follower bot |
| `start:all` | `npm run start:all` | All bots via bot manager |
| `live-fills` | `npm run live-fills` | Live fills integration |
| `bot-manager` | `npm run bot-manager` | Bot manager (process supervisor) |
| `update-sidecar` | `npm run update-sidecar` | Auto-update sidecar |
| `test-discord` | `npm run test-discord` | Test Discord connection |

## Environment Variables

See `tests/.env.example` for a full list. Key variables:

- `DISCORD_BOT_TOKEN` — Discord bot token
- `TASTYTRADE_USERNAME` / `TASTYTRADE_PASSWORD` — Tastytrade credentials
- `TASTYTRADE_ACCOUNT_NUMBER` — Trading account number
- `TASTYTRADE_ENV` — `sandbox` or `production`
- `VIP_CHANNEL_ID` / `PREMIUM_CHANNEL_ID` / `BASIC_CHANNEL_ID` — Tiered Discord channels

## Architecture

The bot supports multiple deployment modes:

- **Subscriber Bot** — Listens to a Discord channel for trading signals, executes trades automatically via Tastytrade
- **Fill Follower** — Mirrors trades from a coach account with proportional position sizing
- **Signal Relay** — Relays signals from Tastytrade's Discord to your own tiered channels
- **Main Bot** — Discord command interface for manual trading operations

All bots can run independently or together via the **Bot Manager**, which handles process lifecycle, health checks, and auto-restarts.
