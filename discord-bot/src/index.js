import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import priceCommand from './commands/price.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = '!';

client.once('ready', () => {
  console.log(`Price Agent Bot logged in as ${client.user.tag}`);
  console.log(`Connected to ${client.guilds.cache.size} guild(s)`);
});

client.on('messageCreate', async (message) => {
  // Ignore bots and messages without prefix
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'price') {
    await priceCommand.execute(message, args);
  }
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

// Login
client.login(process.env.DISCORD_BOT_TOKEN);
