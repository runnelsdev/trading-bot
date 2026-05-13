/**
 * Order Queue Configuration Profiles
 * Choose based on your latency vs safety requirements
 */

module.exports = {
  // AGGRESSIVE (lowest latency)
  aggressive: {
    maxConcurrentOrders: 5,        // Execute 5 at once
    delayBetweenOrders: 0,          // No delay
    maxOrdersPerMinute: 30,         // Higher rate limit
    enableRiskChecks: false,        // Skip checks
    enableApprovalWorkflow: false,  // Auto-approve
    enableDryRunValidation: true,   // NEW: Validate with dry run (adds ~200ms but prevents failures)
    priorityThreshold: 5            // Priority orders jump queue if priority >= this
  },

  // BALANCED (recommended)
  balanced: {
    maxConcurrentOrders: 2,        
    delayBetweenOrders: 500,        // 500ms between
    maxOrdersPerMinute: 20,         
    enableRiskChecks: true,         // Safety first
    enableApprovalWorkflow: false,
    enableDryRunValidation: true,   // NEW: Validate with dry run (recommended)
    priorityThreshold: 7            // Higher priority needed to jump
  },

  // CONSERVATIVE (safest)
  conservative: {
    maxConcurrentOrders: 1,        
    delayBetweenOrders: 2000,       // 2s between
    maxOrdersPerMinute: 10,         
    enableRiskChecks: true,         
    enableApprovalWorkflow: true,   // Manual approval
    enableDryRunValidation: true,   // NEW: Always validate
    priorityThreshold: 10           // Only highest priority jumps
  }
};

