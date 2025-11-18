/**
 * Latency Monitor
 * Tracks and reports latency metrics for signals and orders
 */
class LatencyMonitor {
  constructor() {
    this.metrics = [];
    this.maxMetrics = 1000; // Keep last 1000 metrics
  }

  /**
   * Track signal latency
   * @param {Object} signal - Signal object with timestamp
   * @param {string} source - Source of signal (manual, queue, etc.)
   */
  trackSignal(signal, source = 'unknown') {
    const now = Date.now();
    const tradeTime = signal.timestamp ? new Date(signal.timestamp).getTime() : now;
    const latency = now - tradeTime;

    const metric = {
      type: 'signal',
      source,
      latency,
      timestamp: now,
      signal
    };

    this.addMetric(metric);

    // Log
    const latencyStr = latency < 1000 ? `${latency}ms` : `${(latency / 1000).toFixed(2)}s`;
    console.log(`⏱️  Signal latency (${source}): ${latencyStr}`);

    // Alert if too slow
    if (latency > 5000) {
      console.warn(`⚠️  High latency detected: ${latencyStr}`);
    }

    return metric;
  }

  /**
   * Track order latency
   * @param {Object} orderItem - Order queue item
   */
  trackOrder(orderItem) {
    if (!orderItem.completedAt || !orderItem.createdAt) {
      return null;
    }

    const totalLatency = orderItem.completedAt - orderItem.createdAt;
    const processingLatency = orderItem.completedAt - (orderItem.startedAt || orderItem.createdAt);
    const queueLatency = (orderItem.startedAt || orderItem.createdAt) - orderItem.createdAt;

    const metric = {
      type: 'order',
      orderId: orderItem.id,
      totalLatency,
      processingLatency,
      queueLatency,
      priority: orderItem.priority,
      timestamp: Date.now(),
      orderItem
    };

    this.addMetric(metric);

    console.log(`⏱️  Order latency: Total=${totalLatency}ms, Queue=${queueLatency}ms, Processing=${processingLatency}ms`);

    return metric;
  }

  /**
   * Add metric to collection
   */
  addMetric(metric) {
    this.metrics.push(metric);
    
    // Keep only last N metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }
  }

  /**
   * Get latency statistics
   */
  getStats(timeWindow = 3600000) { // Default: last hour
    const now = Date.now();
    const recentMetrics = this.metrics.filter(m => now - m.timestamp < timeWindow);

    if (recentMetrics.length === 0) {
      return {
        count: 0,
        message: 'No metrics in time window'
      };
    }

    const latencies = recentMetrics.map(m => m.latency || m.totalLatency).filter(l => l !== undefined);
    
    if (latencies.length === 0) {
      return {
        count: recentMetrics.length,
        message: 'No latency data available'
      };
    }

    latencies.sort((a, b) => a - b);

    const stats = {
      count: latencies.length,
      min: latencies[0],
      max: latencies[latencies.length - 1],
      avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      median: latencies[Math.floor(latencies.length / 2)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
      p99: latencies[latencies[Math.floor(latencies.length * 0.99)]]
    };

    return stats;
  }

  /**
   * Get stats by source
   */
  getStatsBySource(timeWindow = 3600000) {
    const now = Date.now();
    const recentMetrics = this.metrics.filter(m => now - m.timestamp < timeWindow);
    
    const bySource = {};
    recentMetrics.forEach(metric => {
      const source = metric.source || 'unknown';
      if (!bySource[source]) {
        bySource[source] = [];
      }
      bySource[source].push(metric.latency || metric.totalLatency);
    });

    const stats = {};
    Object.keys(bySource).forEach(source => {
      const latencies = bySource[source].filter(l => l !== undefined).sort((a, b) => a - b);
      if (latencies.length > 0) {
        stats[source] = {
          count: latencies.length,
          min: latencies[0],
          max: latencies[latencies.length - 1],
          avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
          median: latencies[Math.floor(latencies.length / 2)]
        };
      }
    });

    return stats;
  }

  /**
   * Print statistics
   */
  printStats(timeWindow = 3600000) {
    const stats = this.getStats(timeWindow);
    const bySource = this.getStatsBySource(timeWindow);

    console.log('\n📊 Latency Statistics:');
    console.log(`   Time window: ${timeWindow / 1000}s`);
    console.log(`   Total metrics: ${stats.count}`);
    
    if (stats.count > 0) {
      console.log(`\n   Overall:`);
      console.log(`     Min: ${stats.min}ms`);
      console.log(`     Max: ${stats.max}ms`);
      console.log(`     Avg: ${Math.round(stats.avg)}ms`);
      console.log(`     Median: ${stats.median}ms`);
      console.log(`     P95: ${stats.p95}ms`);
      console.log(`     P99: ${stats.p99}ms`);
    }

    if (Object.keys(bySource).length > 0) {
      console.log(`\n   By Source:`);
      Object.keys(bySource).forEach(source => {
        const s = bySource[source];
        console.log(`     ${source}:`);
        console.log(`       Count: ${s.count}`);
        console.log(`       Avg: ${Math.round(s.avg)}ms`);
        console.log(`       Min: ${s.min}ms`);
        console.log(`       Max: ${s.max}ms`);
      });
    }
  }

  /**
   * Clear metrics
   */
  clear() {
    this.metrics = [];
  }
}

module.exports = LatencyMonitor;

