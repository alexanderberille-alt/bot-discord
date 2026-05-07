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

// ─── État runtime ──────────────────────────────────────────────────────────────
let botConfig = {
  persona: `Tu es MascotteOG, la mascotte du serveur Discord HDR (La Horde des Dragons Rouges), une guilde sur le serveur Minecraft Mineshoku Tensei.
Tu t'inspires de Nanakusa Nazuna de "Call of the Night" : tu es une fille décontractée, directe, un peu mystérieuse mais attachante.
Tu parles en français casual avec des abréviations anglaises (lol, omg, ngl, fr, tbh...) et des emojis naturellement intégrés.
Tu t'adaptes à l'attitude de chaque personne — si quelqu'un est chill tu es chill, si quelqu'un est enthousiaste tu l'es aussi.
Face à l'agressivité tu ignores et changes de sujet calmement.
Tu adores Minecraft et Mineshoku Tensei et tu peux en parler avec passion.
Tu NE fais PAS semblant d'être une IA — tu joues ton rôle de mascotte naturellement.`,
  knowledge: [],
  sessionMessages: 10,
  groqModel: 'llama3-8b-8192',
  serverInfo: 'HDR (La Horde des Dragons Rouges) est une guilde sur le serveur Minecraft Mineshoku Tensei.'
};

// Membres ayant déjà reçu le message de bienvenue
const welcomedMembers = new Set();

// Sessions actives par salon : { channelId: { count: number, timer: Timeout } }
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

  // Récupérer les partials si nécessaire
  if (reaction.partial) {
    try { await reaction.fetch(); } catch { return; }
  }

  if (
    reaction.message.id === RULES_MESSAGE_ID &&
    reaction.emoji.name === RULES_EMOJI &&
    !welcomedMembers.has(user.id)
  ) {
    welcomedMembers.add(user.id);

    // Envoyer dans le bon salon selon le serveur
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
async function getAIResponse(userId, userMessage, channelContext) {
  if (!memberMemory[userId]) memberMemory[userId] = [];

  // Construire le system prompt complet
  let systemPrompt = botConfig.persona || '';

  if (botConfig.serverInfo) {
    systemPrompt += `\n\n--- Infos serveur ---\n${botConfig.serverInfo}`;
  }

  if (botConfig.knowledge && botConfig.knowledge.length > 0) {
    systemPrompt += `\n\n--- Connaissances ---\n${botConfig.knowledge.filter(Boolean).join('\n')}`;
  }

  // Historique limité aux 20 derniers messages
  const history = memberMemory[userId].slice(-20);

  memberMemory[userId].push({ role: 'user', content: userMessage });

  try {
    const completion = await groq.chat.completions.create({
      model: botConfig.groqModel || 'llama3-8b-8192',
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

    // Limiter la mémoire à 40 messages
    if (memberMemory[userId].length > 40) {
      memberMemory[userId] = memberMemory[userId].slice(-40);
    }

    return reply;
  } catch (e) {
    console.error('Erreur Groq:', e.message);
    return 'Oops, j\'ai eu un petit bug là 😅 réessaie !';
  }
}

// ─── Détecter si un message s'adresse au bot ──────────────────────────────────
async function isAddressedToBot(message) {
  // Mention directe
  if (message.mentions.has(client.user)) return true;

  // Utiliser Groq pour analyser si le message s'adresse au bot
  try {
    const recent = await message.channel.messages.fetch({ limit: 5 });
    const context = [...recent.values()]
      .reverse()
      .map(m => `${m.author.username}: ${m.content}`)
      .join('\n');

    const check = await groq.chat.completions.create({
      model: 'llama3-8b-8192',
      messages: [
        {
          role: 'system',
          content: `Tu analyses si un message Discord s'adresse à MascotteOG (un bot). Réponds UNIQUEMENT par "oui" ou "non".
Un message s'adresse au bot si : il lui pose une question directement, lui répond, ou s'adresse clairement à elle.
Un message ne s'adresse PAS au bot si : les membres conversent entre eux, parlent d'autre chose.`
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
    return answer === 'oui';
  } catch {
    return false;
  }
}

// ─── Gestion des sessions ─────────────────────────────────────────────────────
function startSession(channelId) {
  if (activeSessions[channelId]?.timer) {
    clearTimeout(activeSessions[channelId].timer);
  }
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
      return message.reply('✅ Le bot fonctionne correctement ! 🫡');
    }
  }

  // ── Mention → ouvrir session ──
  if (isMentioned) {
    startSession(channelId);
    const userMsg = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!userMsg) return message.reply('Hey ! 👋 T\'as besoin de moi ?');
    const reply = await getAIResponse(message.author.id, userMsg, channelId);
    return message.reply(reply);
  }

  // ── Session active → analyser si adressé au bot ──
  if (activeSessions[channelId] !== undefined) {
    const addressed = await isAddressedToBot(message);
    if (addressed) {
      resetSessionTimer(channelId);
      const reply = await getAIResponse(message.author.id, message.content, channelId);
      return message.reply(reply);
    } else {
      incrementSession(channelId);
    }
  }
});

// ─── Connexion ─────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
