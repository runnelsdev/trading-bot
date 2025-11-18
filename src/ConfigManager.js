const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Configuration Manager
 * Handles secure storage and retrieval of bot configuration
 */
class ConfigManager {
  constructor() {
    this.configPath = path.join(__dirname, '../config/bot-config.json');
    this.encryptionKey = this.getOrCreateEncryptionKey();
  }

  /**
   * Get or create encryption key
   */
  getOrCreateEncryptionKey() {
    const keyPath = path.join(__dirname, '../config/.encryption-key');
    
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf8').trim();
    }

    // Generate new key
    const key = crypto.randomBytes(32).toString('hex');
    
    // Ensure config directory exists
    const configDir = path.dirname(keyPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    return key;
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(text) {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(this.encryptionKey, 'hex');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedText) {
    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(this.encryptionKey, 'hex');
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  /**
   * Check if configuration exists
   */
  isConfigured() {
    return fs.existsSync(this.configPath);
  }

  /**
   * Save configuration
   */
  async save(config) {
    // Encrypt sensitive fields
    // Note: discordBotToken comes from .env, not stored in config
    const encryptedConfig = {
      ...config,
      tastytradeUsername: this.encrypt(config.tastytradeUsername),
      tastytradePassword: this.encrypt(config.tastytradePassword)
    };

    // Ensure config directory exists
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Save configuration
    fs.writeFileSync(
      this.configPath,
      JSON.stringify(encryptedConfig, null, 2),
      { mode: 0o600 }
    );

    console.log('✅ Configuration saved securely');
  }

  /**
   * Load configuration
   */
  async load() {
    if (!this.isConfigured()) {
      throw new Error('Configuration not found. Please run setup first.');
    }

    const encryptedConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));

    // Decrypt sensitive fields
    // Note: discordBotToken comes from .env, not from config file
    const config = {
      ...encryptedConfig,
      tastytradeUsername: this.decrypt(encryptedConfig.tastytradeUsername),
      tastytradePassword: this.decrypt(encryptedConfig.tastytradePassword)
    };

    // Merge Discord token from .env
    if (process.env.DISCORD_BOT_TOKEN) {
      config.discordBotToken = process.env.DISCORD_BOT_TOKEN;
    }

    return config;
  }

  /**
   * Get public configuration (non-sensitive)
   */
  getPublicConfig() {
    if (!this.isConfigured()) {
      return null;
    }

    const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    
    return {
      channelName: config.channelName,
      tastytradeAccountNumber: config.tastytradeAccountNumber,
      sizingMethod: config.sizingMethod,
      maxDailyTrades: config.maxDailyTrades,
      maxDailyLoss: config.maxDailyLoss,
      configuredAt: config.configuredAt
    };
  }
}

module.exports = ConfigManager;


