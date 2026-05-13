require('dotenv').config();
const TastytradeClient = require('@tastytrade/api').default;
const WebSocket = require('ws');

// Required for Node.js environment (needed for account streamer and quote streamer)
global.WebSocket = WebSocket;
global.window = { WebSocket, setTimeout, clearTimeout };

class TastytradeIntegration {
  constructor() {
    // Use SandboxConfig for testing, ProdConfig for production
    const config = process.env.TASTYTRADE_ENV === 'production' 
      ? TastytradeClient.ProdConfig 
      : TastytradeClient.SandboxConfig;

    // Initialize client with OAuth (recommended) or session-based auth
    if (process.env.TASTYTRADE_CLIENT_SECRET && process.env.TASTYTRADE_REFRESH_TOKEN) {
      // OAuth authentication
      this.client = new TastytradeClient({
        ...config,
        clientSecret: process.env.TASTYTRADE_CLIENT_SECRET,
        refreshToken: process.env.TASTYTRADE_REFRESH_TOKEN,
        oauthScopes: ['read', 'trade', 'openid'] // Match your OAuth app scopes
      });
      this.authType = 'oauth';
    } else if (process.env.TASTYTRADE_USERNAME && process.env.TASTYTRADE_PASSWORD) {
      // Session-based authentication (deprecated but still works)
      this.client = new TastytradeClient(config);
      this.authType = 'session';
    } else {
      throw new Error('Missing Tastytrade credentials. Set either OAuth (TASTYTRADE_CLIENT_SECRET, TASTYTRADE_REFRESH_TOKEN) or session (TASTYTRADE_USERNAME, TASTYTRADE_PASSWORD) credentials in .env');
    }

    this.accounts = null;
    this.isAuthenticated = false;
  }

  /**
   * Authenticate with Tastytrade
   */
  async authenticate() {
    try {
      if (this.authType === 'session') {
        await this.client.sessionService.login(
          process.env.TASTYTRADE_USERNAME,
          process.env.TASTYTRADE_PASSWORD
        );
      }
      // OAuth doesn't require explicit login - tokens are auto-refreshed
      
      this.isAuthenticated = true;
      console.log('✅ Tastytrade authenticated successfully');
      return true;
    } catch (error) {
      console.error('❌ Tastytrade authentication failed:', error.message);
      throw error;
    }
  }

  /**
   * Get customer accounts
   */
  async getAccounts() {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      this.accounts = await this.client.accountsAndCustomersService.getCustomerAccounts();
      console.log(`✅ Found ${this.accounts.length} account(s)`);
      return this.accounts;
    } catch (error) {
      console.error('❌ Failed to get accounts:', error.message);
      throw error;
    }
  }

  /**
   * Get positions for a specific account
   */
  async getPositions(accountNumber) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const positions = await this.client.balancesAndPositionsService.getPositionsList(accountNumber);
      return positions;
    } catch (error) {
      console.error(`❌ Failed to get positions for account ${accountNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Get account balances
   */
  async getBalances(accountNumber) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const balances = await this.client.balancesAndPositionsService.getAccountBalanceValues(accountNumber);
      return balances;
    } catch (error) {
      console.error(`❌ Failed to get balances for account ${accountNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Connect to quote streamer for market data
   */
  async connectQuoteStreamer() {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      await this.client.quoteStreamer.connect();
      console.log('✅ Quote streamer connected');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect quote streamer:', error.message);
      throw error;
    }
  }

  /**
   * Subscribe to market data for symbols
   */
  subscribeToQuotes(symbols) {
    if (!this.client.quoteStreamer) {
      throw new Error('Quote streamer not connected. Call connectQuoteStreamer() first.');
    }
    this.client.quoteStreamer.subscribe(symbols);
    console.log(`✅ Subscribed to quotes: ${symbols.join(', ')}`);
  }

  /**
   * Disconnect quote streamer
   */
  async disconnectQuoteStreamer() {
    try {
      await this.client.quoteStreamer.disconnect();
      console.log('✅ Quote streamer disconnected');
    } catch (error) {
      console.error('❌ Failed to disconnect quote streamer:', error.message);
    }
  }

  /**
   * Submit a dry-run order (test order without actually placing it)
   */
  async dryRunOrder(accountNumber, orderData) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      // Log the request for debugging
      console.log(`🔍 Calling dry-run for account: ${accountNumber}`);
      console.log(`📦 Order data:`, JSON.stringify(orderData, null, 2));
      
      const result = await this.client.orderService.postOrderDryRun(accountNumber, orderData);
      return result;
    } catch (error) {
      console.error(`❌ Failed to dry-run order for account ${accountNumber}:`, error.message);
      if (error.config) {
        console.error(`📍 Request URL: ${error.config.url}`);
        console.error(`📍 Request method: ${error.config.method}`);
      }
      if (error.response) {
        console.error(`📍 Response status: ${error.response.status}`);
        console.error(`📍 Response data:`, error.response.data);
      }
      throw error;
    }
  }

  /**
   * Submit a complex order (spreads, multi-leg orders)
   */
  async createComplexOrder(accountNumber, orderData) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const result = await this.client.orderService.createComplexOrder(accountNumber, orderData);
      console.log(`✅ Complex order submitted successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to create complex order for account ${accountNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Submit a simple order (single leg)
   */
  async createOrder(accountNumber, orderData) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const result = await this.client.orderService.createOrder(accountNumber, orderData);
      console.log(`✅ Order submitted successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to create order for account ${accountNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Get live orders for an account
   */
  async getLiveOrders(accountNumber) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const orders = await this.client.orderService.getLiveOrders(accountNumber);
      return orders;
    } catch (error) {
      console.error(`❌ Failed to get live orders for account ${accountNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(accountNumber, orderId) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const result = await this.client.orderService.cancelOrder(accountNumber, orderId);
      console.log(`✅ Order ${orderId} cancelled successfully`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to cancel order ${orderId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get option chain for a symbol
   */
  async getOptionChain(symbol) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const optionChain = await this.client.instrumentsService.getNestedOptionChain(symbol);
      return optionChain;
    } catch (error) {
      console.error(`❌ Failed to get option chain for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get compact option chain (lighter weight)
   */
  async getCompactOptionChain(symbol) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const optionChain = await this.client.instrumentsService.getCompactOptionChain(symbol);
      return optionChain;
    } catch (error) {
      console.error(`❌ Failed to get compact option chain for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Search for equity options by symbol
   */
  async searchEquityOptions(symbol) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const options = await this.client.instrumentsService.getEquityOptions(symbol);
      return options;
    } catch (error) {
      console.error(`❌ Failed to search equity options for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get a single equity option by symbol
   */
  async getEquityOption(symbol) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const option = await this.client.instrumentsService.getSingleEquityOption(symbol);
      return option;
    } catch (error) {
      console.error(`❌ Failed to get equity option ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Find current option symbols for a spread
   * Returns options near the provided strikes
   */
  async findCurrentOptions(symbol, expirationDate, strikes = []) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      const optionChain = await this.getOptionChain(symbol);
      
      if (!optionChain || !optionChain.items) {
        throw new Error(`No option chain found for ${symbol}`);
      }

      // Find options matching the expiration and strikes
      const matchingOptions = [];
      
      for (const item of optionChain.items) {
        if (item.expirationDate === expirationDate || !expirationDate) {
          if (item.callExpirationMap) {
            for (const [strike, callOption] of Object.entries(item.callExpirationMap)) {
              if (strikes.length === 0 || strikes.includes(parseFloat(strike))) {
                matchingOptions.push({
                  type: 'call',
                  symbol: callOption.symbol,
                  strike: parseFloat(strike),
                  expirationDate: item.expirationDate,
                  streamerSymbol: callOption['streamer-symbol'] || callOption.streamerSymbol
                });
              }
            }
          }
          if (item.putExpirationMap) {
            for (const [strike, putOption] of Object.entries(item.putExpirationMap)) {
              if (strikes.length === 0 || strikes.includes(parseFloat(strike))) {
                matchingOptions.push({
                  type: 'put',
                  symbol: putOption.symbol,
                  strike: parseFloat(strike),
                  expirationDate: item.expirationDate,
                  streamerSymbol: putOption['streamer-symbol'] || putOption.streamerSymbol
                });
              }
            }
          }
        }
      }

      return matchingOptions;
    } catch (error) {
      console.error(`❌ Failed to find current options for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Verify account access and get account details
   */
  async verifyAccount(accountNumber) {
    if (!this.isAuthenticated) {
      await this.authenticate();
    }

    try {
      // Try to get account balance as a way to verify access
      const balance = await this.getBalances(accountNumber);
      return {
        exists: true,
        accountNumber: accountNumber,
        balance: balance
      };
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        if (status === 404) {
          return {
            exists: false,
            accountNumber: accountNumber,
            error: 'Account not found (404)',
            suggestion: 'Check if the account number is correct'
          };
        } else if (status === 403) {
          return {
            exists: false,
            accountNumber: accountNumber,
            error: 'Access forbidden (403)',
            suggestion: 'This account may not be accessible with your current credentials, or you may need different permissions'
          };
        } else if (status === 401) {
          return {
            exists: false,
            accountNumber: accountNumber,
            error: 'Unauthorized (401)',
            suggestion: 'Check your authentication credentials'
          };
        }
      }
      throw error;
    }
  }
}

module.exports = TastytradeIntegration;

