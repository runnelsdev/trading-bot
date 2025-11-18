require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('clientReady', async () => {
  console.log('✅ Bot is online!');
  console.log(`Logged in as ${client.user.tag}`);
  
  try {
    await client.user.setActivity('Trading', { type: ActivityType.Playing });
    await client.user.setStatus('online');
    console.log('✅ Presence set successfully');
  } catch (error) {
    console.error('❌ Error setting presence:', error);
  }
});

client.login(process.env.DISCORD_TOKEN);