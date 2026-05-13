# Tastytrade OAuth Setup Guide

## Sandbox Environment Setup

### Step 1: Get Your OAuth Credentials

1. Log in to the Tastytrade Sandbox: https://api.cert.tastyworks.com
2. Navigate to your OAuth2 Application (you're already logged in as david.runnels@gmail.com)
3. **Regenerate Secret**: Click "Regenerate Secret" to get your `CLIENT_SECRET` (save it immediately - it's only shown once!)
4. **Create Grant**: Click "Create Grant" to get your `REFRESH_TOKEN`

### Step 2: Update Your .env File

Add these to your `.env` file:

```env
# Tastytrade Sandbox OAuth Configuration
TASTYTRADE_ENV=sandbox
TASTYTRADE_CLIENT_SECRET=your_client_secret_here
TASTYTRADE_REFRESH_TOKEN=your_refresh_token_here
```

**OR** if you prefer session-based auth (deprecated but works):

```env
TASTYTRADE_ENV=sandbox
TASTYTRADE_USERNAME=your_sandbox_username
TASTYTRADE_PASSWORD=your_sandbox_password
```

### Step 3: Your OAuth App Details

- **Client ID**: `58f2bedd-c3e2-4bc6-8152-4d0ccac63b98`
- **Scopes**: `read`, `trade`, `openid`
- **Base URL**: `https://api.cert.tastyworks.com`
- **WebSocket URL**: `streamer.cert.tastyworks.com`

## Sandbox Limitations

⚠️ **Important**: The following services are NOT available in sandbox:
- Symbol search
- Net liquidating value history
- Market metrics
- Market data (quote streamer)

This means:
- `find-options.js` may not work (uses option chains which might work)
- Quote streamer functionality is disabled
- Some helper functions may return errors

## Sandbox Order Behavior

Orders in sandbox behave differently:
- **Market orders**: Always fill at $1
- **Limit orders ≤ $3**: Fill immediately
- **Limit orders ≥ $3**: Stay Live and never fill

## Testing Your Setup

Once you have your credentials:

```bash
# Test authentication
node src/test-tastytrade.js

# Verify account access
node src/verify-account.js YOUR_ACCOUNT_NUMBER

# Test order submission (dry-run)
node src/test-order.js
```

## Getting a Refresh Token

The refresh token is obtained by creating an OAuth grant. The process typically involves:
1. Clicking "Create Grant" in your OAuth app settings
2. The system will provide you with a refresh token
3. Save this token securely - you'll need it for API access

If you need help with the OAuth flow, check the Tastytrade API documentation or contact api.support@tastytrade.com

