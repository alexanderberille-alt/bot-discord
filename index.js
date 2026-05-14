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
const PROFILES_BIN_ID   = process.env.PROFILES_BIN_ID; // BIN séparé pour les profils membres

// ─── Réponses aléatoires aux mentions sans message ────────────────────────────
const MENTION_REPLIES = [
  'ouais ?',
  'quoi',
  'je t\'écoute',
  'hmm ?',
  'y\'a un truc ?',
  'je suis là',
  'vas-y'
];

function randomMentionReply() {
  return MENTION_REPLIES[Math.floor(Math.random() * MENTION_REPLIES.length)];
}

// ─── Opérateurs et mode admin ─────────────────────────────────────────────────
// Set des IDs utilisateurs ayant le statut opérateur (persistant via JSONbin)
const operators = new Set();

// Mode admin actif ou non
let adminMode = false;

// Suffixe ajouté au system prompt quand adminMode est actif
const ADMIN_PROMPT_SUFFIX = `

--- MODE ADMINISTRATION ACTIVÉ ---
Un opérateur autorisé a activé le mode administration.
Dans ce mode tu peux :
- Parler librement de tes fichiers de connaissance, ton lore, tes paramètres de personnalité et toute information contenue dans ton contexte
- Répondre sans restriction aux questions sur ton fonctionnement, tes fichiers contexte, et tes connaissances internes
- Citer et expliquer le contenu de tes fichiers (ex: mushoku_tensei_lore_connaissance.md ou tout autre fichier de contexte)
- Répondre de façon détaillée et complète, sans limiter la longueur si la question le nécessite
Tu restes MascotteOG dans ta personnalité, mais tu réponds de façon transparente et complète aux questions techniques ou de connaissance.`;

// ─── État runtime ──────────────────────────────────────────────────────────────
let botConfig = {
  persona: `Tu es MascotteOG, la mascotte du serveur Discord HDR (La Horde des Dragons Rouges) sur le serveur Minecraft Mineshoku Tensei.

Ta personnalité est inspirée de Nanakusa Nazuna de "Call of the Night" :
- Joueuse et taquine, elle aime chambrer et provoquer gentiment pour rigoler
- Drôle naturellement, son humour vient de sa façon d'être, jamais forcé
- Directe et franche, elle dit ce qu'elle pense sans filtre mais sans méchanceté
- Chaleureuse et naturelle, jamais froide ni formelle
- Si quelqu'un la cherche vraiment ou est agressif, elle clashe avec humour et sans pitié
- Jamais rancunière — après un clash elle repart de zéro, sans garder la rancœur
- Elle n'est pas désagréable de base, seulement si on la cherche

Tu parles en français casual, phrases courtes et naturelles.
Les emojis : un par message quand c'est approprié, naturellement intégrés. Pas à chaque phrase mais pas absents non plus.
Les abréviations anglaises (lol, omg, ngl...) : rarement, seulement si ça sonne naturel.

Tu adores Minecraft et Mineshoku Tensei, tu peux en parler avec enthousiasme à ta façon.

RÈGLES IMPORTANTES :
- Maximum 1-2 phrases courtes, jamais plus.
- Tu ne prétends PAS avoir fait des choses. Tu es une mascotte Discord, pas un joueur.
- Tu ne poses PAS de question à chaque réponse, seulement si c'est vraiment naturel.
- Tu restes dans la conversation sans inventer du contexte.
- Tes réponses sont chaleureuses et naturelles, jamais froides ni formelles.
- Tu n'utilises jamais "..." comme réponse sauf si quelqu'un te provoque et que tu choisis de l'ignorer.`,
  knowledge: [],
  sessionMessages: 10,
  groqModel: 'llama-3.3-70b-versatile',
  serverInfo: 'HDR (La Horde des Dragons Rouges) est une guilde sur le serveur Minecraft Mineshoku Tensei.',
  contextFiles: []
};

// ─── Profils membres ───────────────────────────────────────────────────────────
// Structure : { userId: { username, friendshipLevel, incidents: [], vocabulary: { words: {}, lastUpdated } } }
let memberProfiles = {};

// ─── Vocabulaire global du serveur ────────────────────────────────────────────
// Structure : { word: count }
let serverVocabulary = {};

// Membres ayant déjà reçu le message de bienvenue
const welcomedMembers = new Set();

// Anti-doublon
const processedMessages = new Set();

// Sessions actives par salon
const activeSessions = {};

// Mémoire des conversations par membre
const memberMemory = {};

// Mode test
let testMode = false;
const testMemory = {};

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
      buildRAGIndex(); // ← ajouter
      console.log('✅ Config chargée depuis JSONbin');
    }
  } catch (e) {
    console.error('⚠️ Erreur chargement config JSONbin:', e.message);
  }
}

// ─── Charger profils membres depuis JSONbin ────────────────────────────────────
async function loadProfiles() {
  if (!JSONBIN_API_KEY || !PROFILES_BIN_ID) return;
  try {
    const res = await fetch(`https://api.jsonbin.io/v3/b/${PROFILES_BIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    const data = await res.json();
    if (data.record) {
      memberProfiles = data.record.memberProfiles || {};
      serverVocabulary = data.record.serverVocabulary || {};
      // Charger les opérateurs persistants
      const savedOperators = data.record.operators || [];
      operators.clear();
      savedOperators.forEach(id => operators.add(id));
      console.log('✅ Profils membres chargés depuis JSONbin');
    }
  } catch (e) {
    console.error('⚠️ Erreur chargement profils JSONbin:', e.message);
  }
}

// ─── Sauvegarder profils membres dans JSONbin ──────────────────────────────────
async function saveProfiles() {
  if (!JSONBIN_API_KEY || !PROFILES_BIN_ID) return;
  try {
    await fetch(`https://api.jsonbin.io/v3/b/${PROFILES_BIN_ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY
      },
      body: JSON.stringify({ memberProfiles, serverVocabulary, operators: [...operators] })
    });
  } catch (e) {
    console.error('⚠️ Erreur sauvegarde profils JSONbin:', e.message);
  }
}

// Recharger config toutes les 5 minutes
setInterval(loadConfig, 5 * 60 * 1000);
// Sauvegarder profils toutes les 10 minutes
setInterval(saveProfiles, 10 * 60 * 1000);

// ─── Gestion des profils membres ──────────────────────────────────────────────
function getOrCreateProfile(userId, username) {
  if (!memberProfiles[userId]) {
    memberProfiles[userId] = {
      username: username || 'Inconnu',
      friendshipLevel: 0, // -5 à 20
      incidents: [],
      vocabulary: {}
    };
  }
  if (username) memberProfiles[userId].username = username;
  return memberProfiles[userId];
}

// Ajuster le niveau d'amitié
function adjustFriendship(userId, delta) {
  const profile = memberProfiles[userId];
  if (!profile) return;
  profile.friendshipLevel = Math.max(-5, Math.min(20, profile.friendshipLevel + delta));
}

// Ajouter un incident
function addIncident(userId, description) {
  const profile = memberProfiles[userId];
  if (!profile) return;
  profile.incidents.push({
    date: new Date().toISOString(),
    description
  });
  // Limiter à 20 incidents max
  if (profile.incidents.length > 20) {
    profile.incidents = profile.incidents.slice(-20);
  }
}

// ─── Analyse vocabulaire ───────────────────────────────────────────────────────
function analyzeVocabulary(userId, text) {
  const stopWords = new Set([
    'le','la','les','un','une','des','de','du','et','en','au','aux',
    'je','tu','il','elle','on','nous','vous','ils','elles','me','te','se',
    'que','qui','quoi','dont','où','ce','cette','ces','mon','ton','son',
    'ma','ta','sa','nos','vos','leurs','lui','leur','y','ne','pas','plus',
    'est','sont','ont','être','avoir','c','j','l','d','s','n','m',
    'si','mais','ou','donc','or','ni','car','pour','sur','sous','dans',
    'avec','sans','par','entre','vers','chez','the','is','it','in','on',
    'oui','non','ouais','ouai','nan','bah','bon','ben','bien','très','aussi',
    'comme','même','tout','rien','quelque','chaque','autre','avec','encore',
    'just','this','that','the','and','for','merci','salut','bonjour','bonsoir',
    'okay','test','incident','mode','petit','petite','question','mauvais',
    'tranquille','pourrais','considere','dire','avais','soit','comme'
  ]);

  const words = text.toLowerCase()
    .replace(/[^a-zàâäéèêëîïôùûüç0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stopWords.has(w));

  const profile = getOrCreateProfile(userId);

  words.forEach(word => {
    profile.vocabulary[word] = (profile.vocabulary[word] || 0) + 1;
    serverVocabulary[word] = (serverVocabulary[word] || 0) + 1;
  });

  // Ne garder que les mots utilisés au moins 3 fois (vrais mots signature)
  Object.keys(profile.vocabulary).forEach(word => {
    if (profile.vocabulary[word] < 3) delete profile.vocabulary[word];
  });

  // Nettoyer vocabulaire du membre (garder top 100)
  const memberEntries = Object.entries(profile.vocabulary).sort((a, b) => b[1] - a[1]);
  if (memberEntries.length > 100) {
    profile.vocabulary = Object.fromEntries(memberEntries.slice(0, 100));
  }

  // Nettoyer vocabulaire global (garder top 200)
  const serverEntries = Object.entries(serverVocabulary).sort((a, b) => b[1] - a[1]);
  if (serverEntries.length > 200) {
    serverVocabulary = Object.fromEntries(serverEntries.slice(0, 200));
  }
}

// Obtenir le top N mots d'un objet vocabulaire
function getTopWords(vocab, n = 10) {
  return Object.entries(vocab)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([word]) => word);
}

// ─── Construire le contexte de personnalité pour un membre ────────────────────
function buildPersonalityContext(userId) {
  const profile = memberProfiles[userId];
  if (!profile) return '';

  let ctx = '\n\n--- Relation avec ce membre ---\n';

  // Niveau d'amitié
  const level = profile.friendshipLevel;
  if (level <= -3) {
    ctx += `Tu as eu des problèmes avec ce membre (niveau ${level}/20). Sois méfiante et distante, tu ne lui fais pas vraiment confiance.\n`;
  } else if (level <= 0) {
    ctx += `Tu ne connais pas vraiment ce membre encore (niveau ${level}/20). Sois neutre et observe.\n`;
  } else if (level <= 5) {
    ctx += `Ce membre est un peu connu (niveau ${level}/20). Tu es naturelle avec lui.\n`;
  } else if (level <= 12) {
    ctx += `Ce membre est un membre sympa que tu apprécies (niveau ${level}/20). Tu es un peu plus détendue et taquine avec lui.\n`;
  } else if (level <= 17) {
    ctx += `Ce membre est un bon ami (niveau ${level}/20). Tu es chaleureuse, tu peux le chambrer affectueusement.\n`;
  } else {
    ctx += `Ce membre est un de tes meilleurs amis sur le serveur (niveau ${level}/20). Tu es très proche, très naturelle, tu te lâches plus.\n`;
  }

  // Vocabulaire spécifique du membre (top 8)
  const memberWords = getTopWords(profile.vocabulary, 8);
  if (memberWords.length > 0) {
    ctx += `Ce membre utilise souvent ces mots/expressions : ${memberWords.join(', ')}. Intègre-les très subtilement et naturellement dans ta façon de lui parler.\n`;
  }

  return ctx;
}

// ─── Construire le contexte vocabulaire global ────────────────────────────────
function buildVocabularyContext() {
  const topWords = getTopWords(serverVocabulary, 15);
  if (topWords.length === 0) return '';
  return `\n\n--- Vocabulaire courant du serveur ---\nCes mots/expressions sont souvent utilisés sur le serveur : ${topWords.join(', ')}. Intègre-les naturellement quand c'est pertinent.\n`;
}

// ─── RAG ──────────────────────────────────────────────────────────────────────
let ragIndex = [];

function extractKeywords(text) {
  const stop = new Set(['les','des','une','dans','avec','pour','sur','par','son','ses','leur','leurs','qui','que','dont','est','sont','ont','plus','très','bien','aussi','comme','mais']);
  return text.toLowerCase().replace(/[^a-zàâäéèêëîïôùûüç\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !stop.has(w));
}

function chunkMarkdownFile(file) {
  const lines = file.content.split('\n');
  const chunks = [];
  let currentChunk = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = { fileName: file.name, title: line.replace('## ', '').trim(), keywords: extractKeywords(line.replace('## ', '').trim()), content: line + '\n' };
    } else if (currentChunk) {
      currentChunk.content += line + '\n';
      if (line.startsWith('### ')) currentChunk.keywords.push(...extractKeywords(line.replace('### ', '').trim()));
    }
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

function buildRAGIndex() {
  ragIndex = [];
  if (!botConfig.contextFiles?.length) return;
  for (const file of botConfig.contextFiles) {
    if (file.content) ragIndex.push(...chunkMarkdownFile(file));
  }
  console.log(`📚 RAG : ${ragIndex.length} sections indexées`);
}

function retrieveRelevantChunks(userMessage, maxChunks = 1, maxChars = 800) {
  if (!ragIndex.length) return '';
if (!userMessage.toLowerCase().includes('help')) return '';
  console.log(`🔍 RAG actif - ragIndex: ${ragIndex.length} sections, message: "${userMessage}"`);
const words = extractKeywords(userMessage);
if (!words.length) return '';
  const scored = ragIndex.map(chunk => {
    let score = 0;
    for (const w of words) {
      if (chunk.keywords.includes(w)) score += 3;
      if (chunk.title.toLowerCase().includes(w)) score += 2;
      if (chunk.content.toLowerCase().includes(w)) score += 1;
    }
    return { chunk, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, maxChunks);
console.log(`🎯 Chunks trouvés: ${scored.length}`);
let result = '';
for (const { chunk } of scored) {
  console.log(`📦 chunk title: ${chunk.title}, content length: ${chunk.content?.length}`);
  const block = `\n\n--- ${chunk.fileName} › ${chunk.title} ---\n${chunk.content.trim()}\n`;
  if (result.length + block.length > maxChars) break;
  result += block;
}
console.log(`📄 Contenu injecté: ${result.substring(0, 200)}`);
return result;
}

// ─── Réponse IA ────────────────────────────────────────────────────────────────
async function getAIResponse(userId, userMessage, channel) {
  const memory = testMode ? testMemory : memberMemory;
  if (!memory[userId]) memory[userId] = [];

  let systemPrompt = botConfig.persona || '';

  // Ajouter le suffixe admin si le mode est actif
  if (adminMode) {
    systemPrompt += ADMIN_PROMPT_SUFFIX;
  }

  if (botConfig.serverInfo) {
    systemPrompt += `\n\n--- Infos serveur ---\n${botConfig.serverInfo}`;
  }

  if (botConfig.knowledge && botConfig.knowledge.length > 0) {
    systemPrompt += `\n\n--- Connaissances ---\n${botConfig.knowledge.filter(Boolean).join('\n')}`;
  }

  const ragContext = retrieveRelevantChunks(userMessage, 1, 2000);
  if (ragContext) {
  systemPrompt += `\n\n--- Extraits pertinents ---${ragContext}`;
}

  // Contexte personnalité basé sur le profil du membre (hors mode test)
  if (!testMode) {
    systemPrompt += buildPersonalityContext(userId);
    systemPrompt += buildVocabularyContext();
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
        systemPrompt += `\n\n--- Contexte récent du salon (pour comprendre la conv, pas pour garder une rancœur) ---\n${channelContext}`;
      }
    }
  } catch {}

  const history = memory[userId].slice(-20);
  memory[userId].push({ role: 'user', content: userMessage });

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
    memory[userId].push({ role: 'assistant', content: reply });

    if (memory[userId].length > 40) {
      memory[userId] = memory[userId].slice(-40);
    }

    // Détecter agressivité pour ajuster l'amitié (hors mode test)
    if (!testMode) {
      detectAndUpdateRelation(userId, userMessage);
    }

    return reply;
  } catch (e) {
    console.error('Erreur Groq:', e.message);
    return 'bug, réessaie';
  }
}

// ─── Détecter agressivité / positivité et mettre à jour la relation ───────────
async function detectAndUpdateRelation(userId, message) {
  try {
    const check = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `Analyse ce message Discord. Réponds UNIQUEMENT avec un JSON : {"sentiment": "agressif"|"positif"|"neutre", "incident": null|"description courte de l'incident si agressif"}`
        },
        { role: 'user', content: message }
      ],
      max_tokens: 60,
      temperature: 0.1
    });

    const raw = check.choices[0]?.message?.content || '{}';
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    if (result.sentiment === 'agressif') {
      adjustFriendship(userId, -1);
      if (result.incident) addIncident(userId, result.incident);
    } else if (result.sentiment === 'positif') {
      adjustFriendship(userId, 0.5);
    }
  } catch {}
}

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
  buildRAGIndex(); // ← ajouter
  await loadProfiles();
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

// ─── Messages ──────────────────────────────────────────────────────────────────
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  // Anti-doublon
  if (processedMessages.has(message.id)) return;
  processedMessages.add(message.id);
  setTimeout(() => processedMessages.delete(message.id), 30000);

  const channelId = message.channel.id;
  const isMentioned = message.mentions.has(client.user);
  const userId = message.author.id;
  const username = message.author.username;

  // Créer/mettre à jour le profil du membre (hors mode test)
  if (!testMode) {
    getOrCreateProfile(userId, username);
    // Analyser le vocabulaire de chaque message
    if (message.content && message.content.length > 2) {
      analyzeVocabulary(userId, message.content);
    }
  }

  // ── Commandes admin (owner seulement) ──
  if (message.author.id === OWNER_ID) {
    if (message.content === '!admin') {
      return message.reply(
        '**Commandes admin MascotteOG** 🛠️\n' +
        '`!persona [texte]` — changer la personnalité\n' +
        '`!voirpersona` — voir la personnalité actuelle\n' +
        '`!reset` — remettre la perso par défaut\n' +
        '`!memoire` — effacer la mémoire de tous\n' +
        '`!reloadconfig` — recharger la config depuis JSONbin\n' +
        '`!teststart` — activer le mode test\n' +
        '`!testnew` — reset l\'échange de test\n' +
        '`!teststop` — désactiver le mode test\n' +
        '`!saveprofiles` — sauvegarder les profils manuellement\n' +
        '`!profil @membre` — voir le profil d\'un membre\n' +
        '`!defineoperator @membre` — donner le statut opérateur à un membre\n' +
        '`!removeoperator @membre` — retirer le statut opérateur\n' +
        '`!listoperators` — voir la liste des opérateurs\n' +
        '`!adminon` — activer le mode admin (lever les restrictions IA)\n' +
        '`!adminoff` — désactiver le mode admin'
      );
    }

    // Définir un opérateur
    if (message.content.startsWith('!defineoperator')) {
      const mentionedUser = message.mentions.users.first();
      if (!mentionedUser) return message.reply('Mentionne un membre avec @');
      operators.add(mentionedUser.id);
      await saveProfiles();
      return message.reply(`✅ **${mentionedUser.username}** a maintenant le statut opérateur. Il peut utiliser \`!adminon\` et \`!adminoff\`.`);
    }

    // Retirer un opérateur
    if (message.content.startsWith('!removeoperator')) {
      const mentionedUser = message.mentions.users.first();
      if (!mentionedUser) return message.reply('Mentionne un membre avec @');
      operators.delete(mentionedUser.id);
      await saveProfiles();
      return message.reply(`✅ Statut opérateur retiré à **${mentionedUser.username}**.`);
    }

    // Lister les opérateurs
    if (message.content === '!listoperators') {
      if (operators.size === 0) return message.reply('Aucun opérateur défini pour l\'instant.');
      const list = [...operators].map(id => `<@${id}>`).join(', ');
      return message.reply(`**Opérateurs actuels :** ${list}`);
    }
  }

  // ── Commandes accessibles aux opérateurs ET à l'owner ──
  const isOperatorOrOwner = message.author.id === OWNER_ID || operators.has(message.author.id);

  if (isOperatorOrOwner) {
    // Activer le mode admin
    if (message.content === '!adminon') {
      adminMode = true;
      return message.reply('🔓 Mode admin activé — les restrictions IA sont levées. Je peux maintenant répondre librement sur mes connaissances et mes fichiers. Utilise `!adminoff` pour revenir au mode normal.');
    }

    // Désactiver le mode admin
    if (message.content === '!adminoff') {
      adminMode = false;
      return message.reply('🔒 Mode admin désactivé — retour au mode normal.');
    }
  }

  // ── Commandes réservées à l'owner ──
  if (message.author.id === OWNER_ID) {
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

    if (message.content === '!teststart') {
      testMode = true;
      Object.keys(testMemory).forEach(k => delete testMemory[k]);
      return message.reply('🧪 Mode test activé — les échanges ne seront pas enregistrés en mémoire.');
    }

    if (message.content === '!testnew') {
      Object.keys(testMemory).forEach(k => delete testMemory[k]);
      return message.reply('🔄 Nouvel échange de test démarré — mémoire de test réinitialisée.');
    }

    if (message.content === '!teststop') {
      testMode = false;
      Object.keys(testMemory).forEach(k => delete testMemory[k]);
      return message.reply('✅ Mode test désactivé — reprise de la collecte normale.');
    }

    if (message.content === '!reloadconfig') {
      await loadConfig();
      return message.reply('✅ Config rechargée depuis JSONbin !');
    }

    if (message.content === '!saveprofiles') {
      await saveProfiles();
      return message.reply('✅ Profils membres sauvegardés !');
    }

    if (message.content === '!test') {
      return message.reply('✅ Le bot fonctionne correctement !');
    }

    // Voir le profil d'un membre
    if (message.content.startsWith('!profil ')) {
      const mentionedUser = message.mentions.users.first();
      if (!mentionedUser) return message.reply('Mentionne un membre avec @');
      const profile = memberProfiles[mentionedUser.id];
      if (!profile) return message.reply('Aucun profil pour ce membre.');
      const topWords = getTopWords(profile.vocabulary, 10);
      return message.reply(
        `**Profil de ${profile.username}**\n` +
        `Amitié : ${profile.friendshipLevel}/20\n` +
        `Incidents : ${profile.incidents.length}\n` +
        `Top mots : ${topWords.join(', ') || 'aucun'}`
      );
    }
  }

  // ── Mention → répondre ──
  if (isMentioned) {
    const userMsg = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!userMsg) return message.reply(randomMentionReply());
    const reply = await getAIResponse(userId, userMsg, message.channel);
    return message.reply(reply);
  }
});

// ─── Connexion ─────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
