# Testing Guide

This guide covers how to test your Discord trading bot at different levels.

## Prerequisites

1. **Discord Bot Token** in `.env`:
   ```env
   DISCORD_BOT_TOKEN=your_bot_token_here
   ```

2. **Discord Intents Enabled**:
   - Go to https://discord.com/developers/applications
   - Select your bot → Bot tab
   - Enable "Message Content Intent"
   - Enable "Server Members Intent" (optional, for role checking)

3. **Bot Added to Server**:
   - Bot must be invited to your Discord server
   - Bot needs "Read Messages" and "Send Messages" permissions

---

## Test 1: Basic Discord Connection

Test if your bot can connect to Discord.

```bash
npm run test-discord
```

**Expected Output:**
```
✅ YourBot#1234 is online!
📊 Bot ID: 123456789
🏠 Connected to 1 server(s):
   - Your Server Name (server_id)
```

**If it fails:**
- Check `DISCORD_BOT_TOKEN` in `.env`
- Verify token is correct in Discord Developer Portal
- Make sure bot is invited to at least one server

---

## Test 2: Interactive Bot with Commands

Test if the bot can read and respond to messages.

```bash
npm run test-discord-bot
```

**In Discord, test these commands:**
- `!ping` - Bot should reply "🏓 Pong! Bot is working!"
- `!test` - Bot should confirm it can read messages
- `!role` - Bot should show your roles
- `!channel` - Bot should show channel info

**Expected Console Output:**
```
✅ Bot is ONLINE!
🤖 Logged in as: YourBot#1234
📊 Serving 1 server(s)
   - Your Server Name (server_id)

💡 Test commands: !ping, !test, !role
```

**If it fails:**
- Check "Message Content Intent" is enabled
- Verify bot has permission to read messages in the channel
- Check console for error messages

---

## Test 3: Message Monitoring (Full Bot)

Test the full subscriber bot with message monitoring.

### Step 1: Verify Configuration

Check your `config/bot-config.json`:
```json
{
  "channelId": "123456789012345678",  // Real Discord channel ID
  "channelName": "vip-signals"
}
```

**To get Channel ID:**
1. Enable Developer Mode in Discord (Settings → Advanced)
2. Right-click the channel → "Copy ID"

### Step 2: Start the Bot

```bash
npm run subscriber
```

**Expected Output:**
```
🚀 Starting trading bot...
🔌 Connecting to Discord...
✅ Discord connected as YourBot#1234
📡 Listening to channel: #vip-signals
✅ Trading bot is running
📡 Listening to channel: vip-signals
💼 Connected to Tastytrade account: 5WZ12077
📊 Position sizing: fixed
🛡️  Daily limits: 10 trades, $1000 loss
```

### Step 3: Test Message Monitoring

Send a message in the monitored channel (e.g., `#vip-signals`):

**Regular Message:**
```
User: "Hello bot!"
```

**Console Output:**
```
📨 [2025-11-18T15:30:45.123Z] UserName#1234 in #vip-signals:
   Hello bot!
```

**Message with Embed:**
```
User: [sends a message with embed]
```

**Console Output:**
```
📨 [2025-11-18T15:30:45.123Z] UserName#1234 in #vip-signals:
   [No text content]
   📎 1 embed(s) attached
```

---

## Test 4: Signal Detection

Test if the bot can detect and process trading signals.

### Test Signal Formats

**Text Format:**
Send in Discord channel:
```
SIGNAL: BUY 10 SPY
```
or
```
BUY 5 AAPL
```

**Console Output:**
```
📨 [2025-11-18T15:30:45.123Z] UserName#1234 in #vip-signals:
   SIGNAL: BUY 10 SPY
🎯 Signal detected: Buy to Open 10 SPY
```

**Embed Format:**
Send a Discord embed with:
- Title or description containing "SIGNAL"
- Fields: `symbol`, `action`, `quantity`

**Console Output:**
```
📨 [2025-11-18T15:30:45.123Z] UserName#1234 in #vip-signals:
   [No text content]
   📎 1 embed(s) attached
🎯 Signal detected: Buy to Open 10 SPY
```

### Supported Signal Actions

- `BUY` or `BTO` → "Buy to Open"
- `SELL` or `STO` → "Sell to Open"
- `BTC` → "Buy to Close"
- `STC` → "Sell to Close"

### Test Signal Patterns

```
SIGNAL: BUY 10 SPY
SIGNAL: SELL 5 AAPL
BUY 1 TSLA
SELL 2 MSFT
TRADE: BTO 3 NVDA
```

---

## Test 5: Full Integration Test

Test the complete flow from Discord signal to Tastytrade execution.

### Prerequisites

1. **Tastytrade credentials** configured (via setup UI or `.env`)
2. **Valid account number** in config
3. **Bot running** (`npm run subscriber`)

### Test Steps

1. **Start the bot:**
   ```bash
   npm run subscriber
   ```

2. **Send a test signal** in the monitored Discord channel:
   ```
   SIGNAL: BUY 1 SPY
   ```

3. **Watch console** for:
   - Message received log
   - Signal detected log
   - Trade execution logs
   - Order confirmation

4. **Check Tastytrade** for the order

**Note:** In sandbox mode, orders may behave differently (see `src/setup-oauth.md`)

---

## Troubleshooting

### Bot Not Connecting

```bash
# Check token
echo $DISCORD_BOT_TOKEN

# Test connection
npm run test-discord
```

### Bot Not Receiving Messages

1. Check "Message Content Intent" is enabled
2. Verify channel ID in `config/bot-config.json`
3. Ensure bot has "Read Messages" permission
4. Check bot is in the correct server

### Messages Not Logging

1. Verify you're sending messages in the correct channel
2. Check channel ID matches `config/bot-config.json`
3. Look for errors in console

### Signals Not Detected

1. Check signal format matches expected patterns
2. For embeds, ensure title/description contains "SIGNAL"
3. Verify required fields (symbol, action) are present
4. Check console for parsing errors

---

## Quick Test Checklist

- [ ] Discord bot token set in `.env`
- [ ] Message Content Intent enabled
- [ ] Bot invited to Discord server
- [ ] Bot has channel permissions
- [ ] Channel ID configured in `bot-config.json`
- [ ] Test connection: `npm run test-discord`
- [ ] Test interactive bot: `npm run test-discord-bot`
- [ ] Test full bot: `npm run subscriber`
- [ ] Send test message in channel
- [ ] Verify message appears in console
- [ ] Send test signal
- [ ] Verify signal detected

---

## Test Scripts Summary

| Script | Purpose | Command |
|--------|---------|---------|
| `test-discord` | Test basic connection | `npm run test-discord` |
| `test-discord-bot` | Test message reading/responding | `npm run test-discord-bot` |
| `subscriber` | Run full trading bot | `npm run subscriber` |

---

## Next Steps

Once testing is complete:
1. Configure Tastytrade credentials (if not done)
2. Set position sizing preferences
3. Set daily limits
4. Start monitoring for real signals

For production deployment, see `QUICK-START-SUBSCRIBER.md`.

