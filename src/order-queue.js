require('dotenv').config();
const TastytradeIntegration = require('./tastytrade-client');

/**
 * Order Queue Manager
 * Manages order execution with rate limiting, priority, and concurrency control
 */
class OrderQueueManager {
  constructor(tastytradeClient, accountNumber, config = {}) {
    this.client = tastytradeClient;
    this.accountNumber = accountNumber;
    
    // Default to balanced config
    this.config = {
      maxConcurrentOrders: config.maxConcurrentOrders || 2,
      delayBetweenOrders: config.delayBetweenOrders || 500,
      maxOrdersPerMinute: config.maxOrdersPerMinute || 20,
      enableRiskChecks: config.enableRiskChecks !== false,
      enableApprovalWorkflow: config.enableApprovalWorkflow || false,
      enableDryRunValidation: config.enableDryRunValidation !== false, // NEW: Default enabled
      priorityThreshold: config.priorityThreshold || 7
    };

    // Queue state
    this.queue = [];
    this.processing = false;
    this.activeOrders = 0;
    this.ordersThisMinute = 0;
    this.dryRunsThisMinute = 0; // NEW: Track dry runs separately
    this.lastMinuteReset = Date.now();
    
    // Event handlers
    this.onOrderComplete = null;
    this.onOrderError = null;
    this.onQueueUpdate = null;
  }

  /**
   * Add order to queue
   * @param {Object} orderData - Order data for Tastytrade API or bracket strategy
   * @param {Object} options - Queue options
   * @param {number} options.priority - Priority (0-10, higher = more urgent)
   * @param {Date|string} options.scheduledFor - Schedule order for specific time
   * @param {boolean} options.dryRun - Test order without placing
   * @param {boolean} options.skipValidation - Skip dry-run validation
   * @returns {Promise} Order result
   */
  async queueOrder(orderData, options = {}) {
    const {
      priority = 0,
      scheduledFor = null,
      dryRun = false,
      skipValidation = false
    } = options;

    // NEW: Detect bracket strategy and convert to OTOCO
    let finalOrderData = orderData;
    if (this.isBracketStrategy(orderData)) {
      console.log('🎯 Detected bracket strategy - converting to OTOCO');
      finalOrderData = this.convertToOTOCO(orderData);
    }

    // NEW: Validate order with dry run (if enabled)
    if (this.config.enableDryRunValidation && !dryRun && !skipValidation) {
      const validation = await this.validateOrder(finalOrderData);
      if (!validation.valid) {
        const error = new Error(`Order validation failed: ${validation.errors.join(', ')}`);
        return Promise.reject(error);
      }
      // Store estimated fees
      if (validation.estimatedFees) {
        finalOrderData.estimatedFees = validation.estimatedFees;
      }
    }

    const queueItem = {
      id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      orderData: finalOrderData,
      originalOrderData: orderData, // Keep original for reference
      priority,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      dryRun,
      status: 'queued',
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      validation: null
    };

    // Insert based on priority
    this.insertByPriority(queueItem);
    
    this.emitQueueUpdate();
    this.processQueue();

    // Return promise that resolves when order completes
    return new Promise((resolve, reject) => {
      queueItem.resolve = resolve;
      queueItem.reject = reject;
    });
  }

  /**
   * NEW: Validate order with dry run
   */
  async validateOrder(orderData) {
    const errors = [];

    // Basic validation
    if (!orderData['underlying-symbol'] && !orderData.symbol) {
      errors.push('Symbol required');
    }
    if (!orderData.size || orderData.size <= 0) {
      errors.push('Valid quantity required');
    }
    if (!orderData.legs || orderData.legs.length === 0) {
      errors.push('Order legs required');
    }

    // Dry run validation
    if (this.config.enableDryRunValidation) {
      try {
        const dryRunResult = await this.client.dryRunOrder(this.accountNumber, orderData);
        
        // Check buying power
        if (dryRunResult.data && dryRunResult.data['buying-power-effect']) {
          const bpEffect = dryRunResult.data['buying-power-effect'];
          const newBP = parseFloat(bpEffect['new-buying-power'] || 0);
          
          if (newBP < 0) {
            errors.push('Insufficient buying power');
          }
        }

        // Store fees for later
        if (dryRunResult.data && dryRunResult.data['fee-calculation']) {
          return {
            valid: errors.length === 0,
            errors,
            estimatedFees: dryRunResult.data['fee-calculation']
          };
        }
      } catch (error) {
        errors.push(`Validation failed: ${error.message}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * NEW: Check if order is a bracket strategy
   */
  isBracketStrategy(order) {
    // Check if user provided entry + exit orders
    return order.entry && (order.takeProfit || order.stopLoss);
  }

  /**
   * NEW: Convert bracket strategy to OTOCO (One-Triggers-OCO)
   */
  convertToOTOCO(order) {
    const entry = order.entry;
    const exitOrders = [];

    if (order.takeProfit) {
      exitOrders.push({
        ...order.takeProfit,
        action: order.takeProfit.action || 'Sell to Close'
      });
    }

    if (order.stopLoss) {
      exitOrders.push({
        ...order.stopLoss,
        action: order.stopLoss.action || 'Sell to Close'
      });
    }

    // Build OTOCO structure for Tastytrade
    // Note: This is a simplified version - actual OTOCO format may vary
    return {
      'order-type': 'OTOCO',
      'time-in-force': entry['time-in-force'] || 'Day',
      'trigger-order': {
        ...entry,
        'order-type': entry['order-type'] || 'Market'
      },
      'orders': exitOrders.map(exit => ({
        ...exit,
        'order-type': exit['order-type'] || 'Limit'
      }))
    };
  }

  /**
   * Insert order into queue maintaining priority order
   */
  insertByPriority(item) {
    if (item.priority >= this.config.priorityThreshold) {
      // High priority - insert at front
      this.queue.unshift(item);
    } else {
      // Find insertion point based on priority
      let insertIndex = this.queue.length;
      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i].priority < item.priority) {
          insertIndex = i;
          break;
        }
      }
      this.queue.splice(insertIndex, 0, item);
    }
  }

  /**
   * Process queue
   */
  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0 && this.activeOrders < this.config.maxConcurrentOrders) {
      // Check rate limit
      this.resetRateLimitIfNeeded();
      if (this.ordersThisMinute >= this.config.maxOrdersPerMinute) {
        const waitTime = 60000 - (Date.now() - this.lastMinuteReset);
        console.log(`⏳ Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s...`);
        await this.sleep(waitTime);
        continue;
      }

      // Get next order
      const item = this.queue.shift();
      
      // Check if scheduled
      if (item.scheduledFor && item.scheduledFor > new Date()) {
        // Re-insert and wait
        this.insertByPriority(item);
        const waitTime = item.scheduledFor.getTime() - Date.now();
        console.log(`⏰ Order scheduled for ${item.scheduledFor.toISOString()}. Waiting...`);
        await this.sleep(Math.min(waitTime, 60000)); // Check every minute
        continue;
      }

      // Execute order
      this.executeOrder(item);
    }

    this.processing = false;
    this.emitQueueUpdate();
  }

  /**
   * Execute a single order
   */
  async executeOrder(item) {
    this.activeOrders++;
    this.ordersThisMinute++;
    item.status = 'processing';
    item.startedAt = new Date();

    try {
      // Risk checks
      if (this.config.enableRiskChecks) {
        const riskCheck = await this.performRiskChecks(item.orderData);
        if (!riskCheck.passed) {
          throw new Error(`Risk check failed: ${riskCheck.reason}`);
        }
      }

      // Approval workflow
      if (this.config.enableApprovalWorkflow) {
        const approved = await this.requestApproval(item);
        if (!approved) {
          throw new Error('Order not approved');
        }
      }

      // Execute order
      let result;
      if (item.dryRun) {
        result = await this.client.dryRunOrder(this.accountNumber, item.orderData);
      } else {
        // Determine if complex or simple order
        const isComplex = item.orderData.legs && item.orderData.legs.length > 1;
        if (isComplex) {
          result = await this.client.createComplexOrder(this.accountNumber, item.orderData);
        } else {
          result = await this.client.createOrder(this.accountNumber, item.orderData);
        }
      }

      item.status = 'completed';
      item.completedAt = new Date();
      item.result = result;

      // Calculate latency
      const latency = item.completedAt - item.createdAt;
      console.log(`✅ Order ${item.id} completed in ${latency}ms`);

      if (this.onOrderComplete) {
        this.onOrderComplete(item, result);
      }

      if (item.resolve) {
        item.resolve(result);
      }

    } catch (error) {
      item.status = 'failed';
      item.completedAt = new Date();
      item.error = error.message;

      console.error(`❌ Order ${item.id} failed: ${error.message}`);

      if (this.onOrderError) {
        this.onOrderError(item, error);
      }

      if (item.reject) {
        item.reject(error);
      }
    } finally {
      this.activeOrders--;
      
      // Delay before next order
      if (this.config.delayBetweenOrders > 0) {
        await this.sleep(this.config.delayBetweenOrders);
      }

      // Continue processing
      this.processQueue();
    }
  }

  /**
   * Perform risk checks on order
   */
  async performRiskChecks(orderData) {
    // TODO: Implement risk checks
    // - Check account balance
    // - Check position limits
    // - Check daily loss limits
    // - etc.
    return { passed: true };
  }

  /**
   * Request approval for order
   */
  async requestApproval(item) {
    // TODO: Implement approval workflow
    // - Send to Discord channel
    // - Wait for approval
    // - Timeout after X minutes
    return true; // Auto-approve for now
  }

  /**
   * Reset rate limit counter if needed
   */
  resetRateLimitIfNeeded() {
    const now = Date.now();
    if (now - this.lastMinuteReset >= 60000) {
      this.ordersThisMinute = 0;
      this.dryRunsThisMinute = 0; // NEW: Reset dry run counter
      this.lastMinuteReset = now;
    }
  }

  /**
   * NEW: Validate multiple orders efficiently
   * Dry runs don't count against execution limits
   */
  async validateMany(orders) {
    const validations = await Promise.all(
      orders.map(async (order) => {
        try {
          const validation = await this.validateOrder(order);
          this.dryRunsThisMinute++; // Track but don't limit
          return { order, validation };
        } catch (error) {
          return { order, validation: { valid: false, errors: [error.message] } };
        }
      })
    );

    // Return only valid orders
    return validations
      .filter(v => v.validation.valid)
      .map(v => v.order);
  }

  /**
   * Get queue status
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      activeOrders: this.activeOrders,
      ordersThisMinute: this.ordersThisMinute,
      dryRunsThisMinute: this.dryRunsThisMinute, // NEW
      maxOrdersPerMinute: this.config.maxOrdersPerMinute,
      processing: this.processing,
      enableDryRunValidation: this.config.enableDryRunValidation // NEW
    };
  }

  /**
   * Clear queue
   */
  clearQueue() {
    this.queue.forEach(item => {
      if (item.reject) {
        item.reject(new Error('Queue cleared'));
      }
    });
    this.queue = [];
    this.emitQueueUpdate();
  }

  /**
   * Emit queue update event
   */
  emitQueueUpdate() {
    if (this.onQueueUpdate) {
      this.onQueueUpdate(this.getStatus());
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = OrderQueueManager;

