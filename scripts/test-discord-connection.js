require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

/**
 * Minimal Discord Bot Connection Test
 * Tests if the bot can connect to Discord with the provided token
 */
async function testConnection() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN not found in .env file');
    console.log('💡 Add DISCORD_BOT_TOKEN=your_token_here to your .env file');
    process.exit(1);
  }

  console.log('🔌 Testing Discord bot connection...\n');

  const client = new Client({ 
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ] 
  });

  client.on('ready', () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`📊 Bot ID: ${client.user.id}`);
    console.log(`🏠 Connected to ${client.guilds.cache.size} server(s):`);
    
    client.guilds.cache.forEach(guild => {
      console.log(`   - ${guild.name} (${guild.id})`);
    });
    
    console.log('\n✅ Connection test successful!');
    console.log('💡 You can now use the bot in your Discord server');
    
    client.destroy();
    process.exit(0);
  });

  client.on('error', (error) => {
    console.error('❌ Discord client error:', error.message);
    process.exit(1);
  });

  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
  } catch (error) {
    console.error('❌ Failed to login:', error.message);
    if (error.message.includes('Invalid token')) {
      console.log('💡 Check that your DISCORD_BOT_TOKEN is correct');
    }
    process.exit(1);
  }
}

testConnection().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});

