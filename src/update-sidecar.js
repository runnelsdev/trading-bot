#!/usr/bin/env node

/**
 * Update Sidecar Service
 * Checks for updates every 24 hours and automatically updates the application
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class UpdateSidecar {
  constructor(options = {}) {
    this.checkInterval = options.checkInterval || 24 * 60 * 60 * 1000; // 24 hours
    this.enableGitUpdates = options.enableGitUpdates !== false;
    this.enableNpmUpdates = options.enableNpmUpdates !== false;
    this.autoRestart = options.autoRestart !== false;
    this.logFile = options.logFile || path.join(__dirname, '../logs/update-sidecar.log');
    this.pidFile = options.pidFile || path.join(__dirname, '../logs/update-sidecar.pid');
    
    this.isUpdating = false;
    this.lastCheck = null;
    this.updateTimer = null;
    
    // Ensure logs directory exists
    this.ensureLogsDirectory();
  }

  /**
   * Ensure logs directory exists
   */
  ensureLogsDirectory() {
    const logsDir = path.dirname(this.logFile);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  }

  /**
   * Log message with timestamp
   */
  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    
    // Console output
    console.log(logMessage.trim());
    
    // File output
    try {
      fs.appendFileSync(this.logFile, logMessage);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  /**
   * Check if running in git repository
   */
  isGitRepo() {
    try {
      execSync('git rev-parse --git-dir', { stdio: 'ignore', cwd: process.cwd() });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check for git updates
   */
  async checkGitUpdates() {
    if (!this.enableGitUpdates || !this.isGitRepo()) {
      return { hasUpdates: false, message: 'Git updates disabled or not a git repo' };
    }

    try {
      this.log('Checking for git updates...');
      
      // Fetch latest changes
      execSync('git fetch origin', { 
        stdio: 'pipe',
        cwd: process.cwd()
      });

      // Check if there are updates
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf8',
        cwd: process.cwd()
      }).trim();

      const localCommit = execSync('git rev-parse HEAD', {
        encoding: 'utf8',
        cwd: process.cwd()
      }).trim();

      const remoteCommit = execSync(`git rev-parse origin/${currentBranch}`, {
        encoding: 'utf8',
        cwd: process.cwd()
      }).trim();

      if (localCommit !== remoteCommit) {
        const commitMessage = execSync(`git log -1 --pretty=format:"%s" origin/${currentBranch}`, {
          encoding: 'utf8',
          cwd: process.cwd()
        }).trim();

        return {
          hasUpdates: true,
          message: `New commits available: ${commitMessage}`,
          localCommit,
          remoteCommit
        };
      }

      return { hasUpdates: false, message: 'No git updates available' };
    } catch (error) {
      this.log(`Error checking git updates: ${error.message}`, 'ERROR');
      return { hasUpdates: false, message: `Error: ${error.message}` };
    }
  }

  /**
   * Apply git updates
   */
  async applyGitUpdates() {
    try {
      this.log('Applying git updates...');
      
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf8',
        cwd: process.cwd()
      }).trim();

      // Pull latest changes
      const output = execSync(`git pull origin ${currentBranch}`, {
        encoding: 'utf8',
        cwd: process.cwd()
      });

      this.log(`Git pull output: ${output.trim()}`);
      return { success: true, message: 'Git updates applied successfully' };
    } catch (error) {
      this.log(`Error applying git updates: ${error.message}`, 'ERROR');
      return { success: false, message: error.message };
    }
  }

  /**
   * Check for npm package updates
   */
  async checkNpmUpdates() {
    if (!this.enableNpmUpdates) {
      return { hasUpdates: false, message: 'NPM updates disabled' };
    }

    try {
      this.log('Checking for npm package updates...');
      
      // Check outdated packages
      const output = execSync('npm outdated --json', {
        encoding: 'utf8',
        cwd: process.cwd(),
        stdio: 'pipe'
      });

      const outdated = JSON.parse(output);
      const packageCount = Object.keys(outdated).length;

      if (packageCount > 0) {
        const packages = Object.keys(outdated).map(pkg => {
          const info = outdated[pkg];
          return `${pkg}: ${info.current} → ${info.latest}`;
        });

        return {
          hasUpdates: true,
          message: `${packageCount} package(s) have updates available`,
          packages: packages
        };
      }

      return { hasUpdates: false, message: 'No npm updates available' };
    } catch (error) {
      // npm outdated returns non-zero exit code when packages are outdated
      if (error.status === 1 && error.stdout) {
        try {
          const outdated = JSON.parse(error.stdout);
          const packageCount = Object.keys(outdated).length;
          
          if (packageCount > 0) {
            const packages = Object.keys(outdated).map(pkg => {
              const info = outdated[pkg];
              return `${pkg}: ${info.current} → ${info.latest}`;
            });

            return {
              hasUpdates: true,
              message: `${packageCount} package(s) have updates available`,
              packages: packages
            };
          }
        } catch {
          // Ignore parse errors
        }
      }
      
      return { hasUpdates: false, message: 'No npm updates available' };
    }
  }

  /**
   * Apply npm updates
   */
  async applyNpmUpdates() {
    try {
      this.log('Applying npm updates...');
      
      // Update packages
      const output = execSync('npm update', {
        encoding: 'utf8',
        cwd: process.cwd(),
        stdio: 'pipe'
      });

      this.log('NPM updates applied successfully');
      return { success: true, message: 'NPM updates applied successfully' };
    } catch (error) {
      this.log(`Error applying npm updates: ${error.message}`, 'ERROR');
      return { success: false, message: error.message };
    }
  }

  /**
   * Restart the main application
   */
  async restartApplication() {
    if (!this.autoRestart) {
      this.log('Auto-restart disabled. Manual restart required.');
      return;
    }

    try {
      this.log('Restarting application...');
      
      // Check if running with PM2
      try {
        const pm2List = execSync('pm2 list', { encoding: 'utf8', stdio: 'pipe' });
        if (pm2List.includes('trading-bot')) {
          this.log('Detected PM2 - restarting via PM2...');
          execSync('pm2 restart trading-bot', { stdio: 'inherit' });
          this.log('Application restarted via PM2');
          return;
        }
      } catch {
        // PM2 not available or not running
      }

      // Check if there's a restart script
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      if (packageJson.scripts && packageJson.scripts.restart) {
        this.log('Using npm restart script...');
        spawn('npm', ['run', 'restart'], {
          detached: true,
          stdio: 'inherit'
        });
        return;
      }

      this.log('⚠️  No restart method found. Please restart manually.');
    } catch (error) {
      this.log(`Error restarting application: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Perform update check and apply updates
   */
  async performUpdateCheck() {
    if (this.isUpdating) {
      this.log('Update already in progress, skipping...');
      return;
    }

    this.isUpdating = true;
    this.lastCheck = new Date();

    try {
      this.log('=== Starting update check ===');

      let hasUpdates = false;
      const updates = [];

      // Check git updates
      if (this.enableGitUpdates) {
        const gitCheck = await this.checkGitUpdates();
        if (gitCheck.hasUpdates) {
          hasUpdates = true;
          updates.push('git');
          this.log(`Git: ${gitCheck.message}`);
        } else {
          this.log(`Git: ${gitCheck.message}`);
        }
      }

      // Check npm updates
      if (this.enableNpmUpdates) {
        const npmCheck = await this.checkNpmUpdates();
        if (npmCheck.hasUpdates) {
          hasUpdates = true;
          updates.push('npm');
          this.log(`NPM: ${npmCheck.message}`);
          if (npmCheck.packages) {
            npmCheck.packages.forEach(pkg => this.log(`  - ${pkg}`));
          }
        } else {
          this.log(`NPM: ${npmCheck.message}`);
        }
      }

      // Apply updates if available
      if (hasUpdates) {
        this.log('Updates available! Applying...');

        if (updates.includes('git')) {
          const gitResult = await this.applyGitUpdates();
          if (!gitResult.success) {
            this.log(`Git update failed: ${gitResult.message}`, 'ERROR');
          }
        }

        if (updates.includes('npm')) {
          const npmResult = await this.applyNpmUpdates();
          if (!npmResult.success) {
            this.log(`NPM update failed: ${npmResult.message}`, 'ERROR');
          }
        }

        // Restart application
        await this.restartApplication();
        
        this.log('=== Update check complete ===');
      } else {
        this.log('No updates available.');
        this.log('=== Update check complete ===');
      }
    } catch (error) {
      this.log(`Error during update check: ${error.message}`, 'ERROR');
      this.log(error.stack, 'ERROR');
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Start the sidecar service
   */
  start() {
    this.log('🚀 Update Sidecar Service starting...');
    this.log(`Check interval: ${this.checkInterval / 1000 / 60 / 60} hours`);
    this.log(`Git updates: ${this.enableGitUpdates ? 'enabled' : 'disabled'}`);
    this.log(`NPM updates: ${this.enableNpmUpdates ? 'enabled' : 'disabled'}`);
    this.log(`Auto-restart: ${this.autoRestart ? 'enabled' : 'disabled'}`);

    // Save PID
    fs.writeFileSync(this.pidFile, process.pid.toString());

    // Perform initial check
    this.performUpdateCheck();

    // Schedule periodic checks
    this.updateTimer = setInterval(() => {
      this.performUpdateCheck();
    }, this.checkInterval);

    this.log('✅ Update Sidecar Service running');
  }

  /**
   * Stop the sidecar service
   */
  stop() {
    this.log('🛑 Stopping Update Sidecar Service...');
    
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    // Remove PID file
    if (fs.existsSync(this.pidFile)) {
      fs.unlinkSync(this.pidFile);
    }

    this.log('✅ Update Sidecar Service stopped');
    process.exit(0);
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      running: !!this.updateTimer,
      isUpdating: this.isUpdating,
      lastCheck: this.lastCheck,
      nextCheck: this.lastCheck ? new Date(this.lastCheck.getTime() + this.checkInterval) : null,
      checkInterval: this.checkInterval,
      enableGitUpdates: this.enableGitUpdates,
      enableNpmUpdates: this.enableNpmUpdates,
      autoRestart: this.autoRestart
    };
  }
}

// CLI interface
if (require.main === module) {
  const sidecar = new UpdateSidecar({
    checkInterval: process.env.UPDATE_CHECK_INTERVAL 
      ? parseInt(process.env.UPDATE_CHECK_INTERVAL) 
      : 24 * 60 * 60 * 1000,
    enableGitUpdates: process.env.ENABLE_GIT_UPDATES !== 'false',
    enableNpmUpdates: process.env.ENABLE_NPM_UPDATES !== 'false',
    autoRestart: process.env.AUTO_RESTART !== 'false'
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => sidecar.stop());
  process.on('SIGTERM', () => sidecar.stop());

  // Start the service
  sidecar.start();

  // Keep process alive
  setInterval(() => {
    // Heartbeat
  }, 60000);
}

module.exports = UpdateSidecar;



