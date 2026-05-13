require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

/**
 * Complete Discord Bot Test
 * Verifies connection and message responses
 * 
 * Commands:
 * - !ping - Responds with "Pong!"
 * - !test - Confirms bot can read messages
 * - !role - Shows user's roles
 */

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent  // Required to read message text
  ] 
});

// Bot is connected and ready
client.on('ready', () => {
  console.log('✅ Bot is ONLINE!');
  console.log(`🤖 Logged in as: ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} server(s)`);
  
  // List all servers
  client.guilds.cache.forEach(guild => {
    console.log(`   - ${guild.name} (${guild.id})`);
  });
  
  console.log('\n💡 Test commands: !ping, !test, !role');
  console.log('💡 Make sure "Message Content Intent" is enabled in Discord Developer Portal\n');
});

// Respond to messages
client.on('messageCreate', async (message) => {
  // Ignore messages from bots (including itself)
  if (message.author.bot) return;

  // Test command: !ping
  if (message.content === '!ping') {
    await message.reply('🏓 Pong! Bot is working!');
    console.log(`📨 Responded to !ping from ${message.author.tag} in #${message.channel.name}`);
  }

  // Test command: !test
  if (message.content === '!test') {
    await message.reply('✅ I can read and respond to messages!');
    console.log(`📨 Responded to !test from ${message.author.tag} in #${message.channel.name}`);
  }

  // Test command: !role (check user's roles)
  if (message.content === '!role') {
    const roles = message.member?.roles.cache
      .filter(role => role.name !== '@everyone')
      .map(role => role.name)
      .join(', ');
    
    await message.reply(`Your roles: ${roles || 'No roles assigned'}`);
    console.log(`📨 Responded to !role from ${message.author.tag} in #${message.channel.name}`);
  }
  
  // Test command: !channel (show current channel info)
  if (message.content === '!channel') {
    const channelInfo = `Channel: #${message.channel.name}\nChannel ID: ${message.channel.id}\nServer: ${message.guild?.name}`;
    await message.reply(channelInfo);
    console.log(`📨 Responded to !channel from ${message.author.tag}`);
  }
});

// Error handling
client.on('error', error => {
  console.error('❌ Bot error:', error);
});

client.on('warn', warning => {
  console.warn('⚠️  Bot warning:', warning);
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down bot...');
  client.destroy();
  process.exit(0);
});

// Login with your bot token
if (!process.env.DISCORD_BOT_TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN not found in .env file');
  console.log('💡 Add DISCORD_BOT_TOKEN=your_token_here to your .env file');
  process.exit(1);
}

client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
  console.error('❌ Failed to login:', error.message);
  if (error.message.includes('Invalid token')) {
    console.log('💡 Check that your DISCORD_BOT_TOKEN is correct');
  }
  process.exit(1);
});

