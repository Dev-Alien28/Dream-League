// src/utils/database.js - Base de données Enmap (SQLite)
const { default: Enmap } = require('enmap');
const fs = require('fs');
const path = require('path');
const {
  DATA_DIR, PACKS_DIR, PACKS_CONFIG, MINIGAME_CONFIG, COINS_ON_JOIN,
} = require('../config/settings');

// ==================== CRÉATION DES DOSSIERS AVANT ENMAP ====================

fs.mkdirSync(path.join(DATA_DIR, 'enmap'), { recursive: true });
fs.mkdirSync(PACKS_DIR, { recursive: true });

// ==================== ENMAPS ====================

// Enmap pour les données utilisateurs (par guild → par user)
const users = new Enmap({
  name: 'users',
  dataDir: path.join(DATA_DIR, 'enmap'),
  ensureProps: true,
});

// Enmap pour les états d'événements (mini-jeu)
const events = new Enmap({
  name: 'events',
  dataDir: path.join(DATA_DIR, 'enmap'),
});

// Enmap pour les rappels automatiques (remplace reminder_config.json)
const reminders = new Enmap({
  name: 'reminders',
  dataDir: path.join(DATA_DIR, 'enmap'),
});

// Enmap pour les configurations serveur (remplace /servers/<guildId>.json)
const servers = new Enmap({
  name: 'servers',
  dataDir: path.join(DATA_DIR, 'enmap'),
});

// ==================== INITIALISATION ====================

function initFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PACKS_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'enmap'), { recursive: true });

  console.log('✅ Base de données Enmap initialisée');
}

// ==================== HELPERS CLÉS ====================

function userKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

// ==================== UTILISATEURS ====================

function initUser() {
  return {
    coins: COINS_ON_JOIN,
    messages: 0,
    collection: [],
    last_free_pack: null,
  };
}

function getUserData(guildId, userId) {
  const key = userKey(guildId, userId);
  if (!users.has(key)) {
    users.set(key, initUser());
  }
  return users.get(key);
}

function saveUserData(guildId, userId, userData) {
  const key = userKey(guildId, userId);
  users.set(key, userData);
}

function getGuildData(guildId) {
  const guildUsers = {};
  const allEntries = users.entries ? [...users.entries()] : [...users];
  for (const [key, data] of allEntries) {
    if (key.startsWith(`${guildId}:`)) {
      const userId = key.split(':')[1];
      guildUsers[userId] = data;
    }
  }
  return guildUsers;
}

function addCardToUser(guildId, userId, card) {
  const userData = getUserData(guildId, userId);
  userData.collection.push(card);
  saveUserData(guildId, userId, userData);
}

function removeCoins(guildId, userId, amount) {
  const userData = getUserData(guildId, userId);
  if (userData.coins < amount) return false;
  userData.coins -= amount;
  saveUserData(guildId, userId, userData);
  return true;
}

function getUserCardsGrouped(guildId, userId) {
  const userData = getUserData(guildId, userId);
  const collection = userData.collection || [];
  const cardCount = {};

  for (const card of collection) {
    const cardId = card.id;
    if (!cardCount[cardId]) {
      cardCount[cardId] = { card, count: 0 };
    }
    cardCount[cardId].count++;
  }

  return cardCount;
}

// ==================== PACKS (restent en JSON) ====================

function loadPackCards(packKey) {
  const packInfo = PACKS_CONFIG[packKey];
  if (!packInfo) return [];

  const filepath = path.join(PACKS_DIR, packInfo.fichier);
  if (fs.existsSync(filepath)) {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  }
  return [];
}

function loadAllCards() {
  const allCards = {};
  if (!fs.existsSync(PACKS_DIR)) return allCards;

  const files = fs.readdirSync(PACKS_DIR).filter(f => f.endsWith('.json'));
  for (const filename of files) {
    const filepath = path.join(PACKS_DIR, filename);
    try {
      const cards = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      for (const card of cards) {
        if (card.id) allCards[card.id] = card;
      }
    } catch (e) {
      console.error(`❌ Erreur chargement ${filepath}:`, e.message);
    }
  }
  return allCards;
}

function findCardById(cardId) {
  const allCards = loadAllCards();
  return allCards[cardId] || null;
}

// ==================== FREE PACK ====================

function canClaimFreePack(guildId, userId) {
  const userData = getUserData(guildId, userId);
  const lastClaim = userData.last_free_pack;

  if (!lastClaim) return true;

  const lastClaimTime = new Date(lastClaim).getTime();
  const cooldown = PACKS_CONFIG.free_pack.cooldown * 1000;
  const elapsed = Date.now() - lastClaimTime;
  return elapsed >= cooldown;
}

function claimFreePack(guildId, userId) {
  const userData = getUserData(guildId, userId);
  userData.last_free_pack = new Date().toISOString();
  saveUserData(guildId, userId, userData);
  console.log(`✅ Pack gratuit réclamé par ${userId} sur ${guildId}`);
}

function getFreePackCooldown(guildId, userId) {
  const userData = getUserData(guildId, userId);
  const lastClaim = userData.last_free_pack;

  if (!lastClaim) return 0;

  const lastClaimTime = new Date(lastClaim).getTime();
  const cooldown = PACKS_CONFIG.free_pack.cooldown * 1000;
  const elapsed = Date.now() - lastClaimTime;
  return Math.max(0, Math.floor((cooldown - elapsed) / 1000));
}

// ==================== ÉVÉNEMENTS / MINI-JEU ====================

function loadEventState() {
  return events.fetchEverything();
}

function saveEventState(state) {
  events.clear();
  for (const [k, v] of Object.entries(state)) events.set(k, v);
}

function getNextMinigameTime(guildId) {
  const guildKey = `minigame_${guildId}`;
  const state = events.get(guildKey);

  if (!state || !state.next_spawn) {
    const days = Math.floor(Math.random() * (MINIGAME_CONFIG.max_interval_days - MINIGAME_CONFIG.min_interval_days + 1)) + MINIGAME_CONFIG.min_interval_days;
    const nextTime = new Date();
    nextTime.setDate(nextTime.getDate() + days);

    const hour = Math.floor(Math.random() * (MINIGAME_CONFIG.end_hour - MINIGAME_CONFIG.start_hour)) + MINIGAME_CONFIG.start_hour;
    const minute = Math.floor(Math.random() * 60);
    nextTime.setHours(hour, minute, 0, 0);

    events.set(guildKey, {
      next_spawn: nextTime.toISOString(),
      last_spawn: null,
    });
    return nextTime;
  }

  return new Date(state.next_spawn);
}

function scheduleNextMinigame(guildId) {
  const guildKey = `minigame_${guildId}`;
  const days = Math.floor(Math.random() * (MINIGAME_CONFIG.max_interval_days - MINIGAME_CONFIG.min_interval_days + 1)) + MINIGAME_CONFIG.min_interval_days;
  const nextTime = new Date();
  nextTime.setDate(nextTime.getDate() + days);

  const hour = Math.floor(Math.random() * (MINIGAME_CONFIG.end_hour - MINIGAME_CONFIG.start_hour)) + MINIGAME_CONFIG.start_hour;
  const minute = Math.floor(Math.random() * 60);
  nextTime.setHours(hour, minute, 0, 0);

  events.set(guildKey, {
    next_spawn: nextTime.toISOString(),
    last_spawn: new Date().toISOString(),
  });
  return nextTime;
}

function getMinigameChannel(guildId) {
  const guildKey = `minigame_${guildId}`;
  const state = events.get(guildKey);
  return state?.channel_id || null;
}

function setMinigameChannel(guildId, channelId) {
  const guildKey = `minigame_${guildId}`;
  const state = events.get(guildKey) || {};
  if (channelId === null) {
    delete state.channel_id;
  } else {
    state.channel_id = String(channelId);
  }
  events.set(guildKey, state);
}

// ==================== CONFIGS SERVEUR (Enmap, ex-JSON) ====================

function initServerConfig(guildId, guildName) {
  if (!servers.has(String(guildId))) {
    servers.set(String(guildId), {
      guild_id: guildId,
      guild_name: guildName,
      channels: { solde: [], packs: [], collection: [] },
      roles: { admin: [], moderator: [] },
      no_coins_channels: [],
      logs_channel: null,
    });
    console.log(`✅ Config serveur initialisée pour ${guildName} (${guildId})`);
  }
  return servers.get(String(guildId));
}

function loadServerConfig(guildId) {
  return servers.get(String(guildId)) || null;
}

function saveServerConfig(guildId, config) {
  servers.set(String(guildId), config);
}

// ==================== RAPPELS AUTOMATIQUES (Enmap, ex-JSON) ====================

function initReminderGuild(guildId) {
  if (!reminders.has(String(guildId))) {
    reminders.set(String(guildId), {
      enabled: false,
      channel_id: null,
      interval_hours: 6.0,
      discussion_channel_id: null,
    });
  }
  return reminders.get(String(guildId));
}

function getReminderConfig(guildId) {
  return reminders.get(String(guildId)) || null;
}

function setReminderConfig(guildId, config) {
  reminders.set(String(guildId), config);
}

function getAllReminderConfigs() {
  const all = {};
  const allEntries = reminders.entries ? [...reminders.entries()] : [...reminders];
  for (const [key, value] of allEntries) {
    all[key] = value;
  }
  return all;
}

function deleteReminderConfig(guildId) {
  reminders.delete(String(guildId));
}

// ==================== EXPORTS ====================

module.exports = {
  // DB instances
  users,
  events,
  reminders,
  servers,

  // Fonctions utilisateurs
  initFiles,
  getUserData,
  saveUserData,
  getGuildData,
  addCardToUser,
  removeCoins,
  getUserCardsGrouped,

  // Packs
  loadPackCards,
  loadAllCards,
  findCardById,

  // Free pack
  canClaimFreePack,
  claimFreePack,
  getFreePackCooldown,

  // Événements / mini-jeu
  loadEventState,
  saveEventState,
  getNextMinigameTime,
  scheduleNextMinigame,
  getMinigameChannel,
  setMinigameChannel,

  // Configs serveur (ex-JSON /servers/<guildId>.json)
  initServerConfig,
  loadServerConfig,
  saveServerConfig,

  // Rappels automatiques (ex-JSON reminder_config.json)
  initReminderGuild,
  getReminderConfig,
  setReminderConfig,
  getAllReminderConfigs,
  deleteReminderConfig,
};