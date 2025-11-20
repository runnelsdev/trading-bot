# Sandbox Account Creation Issue

## Current Status

The account creation endpoint is currently unavailable. You received this error:
```
This endpoint is currently unavailable. 
Unique customer support identifier: c485a5aa21ab1be0ad233fe7a0ba5aae
```

## What to Do

### Option 1: Contact Support (Recommended)
1. Email: **api.support@tastytrade.com**
2. Include the support identifier: `c485a5aa21ab1be0ad233fe7a0ba5aae`
3. Mention you're trying to create a sandbox test account
4. They should be able to help you create an account or fix the endpoint

### Option 2: Wait and Retry
- The endpoint may be temporarily down for maintenance
- Try again later (the sandbox environment sometimes has issues)
- Check the Tastytrade API status page if available

### Option 3: Check for Existing Accounts
Even if you haven't created accounts, sometimes sandbox accounts are pre-created. Try:

```bash
# Check what accounts are available
node src/test-tastytrade.js

# Or verify a specific account format
node src/verify-account.js 5WT00000
```

## Account Number Format

Sandbox accounts typically follow patterns like:
- `5WT00000`
- `5WT00001`
- `5WT0001`
- etc.

## Workaround: Testing Without Accounts

While waiting for account creation, you can still:
1. ✅ Test authentication (this works)
2. ✅ Test API connectivity
3. ❌ Cannot test orders (need an account)
4. ❌ Cannot test positions/balances (need an account)

## Next Steps Once Account is Created

Once you have an account:

1. **Verify the account:**
   ```bash
   node src/verify-account.js YOUR_ACCOUNT_NUMBER
   ```

2. **Test order submission:**
   ```bash
   node src/test-order.js
   ```

3. **Check account details:**
   ```bash
   node src/test-tastytrade.js
   ```

## Support Contact

- **Email**: api.support@tastytrade.com
- **Support ID**: c485a5aa21ab1be0ad233fe7a0ba5aae
- **Issue**: Sandbox account creation endpoint unavailable

