# Subscriber Bot Deployment Guide

## Overview

Each subscriber gets their own DigitalOcean droplet running the trading bot in subscriber mode. The bot listens to Discord fill notifications from the broadcaster and mirrors trades into the subscriber's Tastytrade account.

## Requirements

- DigitalOcean droplet: Ubuntu 24.04, `s-1vcpu-2gb` ($12/mo), NYC1 region
- Node.js 20.x
- PM2 process manager
- Git access to `runnelsdev/trading-bot`
- Subscriber's Tastytrade account credentials
- Discord bot token (shared across all subscriber bots)

## 1. Create Droplet

Create via DigitalOcean dashboard or CLI:
- Image: Ubuntu 24.04 LTS
- Size: `s-1vcpu-2gb` (1 vCPU, 2GB RAM, 50GB disk)
- Region: `nyc1`
- Tags: `trading-bot`, `auto-deployed`
- Enable monitoring

## 2. Initial Server Setup

SSH into the new droplet:

```bash
ssh root@<DROPLET_IP>
```

Install Node.js and PM2:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
npm install -g pm2
pm2 startup
```

## 3. Deploy the Bot

```bash
cd /opt
git clone https://github.com/runnelsdev/trading-bot.git
cd trading-bot
npm install
```

## 4. Configure Environment

Create `/opt/trading-bot/.env`:

```env
# Deployment
DEPLOYMENT_ID=<unique-hex-id>
NODE_ENV=production
PORT=3000
FIRST_RUN=false

# Discord
DISCORD_BOT_TOKEN=<shared-subscriber-discord-bot-token>
DISCORD_CLIENT_ID=<discord-client-id>
DISCORD_GUILD_ID=<discord-server-id>
DISCORD_USER_ID=<subscriber-discord-user-id>

# Tastytrade (subscriber's own account)
TASTYTRADE_USERNAME=<subscriber-tastytrade-username>
TASTYTRADE_PASSWORD=<subscriber-tastytrade-password>
TASTYTRADE_ACCOUNT_NUMBER=<subscriber-account-number>
TASTYTRADE_ENV=production

# Central Server
CENTRAL_SERVER_URL=https://tradingbot.host
CENTRAL_SUBSCRIBER_ID=<subscriber-id-from-central>
CENTRAL_BOT_TOKEN=<central-server-bot-token>
CENTRAL_DISCORD_USER_ID=<subscriber-discord-user-id>

# Channels (subscriber listens to one based on tier)
VIP_CHANNEL_ID=<channel-id>
FILLS_CHANNEL_ID=<channel-id>

# Sidecar
AUTO_RESTART=false
ENABLE_NPM_UPDATES=false
```

## 5. Configure Bot Settings

Create `/opt/trading-bot/config/bot-config.json`:

```json
{
  "tastytradeUsername": "<username>",
  "tastytradePassword": "<password>",
  "tastytradeRememberToken": null,
  "tastytradeAccountNumber": "<account-number>",
  "channelId": "<discord-channel-id>",
  "channelName": "<channel-name>",
  "sizingMethod": "<fixed|percentage|proportional|multiplier>",
  "maxDailyLoss": 500,
  "discordBotToken": "<discord-bot-token>"
}
```

### Sizing Methods

| Method | Config Keys | Description |
|---|---|---|
| `fixed` | `fixedDollar: 200` | Spends up to $X per trade |
| `percentage` | `percentage: 10` | Uses X% of account balance per trade |
| `proportional` | (uses coach balance ratio) | Mirrors coach position scaled by account size |
| `multiplier` | `multiplier: 1` | Exact copy of coach quantity |

**Close behavior**: Sizing method only affects buy orders. Close orders always close the full position when the coach fully closes, regardless of sizing method.

## 6. Start with PM2

```bash
cd /opt/trading-bot
pm2 start ecosystem.config.js
pm2 save
```

This starts two processes:
- `trading-bot` — the subscriber bot
- `update-sidecar` — checks for git updates (auto-restart disabled)

Verify it started:

```bash
pm2 logs trading-bot --lines 30
```

Look for:
```
✅ Tastytrade connected (Password)
✅ DISCORD: CONNECTED
✅ BOT ONLINE - All systems connected
✅ Central Server connected
```

## 7. Set Up Nightly Restart Cron

The Tastytrade session token expires daily. A nightly restart forces fresh login before market open:

```bash
crontab -e
```

Add:

```
0 9 * * * /usr/bin/pm2 restart trading-bot >> /var/log/pm2-restart.log 2>&1
```

This runs at 4:00 AM CST (9:00 UTC), before market open at 8:30 AM CST.

## 8. Register on Central Server

The subscriber needs to be registered on the central server with:
- Subscriber ID
- Discord user ID
- Tier assignment (Bronze/Silver/Gold/Platinum) or admin tier override

The central server's daily job (midnight UTC) validates each subscriber's tier and sets trading authorization for the next day.

## Updating an Existing Bot

To deploy new code to a running subscriber:

```bash
ssh root@<DROPLET_IP>
cd /opt/trading-bot
git pull origin main
pm2 restart trading-bot
```

If there are dirty local files (package-lock.json from sidecar):

```bash
git checkout -- package-lock.json
git pull origin main
pm2 restart trading-bot
```

## Troubleshooting

### Bot shows "Trading blocked by Central Server"
The trading status expired. Wait for the midnight daily job to refresh it, or manually trigger it from the central server admin panel.

### 401 / token_invalid errors
The Tastytrade session expired. Clear cached auth and restart:

```bash
cd /opt/trading-bot
rm -f config/.session-cache.json
node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('config/bot-config.json')); c.tastytradeRememberToken=null; fs.writeFileSync('config/bot-config.json', JSON.stringify(c,null,2));"
pm2 restart trading-bot
```

### Bot crash-looping (high restart count)
Check if the update-sidecar is causing restarts:

```bash
pm2 logs update-sidecar --lines 20
```

If it's applying npm updates and restarting, add to `.env`:

```
AUTO_RESTART=false
ENABLE_NPM_UPDATES=false
```

Then: `pm2 restart update-sidecar --update-env`

### Margin errors on trades
The bot automatically retries with fewer contracts when margin is insufficient. If it keeps failing, the account needs more buying power or the sizing config should be lowered.

### "No open position" on close signals
The bot tried to close a position it doesn't hold. This happens when:
- The BTO failed (margin/auth error) but the STC signal still arrived
- The position was already closed by a prior signal

This is expected behavior — the bot skips the close safely.

## Current Subscriber Bots

| Name | IP | Account | Sizing | Channel |
|---|---|---|---|---|
| bgolfs | 147.182.171.69 | 5WI14176 | percentage | premium_channel |
| bjogfz | 198.199.83.8 | 5WI29426 | proportional | vip_channel |
| fk1apj | 159.223.173.235 | 5WI29397 | fixed | basic_channel |
| .181 (ThatGuy92) | 134.209.174.181 | (setup) | percentage | vip_channel |
