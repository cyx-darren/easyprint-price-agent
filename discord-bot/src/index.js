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

client.once('ready', () => {
  console.log(`Price Agent Bot logged in as ${client.user.tag}`);
  console.log(`Connected to ${client.guilds.cache.size} guild(s)`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!client.user || !message.mentions.users.has(client.user.id)) return;

  const mentionPattern = new RegExp(`<@!?${client.user.id}>`, 'g');
  const query = message.content
    .replace(mentionPattern, ' ')
    .trim()
    .replace(/^[:,\-\s]+/, '')
    .replace(/^!?price\b[:,\-\s]*/i, '')
    .replace(/^pricing\b[:,\-\s]*/i, '')
    .trim();

  await priceCommand.execute(message, query ? query.split(/\s+/) : []);
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

// Login
client.login(process.env.DISCORD_BOT_TOKEN);
