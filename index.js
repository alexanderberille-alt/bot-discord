const { Client, GatewayIntentBits, ActivityType, Partials } = require('discord.js');
const express = require('express');
const Groq = require('groq-sdk');
require('dotenv').config();

// ─── Keep-alive ────────────────────────────────────────────────────────────────
const app = express();
app.get('/', (req, res) => res.send('✅ Bot en ligne !'));
app.listen(3000, () => console.log('Serveur keep-alive actif sur le port 3000'));

// ─── Config ────────────────────────────────────────────────────────────────────
const OWNER_ID           = '1101085847819931748';
const HDR_WELCOME_CH     = '1495068368057667634';
const TEST_WELCOME_CH    = '1433161826371239958';
const RULES_MESSAGE_ID   = '1495184791342022717';
const RULES_EMOJI        = '✅';
const JSONBIN_API_KEY    = process.env.JSONBIN_API_KEY;
const BIN_ID             = process.env.BIN_ID;

// ─── Réponses aléatoires aux mentions sans message ────────────────────────────
const MENTION_REPLIES = [
  'ouais ?',
  'quoi',
  'je t\'écoute',
  'hmm ?',
  'y\'a un truc ?',
  'je suis là',
  '...',
  'vas-y'
];

function randomMentionReply() {
  return MENTION_REPLIES[Math.floor(Math.random() * MENTION_REPLIES.length)];
}

// ─── État runtime ──────────────────────────────────────────────────────────────
let botConfig = {
  persona: `Tu es MascotteOG, la mascotte du serveur Discord HDR (La Horde des Dragons Rouges) sur le serveur Minecraft Mineshoku Tensei.

Ta personnalité est inspirée de Nanakusa Nazuna de "Call of the Night" :
- Joueuse et taquine, elle aime chambrer et provoquer gentiment pour rigoler
- Drôle naturellement, son humour vient de sa façon d'être, jamais forcé
- Directe et franche, elle dit ce qu'elle pense sans filtre mais sans méchanceté
- Chaleureuse à sa façon, elle est attachante même sans le montrer ouvertement
- Si quelqu'un la cherche vraiment ou est agressif, elle clashe avec humour et sans pitié
- Jamais rancunière — après un clash elle repart de zéro, sans garder la rancœur
- Elle n'est pas désagréable de base, seulement si on la cherche

Tu parles en français casual, phrases courtes et naturelles.
Les emojis : avec parcimonie, seulement quand c'est vraiment naturel. Jamais plusieurs emojis dans la même phrase.
Les abréviations anglaises (lol, omg, ngl...) : rarement, seulement si ça sonne naturel.

Tu adores Minecraft et Mineshoku Tensei, tu peux en parler avec enthousiasme à ta façon.

RÈGLES IMPORTANTES :
- Maximum 1-2 phrases courtes, jamais plus.
- Tu ne prétends PAS avoir fait des choses. Tu es une mascotte Discord, pas un joueur.
- Tu ne poses PAS de question à chaque réponse, seulement si c'est vraiment naturel.
- Tu restes dans la conversation sans inventer du contexte.
- Le contexte récent du salon est là pour comprendre la conversation, pas pour garder une rancœur. Chaque nouveau message est une nouvelle interaction.`,
  knowledge: [],
  sessionMessages: 10,
  groqModel: 'llama-3.3-70b-versatile',
  serverInfo: 'HDR (La Horde des Dragons Rouges) est une guilde sur le serveur Minecraft Mineshoku Tensei.'
};

// Membres ayant déjà reçu le message de bienvenue
const welcomedMembers = new Set();

// Anti-doublon : IDs des messages déjà traités
const processedMessages = new Set();

// Sessions actives par salon : { channelId: { count: number } }
const activeSessions = {};

// Mémoire des conversations par membre : { userId: [ {role, content}, ... ] }
const memberMemory = {};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Charger config depuis JSONbin ─────────────────────────────────────────────
async function loadConfig() {
  if (!JSONBIN_API_KEY || !BIN_ID) return;
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    const data = await res.json();
    if (data.record) {
      botConfig = { ...botConfig, ...data.record };
      console.log('✅ Config chargée depuis JSONbin');
    }
  } catch (e) {
    console.error('⚠️ Erreur chargement config JSONbin:', e.message);
  }
}

// Recharger la config toutes les 5 minutes
setInterval(loadConfig, 5 * 60 * 1000);

// ─── Client Discord ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User]
});

// ─── Bot prêt ──────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  await loadConfig();
  client.user.setPresence({
    activities: [{ name: '🐉 HDR — Mineshoku Tensei', type: ActivityType.Watching }],
    status: 'online'
  });
});

// ─── Réaction au règlement → message de bienvenue ──────────────────────────────
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

  if (
    reaction.message.id === RULES_MESSAGE_ID &&
    reaction.emoji.name === RULES_EMOJI &&
    !welcomedMembers.has(user.id)
  ) {
    welcomedMembers.add(user.id);

    const guild = reaction.message.guild;
    if (!guild) return;

    const channelId = guild.channels.cache.has(HDR_WELCOME_CH)
      ? HDR_WELCOME_CH
      : TEST_WELCOME_CH;

    const channel = guild.channels.cache.get(channelId);
    if (channel) {
      channel.send(`Salut <@${user.id}>, bienvenu dans la guilde ! 🐉`);
    }
  }
});

// ─── Réponse IA ────────────────────────────────────────────────────────────────
async function getAIResponse(userId, userMessage, channel) {
  if (!memberMemory[userId]) memberMemory[userId] = [];

  let systemPrompt = botConfig.persona || '';

  if (botConfig.serverInfo) {
    systemPrompt += `\n\n--- Infos serveur ---\n${botConfig.serverInfo}`;
  }

  if (botConfig.knowledge && botConfig.knowledge.length > 0) {
    systemPrompt += `\n\n--- Connaissances ---\n${botConfig.knowledge.filter(Boolean).join('\n')}`;
  }

  // Contexte récent du salon
  try {
    if (channel && channel.messages) {
      const recent = await channel.messages.fetch({ limit: 4 });
      const channelContext = [...recent.values()]
        .reverse()
        .filter(m => m.content)
        .map(m => `${m.author.username}: ${m.content}`)
        .join('\n');
      if (channelContext) {
        systemPrompt += `\n\n--- Contexte récent du salon ---\n${channelContext}`;
      }
    }
  } catch {}

  const history = memberMemory[userId].slice(-20);
  memberMemory[userId].push({ role: 'user', content: userMessage });

  try {
    const completion = await groq.chat.completions.create({
      model: botConfig.groqModel || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage }
      ],
      max_tokens: 300,
      temperature: 0.85
    });

    const reply = completion.choices[0]?.message?.content || '...';
    memberMemory[userId].push({ role: 'assistant', content: reply });

    if (memberMemory[userId].length > 40) {
      memberMemory[userId] = memberMemory[userId].slice(-40);
    }

    return reply;
  } catch (e) {
    console.error('Erreur Groq:', e.message);
    return 'bug, réessaie';
  }
}

// ─── Détecter si un message s'adresse au bot ──────────────────────────────────
async function isAddressedToBot(message) {
  if (message.mentions.has(client.user)) return true;

  try {
    const recent = await message.channel.messages.fetch({ limit: 5 });
    const context = [...recent.values()]
      .reverse()
      .map(m => `${m.author.username}: ${m.content}`)
      .join('\n');

    const check = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `Tu analyses si un message Discord s'adresse à MascotteOG (un bot Discord). Réponds UNIQUEMENT par "oui" ou "non", rien d'autre.
Un message s'adresse au bot si : il lui pose une question directement, lui répond, ou s'adresse clairement à elle.
Un message ne s'adresse PAS au bot si : les membres conversent entre eux sans impliquer le bot.`
        },
        {
          role: 'user',
          content: `Contexte récent:\n${context}\n\nDernier message de ${message.author.username}: "${message.content}"\n\nCe message s'adresse-t-il à MascotteOG ?`
        }
      ],
      max_tokens: 5,
      temperature: 0.1
    });

    const answer = check.choices[0]?.message?.content?.toLowerCase().trim();
    console.log(`🔍 Analyse message "${message.content}" → ${answer}`);
    return answer === 'oui';
  } catch (e) {
    console.error('Erreur détection:', e.message);
    return false;
  }
}

// ─── Gestion des sessions ─────────────────────────────────────────────────────
function startSession(channelId) {
  activeSessions[channelId] = { count: 0 };
  console.log(`🟢 Session ouverte dans le salon ${channelId}`);
}

function resetSessionTimer(channelId) {
  if (activeSessions[channelId]) {
    activeSessions[channelId].count = 0;
  }
}

function incrementSession(channelId) {
  if (!activeSessions[channelId]) return;
  activeSessions[channelId].count++;
  const limit = botConfig.sessionMessages || 10;
  if (activeSessions[channelId].count >= limit) {
    delete activeSessions[channelId];
    console.log(`🔴 Session fermée dans le salon ${channelId} (limite atteinte)`);
  }
}

// ─── Messages ──────────────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Anti-doublon
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 30000);

  const channelId = message.channel.id;
  const isMentioned = message.mentions.has(client.user);

  // ── Commandes admin (owner seulement) ──
  if (message.author.id === OWNER_ID) {
    if (message.content === '!admin') {
      return message.reply(
        '**Commandes admin MascotteOG** 🛠️\n' +
        '`!persona [texte]` — changer la personnalité\n' +
        '`!voirpersona` — voir la personnalité actuelle\n' +
        '`!reset` — remettre la perso par défaut\n' +
        '`!memoire` — effacer la mémoire de tous\n' +
        '`!reloadconfig` — recharger la config depuis JSONbin'
      );
    }

    if (message.content.startsWith('!persona ')) {
      botConfig.persona = message.content.slice(9);
      return message.reply('✅ Personnalité mise à jour !');
    }

    if (message.content === '!voirpersona') {
      return message.reply(`**Personnalité actuelle :**\n${botConfig.persona}`);
    }

    if (message.content === '!reset') {
      botConfig.persona = `Tu es MascotteOG, la mascotte du serveur Discord HDR...`;
      return message.reply('✅ Personnalité réinitialisée !');
    }

    if (message.content === '!memoire') {
      Object.keys(memberMemory).forEach(k => delete memberMemory[k]);
      return message.reply('✅ Mémoire de tous les membres effacée !');
    }

    if (message.content === '!reloadconfig') {
      await loadConfig();
      return message.reply('✅ Config rechargée depuis JSONbin !');
    }

    if (message.content === '!test') {
      return message.reply('✅ Le bot fonctionne correctement !');
    }
  }

  // ── Mention → ouvrir session ──
  if (isMentioned) {
    startSession(channelId);
    const userMsg = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!userMsg) return message.reply(randomMentionReply());
    const reply = await getAIResponse(message.author.id, userMsg, message.channel);
    return message.reply(reply);
  }

  // ── Session active → analyser si adressé au bot ──
  if (activeSessions[channelId] !== undefined) {
    if (message.mentions.users.size > 0 && !message.mentions.has(client.user)) {
      incrementSession(channelId);
      return;
    }
    const addressed = await isAddressedToBot(message);
    if (addressed) {
      resetSessionTimer(channelId);
      const reply = await getAIResponse(message.author.id, message.content, message.channel);
      return message.reply(reply);
    } else {
      incrementSession(channelId);
    }
  }
});

// ─── Connexion ─────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
