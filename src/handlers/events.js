// src/handlers/events.js - Gestion des événements Discord — V4
const { initFiles, getUserData, saveUserData, getMinigameChannel, getNextMinigameTime, scheduleNextMinigame } = require('../utils/database');
const { initServerConfig, isCoinsDisabledChannel } = require('../utils/permissions');
const { COINS_PER_MESSAGE_INTERVAL, MIN_MESSAGE_LENGTH } = require('../config/settings');
const { initAllRappels } = require('../commands/rappel');

// ─── Anti-spam : limite de coins par minute par utilisateur (par guild) ───────
const coinsRateLimit = new Map();
const COINS_PER_MINUTE_MAX = 4;

function canEarnCoin(guildId, userId) {
  const key   = `${guildId}:${userId}`;
  const now   = Date.now();
  const entry = coinsRateLimit.get(key);
  if (!entry || now - entry.windowStart >= 60_000) {
    coinsRateLimit.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count < COINS_PER_MINUTE_MAX) {
    entry.count++;
    return true;
  }
  return false;
}

// ─── Verrou async par guild pour éviter les doubles spawns ───────────────────
const spawnLocks = new Map();

async function trySpawn(client, guildId) {
  if (spawnLocks.get(guildId)) return;

  const { activeEncounters, spawnMinigame } = require('../commands/minigame');

  if (activeEncounters.has(guildId)) return;

  const nextTime = getNextMinigameTime(guildId);
  if (Date.now() < nextTime.getTime()) return;

  spawnLocks.set(guildId, true);
  try {
    await spawnMinigame(client, guildId);
  } catch (e) {
    const guild = client.guilds.cache.get(guildId);
    console.error(`❌ Erreur spawn encounter pour ${guild?.name ?? guildId}:`, e.message);
    scheduleNextMinigame(guildId);
  } finally {
    spawnLocks.delete(guildId);
  }
}

function setupEvents(client) {
  client.once('clientReady', async () => {
    initFiles();
    initAllRappels(client);
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

    // ── Vérification immédiate au démarrage ───────────────────────────────────
    for (const guild of client.guilds.cache.values()) {
      const guildId          = String(guild.id);
      const encounterChannel = getMinigameChannel(guildId);
      console.log(`🔍 [DEBUG] ${guild.name} (${guildId}) — salon encounter : ${encounterChannel ?? 'NON CONFIGURÉ'}`);
      if (!encounterChannel) continue;

      const nextTime = getNextMinigameTime(guildId);
      if (Date.now() >= nextTime.getTime()) {
        console.log(`⚡ Encounter en retard détecté sur ${guild.name} — spawn immédiat`);
        trySpawn(client, guildId);
      } else {
        const diff = Math.ceil((nextTime.getTime() - Date.now()) / 60000);
        console.log(`⏱️  Prochain encounter sur ${guild.name} dans ~${diff} min`);
      }
    }

    // ── Boucle toutes les 60s ─────────────────────────────────────────────────
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        const guildId = String(guild.id);
        if (!getMinigameChannel(guildId)) continue;
        await trySpawn(client, guildId);
      }
    }, 60_000);
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

    const guildId   = String(message.guild.id);
    const userId    = String(message.author.id);
    const channelId = String(message.channel.id);
    const parentId  = message.channel.parentId ? String(message.channel.parentId) : null;

    if (isCoinsDisabledChannel(guildId, channelId, parentId)) return;

    const clean = message.content.trim();
    if (clean.length < MIN_MESSAGE_LENGTH) return;

    const userData = getUserData(guildId, userId);
    userData.messages++;

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
    {
      name: 'addcoins',
      description: '[ADMIN] Ajouter des PSG Coins à un membre',
      default_member_permissions: '0',
      options: [
        { name: 'membre',  description: 'Le membre', type: ApplicationCommandOptionType.User,    required: true },
        { name: 'montant', description: 'Montant',   type: ApplicationCommandOptionType.Integer, required: true },
      ],
    },
    {
      name: 'removecoins',
      description: '[ADMIN] Retirer des PSG Coins à un membre (solde peut être négatif)',
      default_member_permissions: '0',
      options: [
        { name: 'membre',  description: 'Le membre',         type: ApplicationCommandOptionType.User,    required: true },
        { name: 'montant', description: 'Montant à retirer', type: ApplicationCommandOptionType.Integer, required: true },
      ],
    },
    {
      name: 'setcoins',
      description: '[ADMIN] Définir le solde exact d\'un membre',
      default_member_permissions: '0',
      options: [
        { name: 'membre',  description: 'Le membre',     type: ApplicationCommandOptionType.User,    required: true },
        { name: 'montant', description: 'Nouveau solde', type: ApplicationCommandOptionType.Integer, required: true },
      ],
    },
    {
      name: 'give',
      description: '[ADMIN] Donner une carte à un membre',
      default_member_permissions: '0',
      options: [
        { name: 'carte_id', description: "L'ID de la carte",   type: ApplicationCommandOptionType.String,  required: true  },
        { name: 'membre',   description: 'Le membre',          type: ApplicationCommandOptionType.User,    required: true  },
        { name: 'raison',   description: 'Raison (optionnel)', type: ApplicationCommandOptionType.String,  required: false },
      ],
    },
    {
      name: 'removecard',
      description: '[ADMIN] Retirer une carte de la collection d\'un membre',
      default_member_permissions: '0',
      options: [
        { name: 'membre', description: 'Le membre dont retirer une carte', type: ApplicationCommandOptionType.User, required: true },
      ],
    },
    {
      name: 'config',
      description: '[ADMIN] Configurer le bot de manière interactive',
      default_member_permissions: '0',
    },
    {
      name: 'rappel',
      description: '[ADMIN] Gérer les rappels automatiques',
      default_member_permissions: '0',
      options: [
        {
          name: 'creer',
          description: 'Créer un nouveau rappel automatique',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            { name: 'salon',   description: 'Salon où envoyer le rappel',      type: ApplicationCommandOptionType.Channel,  required: true  },
            { name: 'message', description: 'Texte du rappel',                 type: ApplicationCommandOptionType.String,   required: true  },
            { name: 'heures',  description: 'Heure(s) d\'envoi ex: "8h 16h"', type: ApplicationCommandOptionType.String,   required: true  },
            { name: 'role',    description: 'Rôle à mentionner (optionnel)',   type: ApplicationCommandOptionType.Role,     required: false },
          ],
        },
        {
          name: 'liste',
          description: 'Voir tous les rappels configurés',
          type: ApplicationCommandOptionType.Subcommand,
        },
        {
          name: 'supprimer',
          description: 'Supprimer un rappel',
          type: ApplicationCommandOptionType.Subcommand,
          options: [
            { name: 'id', description: 'ID du rappel (visible dans /rappel liste)', type: ApplicationCommandOptionType.String, required: true },
          ],
        },
      ],
    },
    // ── /stats (V2) ───────────────────────────────────────────────────────────
    {
      name: 'stats',
      description: '[ADMIN] Afficher les statistiques complètes de PSG Dream League',
      default_member_permissions: '0',
    },
    // ── /transfert (V1) ───────────────────────────────────────────────────────
    {
      name: 'transfert',
      description: '[STAFF] Transférer la collection et les coins d\'un membre vers un autre',
      default_member_permissions: '0',
      options: [
        {
          name:        'source',
          description: 'Membre dont les données seront transférées (ancien compte)',
          type:        ApplicationCommandOptionType.User,
          required:    true,
        },
        {
          name:        'cible',
          description: 'Membre qui recevra les données (nouveau compte)',
          type:        ApplicationCommandOptionType.User,
          required:    true,
        },
      ],
    },
    // ── /simmatches ───────────────────────────────────────────────────────────
    {
      name: 'simmatches',
      description: '[ADMIN] Simuler des matchs de test en masse dans un thread privé',
      default_member_permissions: '0',
      options: [
        {
          name:        'nombre',
          description: 'Nombre de matchs à simuler (1-30, défaut: 10)',
          type:        ApplicationCommandOptionType.Integer,
          required:    false,
          min_value:   1,
          max_value:   30,
        },
      ],
    },
    // ── /statsmatch ───────────────────────────────────────────────────────────
    {
      name: 'statsmatch',
      description: 'Voir les statistiques de match PSG Dream League',
      options: [
        {
          name:        'classement',
          description: 'Top 10 des joueurs (victoires, nuls, défaites, win rate)',
          type:        ApplicationCommandOptionType.Subcommand,
        },
      ],
    },
  ];
}

module.exports = { setupEvents };