# Update Sidecar Service

A sidecar process that automatically checks for updates every 24 hours and updates the application.

## Features

- ✅ **Automatic Git Updates** - Pulls latest code from repository
- ✅ **Automatic NPM Updates** - Updates package dependencies
- ✅ **Auto-Restart** - Restarts application after updates
- ✅ **PM2 Integration** - Detects and uses PM2 for restarts
- ✅ **Logging** - Comprehensive logging to file
- ✅ **Configurable** - Environment variables for customization

## Quick Start

### Option 1: Standalone Process

```bash
# Start the sidecar
npm run update-sidecar

# Or directly
node src/update-sidecar.js
```

### Option 2: PM2 (Recommended for Production)

```bash
# Install PM2 globally (if not already installed)
npm install -g pm2

# Start sidecar with PM2
npm run update-sidecar:pm2

# Or manually
pm2 start src/update-sidecar.js --name update-sidecar --no-autorestart
```

### Option 3: Systemd Service (Linux)

Create `/etc/systemd/system/trading-bot-update.service`:

```ini
[Unit]
Description=Trading Bot Update Sidecar
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/trading-bot
ExecStart=/usr/bin/node /path/to/trading-bot/src/update-sidecar.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable trading-bot-update
sudo systemctl start trading-bot-update
```

## Configuration

### Environment Variables

Add to your `.env` file:

```env
# Update check interval (milliseconds)
# Default: 24 hours (86400000)
UPDATE_CHECK_INTERVAL=86400000

# Enable/disable git updates
# Default: true
ENABLE_GIT_UPDATES=true

# Enable/disable npm updates
# Default: true
ENABLE_NPM_UPDATES=true

# Enable/disable auto-restart after updates
# Default: true
AUTO_RESTART=true
```

### Custom Interval Examples

```env
# Check every 12 hours
UPDATE_CHECK_INTERVAL=43200000

# Check every 6 hours
UPDATE_CHECK_INTERVAL=21600000

# Check every hour (for testing)
UPDATE_CHECK_INTERVAL=3600000
```

## How It Works

1. **Initial Check** - Performs update check immediately on start
2. **Periodic Checks** - Checks every 24 hours (configurable)
3. **Git Updates** - Fetches and pulls latest code if available
4. **NPM Updates** - Updates outdated packages
5. **Auto-Restart** - Restarts application via PM2 or npm script

## Logs

Logs are written to:
- **File**: `logs/update-sidecar.log`
- **Console**: Real-time output

Example log entry:
```
[2025-11-17T12:00:00.000Z] [INFO] === Starting update check ===
[2025-11-17T12:00:00.100Z] [INFO] Checking for git updates...
[2025-11-17T12:00:00.500Z] [INFO] Git: New commits available: Fix latency issue
[2025-11-17T12:00:00.600Z] [INFO] NPM: No npm updates available
[2025-11-17T12:00:01.000Z] [INFO] Updates available! Applying...
[2025-11-17T12:00:02.000Z] [INFO] Git updates applied successfully
[2025-11-17T12:00:02.100Z] [INFO] Restarting application...
[2025-11-17T12:00:03.000Z] [INFO] Application restarted via PM2
[2025-11-17T12:00:03.100Z] [INFO] === Update check complete ===
```

## PM2 Integration

If you're using PM2 for your main application:

```bash
# Start main bot
pm2 start src/index.js --name trading-bot

# Start update sidecar
pm2 start src/update-sidecar.js --name update-sidecar --no-autorestart

# View all processes
pm2 list

# View logs
pm2 logs update-sidecar
```

The sidecar will automatically detect PM2 and use it for restarts.

## Manual Update Check

You can trigger a manual update check:

```bash
# If running with PM2
pm2 sendSignal SIGUSR1 update-sidecar

# Or restart the sidecar
pm2 restart update-sidecar
```

## Safety Features

- **No updates during active processing** - Won't update if already updating
- **Error handling** - Continues running even if update fails
- **Logging** - All actions are logged for debugging
- **Graceful shutdown** - Handles SIGINT/SIGTERM properly

## Troubleshooting

### Sidecar not detecting updates

1. Check git remote is configured:
   ```bash
   git remote -v
   ```

2. Check you're on the correct branch:
   ```bash
   git branch
   ```

3. Check logs:
   ```bash
   tail -f logs/update-sidecar.log
   ```

### PM2 restart not working

1. Ensure PM2 is installed:
   ```bash
   npm install -g pm2
   ```

2. Check PM2 process name matches:
   ```bash
   pm2 list
   # Should see "trading-bot" process
   ```

3. Manually restart:
   ```bash
   pm2 restart trading-bot
   ```

### NPM updates failing

1. Check package.json is valid
2. Check npm permissions
3. Review logs for specific error messages

## Status Check

The sidecar logs its status on startup:

```
🚀 Update Sidecar Service starting...
Check interval: 24 hours
Git updates: enabled
NPM updates: enabled
Auto-restart: enabled
✅ Update Sidecar Service running
```

## Best Practices

1. **Use PM2** - Best for production deployments
2. **Monitor logs** - Check logs regularly for issues
3. **Test updates** - Test in staging before production
4. **Backup before updates** - Always have a rollback plan
5. **Set appropriate interval** - 24 hours is good for most cases

## Integration with Main Application

The sidecar runs independently and doesn't interfere with the main application. It:
- Runs in a separate process
- Only restarts the main app when updates are found
- Logs all actions for debugging
- Handles errors gracefully

## Example: Full Production Setup

```bash
# 1. Start main trading bot
pm2 start src/index.js --name trading-bot

# 2. Start update sidecar
pm2 start src/update-sidecar.js --name update-sidecar --no-autorestart

# 3. Save PM2 configuration
pm2 save

# 4. Setup PM2 startup script
pm2 startup

# 5. Monitor both processes
pm2 monit
```

Both processes will now:
- Start automatically on system boot
- Run independently
- Update and restart automatically
- Log all activity


