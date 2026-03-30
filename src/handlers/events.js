// src/handlers/events.js - Gestion des événements Discord
const { initFiles, getUserData, saveUserData, getMinigameChannel, getNextMinigameTime } = require('../utils/database');
const { initServerConfig, isCoinsDisabledChannel } = require('../utils/permissions');
const { COINS_PER_MESSAGE_INTERVAL, MIN_MESSAGE_LENGTH } = require('../config/settings');

// ─── Anti-spam : limite de coins par minute par utilisateur (par guild) ───────
// Clé : `${guildId}:${userId}` → { count: number, windowStart: timestamp }
const coinsRateLimit = new Map();

const COINS_PER_MINUTE_MAX = 3; // coins maximum gagnables par minute

function canEarnCoin(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const entry = coinsRateLimit.get(key);

  if (!entry || now - entry.windowStart >= 60_000) {
    // Nouvelle fenêtre d'une minute
    coinsRateLimit.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count < COINS_PER_MINUTE_MAX) {
    entry.count++;
    return true;
  }

  // Plafond atteint pour cette minute
  return false;
}

function setupEvents(client) {
  client.once('clientReady', async () => {
    initFiles();
    console.log(`🔴🔵 Bot PSG connecté en tant que ${client.user.tag}`);
    console.log(`📊 Serveurs : ${client.guilds.cache.size}`);
    for (const guild of client.guilds.cache.values()) {
      initServerConfig(String(guild.id), guild.name);
    }
    try {
      const { REST, Routes } = require('discord.js');
      const { TOKEN } = require('../config/settings');
      const rest = new REST().setToken(TOKEN);
      const data = await rest.put(Routes.applicationCommands(client.user.id), { body: buildCommandsJSON() });
      console.log(`✅ ${data.length} commande(s) slash synchronisée(s)`);
      console.log('📝 Système de logs activé');
      console.log('⚡ Système de mini-jeu activé');
      console.log(`🔒 Anti-spam: longueur min = ${MIN_MESSAGE_LENGTH} caractères, max ${COINS_PER_MINUTE_MAX} coins/minute`);
    } catch (e) {
      console.error('❌ Erreur de synchronisation:', e.message);
    }
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        const guildId = String(guild.id);
        const channelId = getMinigameChannel(guildId);
        if (!channelId) continue;
        try {
          const nextTime = getNextMinigameTime(guildId);
          if (Date.now() >= nextTime.getTime()) {
            const { spawnMinigame } = require('../commands/minigame');
            await spawnMinigame(client, guildId);
          }
        } catch (e) {
          console.error(`❌ Erreur mini-jeu pour ${guild.name}:`, e.message);
        }
      }
    }, 60000);
  });

  client.on('guildCreate', (guild) => {
    initServerConfig(String(guild.id), guild.name);
    console.log(`✅ Configuration créée pour ${guild.name} (${guild.id})`);
  });

  client.on('guildMemberAdd', async (member) => {
    getUserData(String(member.guild.id), String(member.id));
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.content.startsWith('/')) return;

    const guildId = String(message.guild.id);
    const userId = String(message.author.id);
    const channelId = String(message.channel.id);
    const parentId = message.channel.parentId ? String(message.channel.parentId) : null;

    if (isCoinsDisabledChannel(guildId, channelId, parentId)) return;

    const clean = message.content.trim();
    if (clean.length < MIN_MESSAGE_LENGTH) return;

    const userData = getUserData(guildId, userId);
    userData.messages++;

    // Gagner 1 coin tous les COINS_PER_MESSAGE_INTERVAL messages,
    // dans la limite de COINS_PER_MINUTE_MAX coins par minute
    if (userData.messages % COINS_PER_MESSAGE_INTERVAL === 0) {
      if (canEarnCoin(guildId, userId)) {
        userData.coins++;
        console.log(`💰 ${message.author.username} a gagné 1 coin sur ${message.guild.name}`);
      } else {
        console.log(`🚫 ${message.author.username} a atteint la limite de ${COINS_PER_MINUTE_MAX} coins/min sur ${message.guild.name}`);
      }
    }

    saveUserData(guildId, userId, userData);
  });
}

function buildCommandsJSON() {
  const { ApplicationCommandOptionType } = require('discord.js');
  return [
    { name: 'addcoins', description: '[ADMIN] Ajouter des PSG Coins à un membre', options: [{ name: 'membre', description: 'Le membre', type: ApplicationCommandOptionType.User, required: true }, { name: 'montant', description: 'Montant', type: ApplicationCommandOptionType.Integer, required: true }] },
    { name: 'removecoins', description: '[ADMIN] Retirer des PSG Coins à un membre', options: [{ name: 'membre', description: 'Le membre', type: ApplicationCommandOptionType.User, required: true }, { name: 'montant', description: 'Montant', type: ApplicationCommandOptionType.Integer, required: true }] },
    { name: 'setcoins', description: '[ADMIN] Définir le solde exact d\'un membre', options: [{ name: 'membre', description: 'Le membre', type: ApplicationCommandOptionType.User, required: true }, { name: 'montant', description: 'Nouveau solde', type: ApplicationCommandOptionType.Integer, required: true }] },
    { name: 'give', description: '[ADMIN] Donner une carte à un membre', options: [{ name: 'carte_id', description: "L'ID de la carte", type: ApplicationCommandOptionType.String, required: true }, { name: 'membre', description: 'Le membre', type: ApplicationCommandOptionType.User, required: true }, { name: 'raison', description: 'Raison (optionnel)', type: ApplicationCommandOptionType.String, required: false }] },
    { name: 'config', description: '[ADMIN] Configurer le bot de manière interactive' },
    {
      name: 'collection',
      description: 'Voir la collection de cartes d\'un membre',
      options: [{ name: 'membre', description: '(Optionnel) Le membre dont tu veux voir la collection', type: ApplicationCommandOptionType.User, required: false }],
    },
  ];
}

module.exports = { setupEvents };