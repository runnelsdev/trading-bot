#!/usr/bin/env node
/**
 * Bot Manager
 * Manages all trading bots with auto-restart and heartbeat monitoring
 * 
 * Usage: node src/bot-manager.js
 */

const { spawn } = require('child_process');
const path = require('path');

// Bot configurations
const BOTS = [
  {
    name: 'Main Trading Bot',
    script: 'src/index.js',
    enabled: true,
    restartDelay: 5000,      // 5 seconds before restart
    maxRestarts: 10,         // Max restarts in restart window
    restartWindow: 300000,   // 5 minute window for counting restarts
  },
  {
    name: 'Live Fills Integration',
    script: 'src/live-fills-integration.js',
    enabled: true,
    restartDelay: 5000,
    maxRestarts: 10,
    restartWindow: 300000,
  },
  {
    name: 'Subscriber Bot',
    script: 'src/subscriber-bot.js',
    enabled: true,
    restartDelay: 5000,
    maxRestarts: 10,
    restartWindow: 300000,
  },
  {
    name: 'Fill Follower Bot',
    script: 'src/fill-follower-bot.js',
    enabled: true,
    restartDelay: 5000,
    maxRestarts: 10,
    restartWindow: 300000,
  }
];

// Bot state tracking
const botStates = new Map();

class BotManager {
  constructor() {
    this.bots = BOTS;
    this.running = false;
    this.heartbeatInterval = null;
  }

  /**
   * Start all enabled bots
   */
  start() {
    console.log('\n🚀 Starting Bot Manager...\n');
    console.log('=' .repeat(60));
    
    this.running = true;
    
    for (const bot of this.bots) {
      if (bot.enabled) {
        this.startBot(bot);
      } else {
        console.log(`⏸️  ${bot.name} is disabled`);
      }
    }
    
    // Start heartbeat monitoring
    this.startHeartbeat();
    
    console.log('=' .repeat(60));
    console.log('\n✅ Bot Manager running. Press Ctrl+C to stop all bots.\n');
  }

  /**
   * Start a single bot
   */
  startBot(bot) {
    const scriptPath = path.join(process.cwd(), bot.script);
    
    console.log(`\n🔄 Starting ${bot.name}...`);
    console.log(`   Script: ${bot.script}`);
    
    // Initialize state if not exists
    if (!botStates.has(bot.name)) {
      botStates.set(bot.name, {
        process: null,
        restarts: [],
        status: 'stopped',
        lastStart: null,
        lastError: null
      });
    }
    
    const state = botStates.get(bot.name);
    
    // Check restart limit
    const now = Date.now();
    state.restarts = state.restarts.filter(t => now - t < bot.restartWindow);
    
    if (state.restarts.length >= bot.maxRestarts) {
      console.error(`❌ ${bot.name} has exceeded max restarts (${bot.maxRestarts} in ${bot.restartWindow/1000}s)`);
      console.error(`   Last error: ${state.lastError}`);
      state.status = 'crashed';
      return;
    }
    
    // Spawn the bot process
    const proc = spawn('node', [scriptPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '1' }
    });
    
    state.process = proc;
    state.status = 'running';
    state.lastStart = now;
    state.restarts.push(now);
    
    // Handle stdout
    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => {
        console.log(`[${bot.name}] ${line}`);
      });
    });
    
    // Handle stderr
    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(l => l.trim());
      lines.forEach(line => {
        // Skip deprecation warnings
        if (line.includes('DeprecationWarning') || line.includes('--trace-deprecation')) {
          return;
        }
        console.error(`[${bot.name}] ⚠️  ${line}`);
      });
    });
    
    // Handle exit
    proc.on('exit', (code, signal) => {
      state.status = 'stopped';
      state.process = null;
      
      if (code !== 0 && code !== null) {
        state.lastError = `Exit code ${code}`;
        console.error(`\n❌ ${bot.name} crashed with code ${code}`);
      } else if (signal) {
        state.lastError = `Signal ${signal}`;
        console.log(`\n🛑 ${bot.name} killed by signal ${signal}`);
      } else {
        console.log(`\n⏹️  ${bot.name} stopped`);
      }
      
      // Auto-restart if manager is still running
      if (this.running && bot.enabled) {
        console.log(`🔄 Restarting ${bot.name} in ${bot.restartDelay/1000}s...`);
        setTimeout(() => {
          if (this.running) {
            this.startBot(bot);
          }
        }, bot.restartDelay);
      }
    });
    
    // Handle errors
    proc.on('error', (err) => {
      state.lastError = err.message;
      state.status = 'error';
      console.error(`\n❌ ${bot.name} error: ${err.message}`);
    });
    
    console.log(`   PID: ${proc.pid}`);
  }

  /**
   * Start heartbeat monitoring
   */
  startHeartbeat() {
    const HEARTBEAT_INTERVAL = 30000; // 30 seconds
    
    this.heartbeatInterval = setInterval(() => {
      this.checkBotHealth();
    }, HEARTBEAT_INTERVAL);
    
    console.log(`\n💓 Heartbeat monitoring started (every ${HEARTBEAT_INTERVAL/1000}s)`);
  }

  /**
   * Check health of all bots
   */
  checkBotHealth() {
    const now = new Date().toLocaleTimeString();
    let allHealthy = true;
    
    console.log(`\n💓 [${now}] Health Check:`);
    
    for (const bot of this.bots) {
      if (!bot.enabled) continue;
      
      const state = botStates.get(bot.name);
      if (!state) continue;
      
      const status = state.status;
      const pid = state.process?.pid || 'N/A';
      const uptime = state.lastStart ? Math.floor((Date.now() - state.lastStart) / 1000) : 0;
      
      let statusIcon;
      switch (status) {
        case 'running':
          statusIcon = '✅';
          break;
        case 'stopped':
          statusIcon = '⏹️';
          allHealthy = false;
          break;
        case 'crashed':
          statusIcon = '💀';
          allHealthy = false;
          break;
        case 'error':
          statusIcon = '❌';
          allHealthy = false;
          break;
        default:
          statusIcon = '❓';
      }
      
      console.log(`   ${statusIcon} ${bot.name}: ${status} (PID: ${pid}, uptime: ${uptime}s)`);
      
      // If process exists but not responding, check if it's a zombie
      if (state.process && status === 'running') {
        try {
          // Send signal 0 to check if process is alive
          process.kill(state.process.pid, 0);
        } catch (e) {
          console.log(`   ⚠️  ${bot.name} process not responding, marking for restart`);
          state.status = 'stopped';
          state.process = null;
          allHealthy = false;
        }
      }
    }
    
    if (allHealthy) {
      console.log(`   ✅ All bots healthy`);
    }
  }

  /**
   * Stop all bots
   */
  stop() {
    console.log('\n🛑 Stopping all bots...\n');
    this.running = false;
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    for (const bot of this.bots) {
      const state = botStates.get(bot.name);
      if (state?.process) {
        console.log(`   Stopping ${bot.name} (PID: ${state.process.pid})`);
        state.process.kill('SIGTERM');
      }
    }
    
    // Force kill after 5 seconds
    setTimeout(() => {
      for (const bot of this.bots) {
        const state = botStates.get(bot.name);
        if (state?.process) {
          console.log(`   Force killing ${bot.name}`);
          state.process.kill('SIGKILL');
        }
      }
      console.log('\n👋 Bot Manager stopped\n');
      process.exit(0);
    }, 5000);
  }

  /**
   * Get status of all bots
   */
  getStatus() {
    const status = {};
    
    for (const bot of this.bots) {
      const state = botStates.get(bot.name) || {};
      status[bot.name] = {
        enabled: bot.enabled,
        status: state.status || 'unknown',
        pid: state.process?.pid || null,
        uptime: state.lastStart ? Date.now() - state.lastStart : 0,
        restarts: state.restarts?.length || 0,
        lastError: state.lastError
      };
    }
    
    return status;
  }
}

// Create and start manager
const manager = new BotManager();

// Handle shutdown signals
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Received SIGINT');
  manager.stop();
});

process.on('SIGTERM', () => {
  console.log('\n\n⚠️  Received SIGTERM');
  manager.stop();
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('\n❌ Uncaught exception in Bot Manager:', err);
  // Don't exit - try to keep managing bots
});

process.on('unhandledRejection', (reason) => {
  console.error('\n❌ Unhandled rejection in Bot Manager:', reason);
  // Don't exit - try to keep managing bots
});

// Start the manager
manager.start();

// Export for programmatic use
module.exports = BotManager;




