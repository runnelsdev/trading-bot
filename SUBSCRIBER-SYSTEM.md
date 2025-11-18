# Subscriber Bot System with Digital Ocean One-Click Deploy

Complete system for deploying subscriber bots that automatically execute trades from Discord signals.

## System Architecture

```
User subscribes via QuickBooks/Stripe
         ↓
   Make.com Automation
         ↓
   1. Add Discord role (tier-based)
   2. Send Digital Ocean one-click link
         ↓
User clicks link → Creates their own droplet
         ↓
   Configuration UI loads
         ↓
User configures:
   1. Tastytrade credentials
   2. Select Discord channel (based on their tier)
   3. Position sizing rules
         ↓
   Bot starts listening to selected channel
         ↓
   Auto-executes trades in THEIR Tastytrade account
```

## Files Created

### Core Application
- `src/subscriber-bot.js` - Main entry point (handles config mode and bot mode)
- `src/ConfigManager.js` - Secure configuration storage with encryption
- `src/DiscordListener.js` - Listens to Discord for trading signals
- `src/TastytradeExecutor.js` - Executes trades in Tastytrade
- `src/PositionSizer.js` - Calculates position sizes

### Configuration
- `config/setup-server.js` - Configuration API endpoints
- `public/setup.html` - Beautiful configuration UI
- `do-marketplace/manifest.yaml` - Digital Ocean one-click app manifest

## Digital Ocean One-Click Deploy

### Setup Instructions

1. **Create Digital Ocean Marketplace App:**
   - Go to Digital Ocean Marketplace
   - Submit your app using `do-marketplace/manifest.yaml`
   - Get your app ID

2. **Create One-Click Link:**
   ```
   https://cloud.digitalocean.com/droplets/new?appId=YOUR_APP_ID&size=s-1vcpu-1gb&region=nyc1
   ```

3. **Update Manifest:**
   - Update GitHub repo URL in `manifest.yaml`
   - Update logo and website URLs
   - Customize droplet size/regions

## Make.com Workflow

### Subscription Flow

1. **QuickBooks: Watch Invoices** (trigger)
2. **Router** (determine tier based on invoice amount)
3. **Discord: Add Role to Member**
4. **Email: Send** with Digital Ocean link

### Tier Mapping Example

```javascript
// In Make.com router
if (invoice.amount >= 100) {
  tier = 'tier3'; // VIP
  roleId = 'ROLE_ID_TIER_3';
} else if (invoice.amount >= 50) {
  tier = 'tier2'; // Premium
  roleId = 'ROLE_ID_TIER_2';
} else {
  tier = 'tier1'; // Basic
  roleId = 'ROLE_ID_TIER_1';
}
```

## Configuration UI

The setup UI guides users through:

1. **Discord Bot Token** - Create and configure Discord bot
2. **Tastytrade Connection** - Test and select account
3. **Channel Selection** - Choose signal channel based on tier
4. **Position Sizing** - Configure trading rules

## Usage

### For Subscribers

1. Receive email with Digital Ocean link
2. Click link → Deploy droplet ($6/month)
3. Open configuration page (auto-opens)
4. Complete 4-step setup (5 minutes)
5. Bot starts automatically

### For You (Signal Provider)

1. Trade in your Tastytrade account
2. Signals broadcast to Discord channels
3. Each subscriber's bot executes in THEIR account
4. Zero infrastructure to manage

## Environment Variables

### For Digital Ocean Droplet

```env
NODE_ENV=production
PORT=3000
FIRST_RUN=true
TASTYTRADE_ENV=sandbox  # or production
DISCORD_GUILD_ID=your_guild_id  # Optional
CHANNEL_TIER1_ID=channel_id_1
CHANNEL_TIER2_ID=channel_id_2
CHANNEL_TIER3_ID=channel_id_3
```

## Security Features

- ✅ **Encrypted Storage** - All credentials encrypted at rest
- ✅ **Secure Keys** - Encryption keys stored separately
- ✅ **File Permissions** - Config files with 600 permissions
- ✅ **No Cloud Storage** - Everything on subscriber's server

## Position Sizing Options

1. **Fixed Quantity** - Always trade X contracts/shares
2. **Signal Multiplier** - Trade signal quantity × multiplier
3. **Account Percentage** - Use X% of buying power

## Daily Limits

- **Max Daily Trades** - Prevent overtrading
- **Max Daily Loss** - Risk management

## Testing

### Local Testing

```bash
# Test configuration mode
FIRST_RUN=true node src/subscriber-bot.js

# Test bot mode (after configuration)
node src/subscriber-bot.js
```

### Digital Ocean Testing

1. Deploy test droplet
2. Access configuration UI
3. Complete setup
4. Verify bot connects and listens

## Email Template (Make.com)

```
Subject: 🤖 Your Trading Bot is Ready!

Hi {subscriber_name},

Thanks for subscribing to {tier_name}!

Your automated trading bot is ready to deploy:

[Deploy Your Bot] → {digital_ocean_link}

What happens next:
1. Creates your personal bot server ($6/month)
2. Opens configuration page
3. Connect your Tastytrade account
4. Select your signal channel
5. Bot starts trading automatically!

Need help? Reply to this email.

Happy trading!
```

## Channel Access Mapping

Update `config/setup-server.js` to map Discord roles to channels:

```javascript
function getChannelsForRoles(roleIds, guild) {
  const channelMap = {
    'ROLE_ID_TIER_1': [
      { id: 'CHANNEL_ID_1', name: 'Basic Signals', tier: 'Tier 1' }
    ],
    'ROLE_ID_TIER_2': [
      { id: 'CHANNEL_ID_1', name: 'Basic Signals', tier: 'Tier 1' },
      { id: 'CHANNEL_ID_2', name: 'Premium Signals', tier: 'Tier 2' }
    ],
    // etc.
  };
  
  // Return channels based on user's roles
}
```

## Signal Format

The bot recognizes signals in two formats:

### Discord Embed Format
```json
{
  "title": "TRADING SIGNAL",
  "fields": [
    { "name": "Symbol", "value": "SPY" },
    { "name": "Action", "value": "Buy" },
    { "name": "Quantity", "value": "10" },
    { "name": "Type", "value": "Market" }
  ]
}
```

### Text Format
```
SIGNAL: BUY 10 SPY
or
Trade: SELL 5 AAPL
```

## Monitoring

Each subscriber's bot:
- Logs all activity
- Tracks daily trades/losses
- Reports execution status
- Can be monitored via PM2

## Cost Structure

- **Subscriber Cost:** $6/month (Digital Ocean droplet)
- **Your Cost:** $0 (no infrastructure)
- **Revenue:** Subscription fees via QuickBooks/Stripe

## Next Steps

1. **Update Digital Ocean Manifest:**
   - Replace GitHub URL
   - Update logo/website URLs
   - Submit to marketplace

2. **Configure Make.com:**
   - Set up QuickBooks webhook
   - Map tiers to Discord roles
   - Create email template

3. **Test Deployment:**
   - Deploy test droplet
   - Complete configuration
   - Verify signal execution

4. **Go Live:**
   - Send links to subscribers
   - Monitor deployments
   - Support as needed

## Support

Subscribers can:
- Reconfigure via setup UI (delete `config/bot-config.json`)
- View logs via PM2: `pm2 logs trading-bot`
- Restart bot: `pm2 restart trading-bot`


