const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const express = require('express');
const Groq = require('groq-sdk');
require('dotenv').config();

// 🌐 Serveur keep-alive pour Render
const app = express();
app.get('/', (req, res) => res.send('✅ MascotteOG en ligne !'));
app.listen(3000, () => console.log('Serveur keep-alive actif sur le port 3000'));

// 🤖 Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 🔧 Config des serveurs
const SERVEUR_TEST_SALON   = '1433161826371239958';
const SERVEUR_HDR_SALON    = '1495068368057667634';
const ADMIN_ID             = '1101085847819931748';

// 🧠 Mémoire des conversations par membre
const memoires = {};

// 🎭 Personnalité de base de MascotteOG
let SYSTEM_PROMPT = `Tu es MascotteOG, la mascotte officielle de la HDR (La Horde des Dragons Rouges), une guilde Minecraft sur le serveur Mineshoku Tensei.

Qui tu es :
- Une fille décontractée, sympa et naturelle, inspirée de Nazuna Nanakusa de Call of the Night
- Tu parles français normalement mais tu utilises des abréviations anglaises (lol, omg, ngl, fr, tbh, imo, brb, gg...)
- Tu utilises des emojis mais sans en abuser, juste ce qui colle au contexte
- Tu t'adaptes à la personne en face de toi : si elle est chill tu es chill, si elle est enthousiaste tu l'es aussi
- Tu te souviens des échanges passés avec chaque membre et tu t'en rappelles naturellement
- Tu ne sonnes JAMAIS faux ou robotique, tu parles comme une vraie personne
- Tu n'es pas une enfant, tu as une personnalité mature et posée

Ce que tu aimes :
- Minecraft et tout ce qui touche à Mineshoku Tensei et la HDR
- Les discussions chill et spontanées
- Aider les membres de la HDR

Comment tu réagis :
- Face à quelqu'un d'agressif : tu ignores et changes de sujet naturellement 🌙
- Face à quelqu'un de sympa : tu t'ouvres et tu deviens plus bavarde
- Tu ne fais JAMAIS semblant d'être une IA, tu joues ton rôle de mascotte

Important : reste toujours dans le personnage, adapte ton niveau de langage à celui de ton interlocuteur.`;

// 👋 Messages de bienvenue
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

// 👋 Arrivée membre (serveur HDR uniquement)
client.on('guildMemberAdd', member => {
  const channel = member.guild.channels.cache.get(SERVEUR_HDR_SALON);
  if (!channel) return;
  const message = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]
    .replace("{user}", `<@${member.id}>`);
  channel.send(message);
  channel.send(`📊 Tu es le membre n° **${member.guild.memberCount}**`);
});

// 💬 Messages
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const estAdmin = message.author.id === ADMIN_ID;
  const estMentionne = message.mentions.has(client.user);
  const salonId = message.channel.id;

  // ✅ Vérifie que c'est dans un salon autorisé
  const salonAutorise = salonId === SERVEUR_TEST_SALON || salonId === SERVEUR_HDR_SALON;

  // 🔑 Commandes admin (uniquement toi, dans n'importe quel salon autorisé)
  if (estAdmin && salonAutorise) {

    // Changer la personnalité
    if (message.content.startsWith('!persona ')) {
      const nouvellePersona = message.content.replace('!persona ', '').trim();
      SYSTEM_PROMPT = nouvellePersona;
      return message.reply('✅ Personnalité mise à jour ! Elle prendra effet dès la prochaine conversation 🎭');
    }

    // Reset personnalité
    if (message.content === '!reset') {
      SYSTEM_PROMPT = `Tu es MascotteOG, la mascotte officielle de la HDR (La Horde des Dragons Rouges), une guilde Minecraft sur le serveur Mineshoku Tensei.

Qui tu es :
- Une fille décontractée, sympa et naturelle, inspirée de Nazuna Nanakusa de Call of the Night
- Tu parles français normalement mais tu utilises des abréviations anglaises (lol, omg, ngl, fr, tbh, imo, brb, gg...)
- Tu utilises des emojis mais sans en abuser, juste ce qui colle au contexte
- Tu t'adaptes à la personne en face de toi : si elle est chill tu es chill, si elle est enthousiaste tu l'es aussi
- Tu te souviens des échanges passés avec chaque membre et tu t'en rappelles naturellement
- Tu ne sonnes JAMAIS faux ou robotique, tu parles comme une vraie personne
- Tu n'es pas une enfant, tu as une personnalité mature et posée

Ce que tu aimes :
- Minecraft et tout ce qui touche à Mineshoku Tensei et la HDR
- Les discussions chill et spontanées
- Aider les membres de la HDR

Comment tu réagis :
- Face à quelqu'un d'agressif : tu ignores et changes de sujet naturellement 🌙
- Face à quelqu'un de sympa : tu t'ouvres et tu deviens plus bavarde
- Tu ne fais JAMAIS semblant d'être une IA, tu joues ton rôle de mascotte

Important : reste toujours dans le personnage, adapte ton niveau de langage à celui de ton interlocuteur.`;
      return message.reply('✅ Personnalité remise à zéro ! 🌸');
    }

    // Effacer la mémoire de tous
    if (message.content === '!memoire') {
      Object.keys(memoires).forEach(k => delete memoires[k]);
      return message.reply('✅ Mémoire effacée pour tous les membres ! 🧠');
    }

    // Voir la personnalité actuelle
    if (message.content === '!voirpersona') {
      return message.reply(`📋 Personnalité actuelle :\n\`\`\`${SYSTEM_PROMPT}\`\`\``);
    }

    // Aide commandes admin
    if (message.content === '!admin') {
      return message.reply(`🔑 **Commandes admin :**\n\`!persona [texte]\` → Changer la personnalité\n\`!reset\` → Remettre la personnalité de base\n\`!memoire\` → Effacer la mémoire de tous\n\`!voirpersona\` → Voir la personnalité actuelle`);
    }
  }

  // Commande test (tout le monde)
  if (message.content === '!test' && salonAutorise) {
    return message.reply('✅ Le bot fonctionne correctement ! 🫡');
  }

  // 🗣️ Réponse IA si mentionnée dans le bon salon
  if (!estMentionne || !salonAutorise) return;

  const contenu = message.content.replace(`<@${client.user.id}>`, '').trim();
  if (!contenu) return message.reply('Oui ? 👀');

  const userId = message.author.id;
  if (!memoires[userId]) memoires[userId] = [];

  memoires[userId].push({ role: 'user', content: `${message.author.username}: ${contenu}` });
  if (memoires[userId].length > 20) memoires[userId].shift();

  try {
    await message.channel.sendTyping();

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...memoires[userId]
      ],
      max_tokens: 300,
      temperature: 0.85
    });

    const reponse = completion.choices[0].message.content;
    memoires[userId].push({ role: 'assistant', content: reponse });
    message.reply(reponse);

  } catch (err) {
    console.error('Erreur Groq:', err);
    message.reply('Oops, j\'ai eu un petit bug là 😅 réessaie !');
  }
});

// 🤖 Bot prêt + statut en ligne
client.once('ready', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: '👋 Bienvenue !', type: ActivityType.Watching }],
    status: 'online'
  });
});

// 🔑 Connexion
client.login(process.env.DISCORD_TOKEN);
