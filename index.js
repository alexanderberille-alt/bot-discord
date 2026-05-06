const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
require('dotenv').config();

// 🌐 Serveur keep-alive pour Render
const app = express();
app.get('/', (req, res) => res.send('✅ Bot en ligne !'));
app.listen(3000, () => console.log('Serveur keep-alive actif sur le port 3000'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 👋 Messages de bienvenue simples
const welcomeMessages = [
  "😊 Bonjour {user} Bienvenue sur le serveur ! 🌸",
  "💕 Salut {user} Heureux de te voir ici ! ✨",
  "🤗 Bienvenue {user} 🌷🎉",
  "🫰 Bonsoir {user} Ravi de t'accueillir ! 🌟",
  "🫵 Hello {user} Content que tu sois là ! 💐",
  "👋 Salut {user} Sois le bienvenu ! 🎊",
  "🙌 Bienvenue {user} Amuse-toi bien ! 💫",
  "✨ Bonjour {user} Heureux de t'avoir ici ! 🍀",
  "🎉 Salut {user} Bienvenue parmi nous ! 🌹",
  "🎊 Bienvenue {user} Profite du serveur ! 🩷",
  "🔔 Hello {user} Ravi de te voir ! 🧡",
  "🗿 Bonsoir {user} Bienvenue ! 💞",
  "🔖 Salut {user} Contente de t'accueillir ! 🤗",
  "🍻 Bienvenue {user} Profite du serveur ! 🌸",
  "🌸 Bonjour {user} Bienvenue ! 💐",
  "💐 Salut {user} Heureux que tu sois là ! 🔥",
  "🌷 Bienvenue {user} Sois le bienvenu ! 💫",
  "🌹 Hello {user} Bienvenue parmi nous ! ✨",
  "🍀 Salut {user} Content de t'accueillir ! 🎉",
  "🔥 Bienvenue {user} Bonne visite ! 🌟",
  "Hello {user} 🧡 Bienvenue parmi nous ! 🌸",
  "Salut {user} 💞 Content que tu sois là ! ✨"
];

// 👋 Arrivée membre + compteur
client.on('guildMemberAdd', member => {
  const channel = member.guild.channels.cache.get("1433161826371239958");

  const message = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]
    .replace("{user}", `<@${member.id}>`);

  if (channel) {
    channel.send(message);
    channel.send(`📊 Tu es le membre n° **${member.guild.memberCount}**`);
  }
});

// 💬 Commande test
client.on('messageCreate', message => {
  if (message.author.bot) return;

  if (message.content === '!test') {
    message.reply('✅ Le bot fonctionne correctement !🫡');
  }
});

// 🤖 Bot prêt
client.once('ready', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

// 🔑 Connexion via variable d'environnement
client.login(process.env.DISCORD_TOKEN);
