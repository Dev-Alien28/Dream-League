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

const users = new Enmap({ name: 'users', dataDir: path.join(DATA_DIR, 'enmap'), ensureProps: true });
const events = new Enmap({ name: 'events', dataDir: path.join(DATA_DIR, 'enmap') });
const reminders = new Enmap({ name: 'reminders', dataDir: path.join(DATA_DIR, 'enmap') });
const servers = new Enmap({ name: 'servers', dataDir: path.join(DATA_DIR, 'enmap') });

// Enmap pour stocker les messages Gaming Room (channelId → messageId) par guild
const gamingRooms = new Enmap({ name: 'gaming_rooms', dataDir: path.join(DATA_DIR, 'enmap') });

// ==================== INITIALISATION ====================

function initFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PACKS_DIR, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'enmap'), { recursive: true });
  console.log('✅ Base de données Enmap initialisée');
}

// ==================== HELPERS CLÉS ====================

function userKey(guildId, userId) { return `${guildId}:${userId}`; }

// ==================== UTILISATEURS ====================

function initUser() {
  return { coins: COINS_ON_JOIN, messages: 0, collection: [], last_free_pack: null };
}

function getUserData(guildId, userId) {
  const key = userKey(guildId, userId);
  if (!users.has(key)) users.set(key, initUser());
  return users.get(key);
}

function saveUserData(guildId, userId, userData) {
  users.set(userKey(guildId, userId), userData);
}

function getGuildData(guildId) {
  const guildUsers = {};
  const allEntries = users.entries ? [...users.entries()] : [...users];
  for (const [key, data] of allEntries) {
    if (key.startsWith(`${guildId}:`)) {
      guildUsers[key.split(':')[1]] = data;
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
    if (!cardCount[card.id]) cardCount[card.id] = { card, count: 0 };
    cardCount[card.id].count++;
  }
  return cardCount;
}

// ==================== PACKS (JSON) ====================

function loadPackCards(packKey) {
  const packInfo = PACKS_CONFIG[packKey];
  if (!packInfo) return [];
  const filepath = path.join(PACKS_DIR, packInfo.fichier);
  if (fs.existsSync(filepath)) return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  return [];
}

function loadAllCards() {
  const allCards = {};
  if (!fs.existsSync(PACKS_DIR)) return allCards;
  for (const filename of fs.readdirSync(PACKS_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const cards = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, filename), 'utf-8'));
      for (const card of cards) { if (card.id) allCards[card.id] = card; }
    } catch (e) { console.error(`❌ Erreur chargement ${filename}:`, e.message); }
  }
  return allCards;
}

function findCardById(cardId) {
  return loadAllCards()[cardId] || null;
}

// ==================== FREE PACK ====================

function canClaimFreePack(guildId, userId) {
  const userData = getUserData(guildId, userId);
  if (!userData.last_free_pack) return true;
  const elapsed = Date.now() - new Date(userData.last_free_pack).getTime();
  return elapsed >= PACKS_CONFIG.free_pack.cooldown * 1000;
}

function claimFreePack(guildId, userId) {
  const userData = getUserData(guildId, userId);
  userData.last_free_pack = new Date().toISOString();
  saveUserData(guildId, userId, userData);
}

function getFreePackCooldown(guildId, userId) {
  const userData = getUserData(guildId, userId);
  if (!userData.last_free_pack) return 0;
  const elapsed = Date.now() - new Date(userData.last_free_pack).getTime();
  return Math.max(0, Math.floor((PACKS_CONFIG.free_pack.cooldown * 1000 - elapsed) / 1000));
}

// ==================== MINI-JEU ====================

function loadEventState() { return events.fetchEverything(); }
function saveEventState(state) {
  events.clear();
  for (const [k, v] of Object.entries(state)) events.set(k, v);
}

function getNextMinigameTime(guildId) {
  const guildKey = `minigame_${guildId}`;
  const state = events.get(guildKey);
  if (!state?.next_spawn) {
    const days = Math.floor(Math.random() * (MINIGAME_CONFIG.max_interval_days - MINIGAME_CONFIG.min_interval_days + 1)) + MINIGAME_CONFIG.min_interval_days;
    const nextTime = new Date();
    nextTime.setDate(nextTime.getDate() + days);
    nextTime.setHours(Math.floor(Math.random() * (MINIGAME_CONFIG.end_hour - MINIGAME_CONFIG.start_hour)) + MINIGAME_CONFIG.start_hour, Math.floor(Math.random() * 60), 0, 0);
    events.set(guildKey, { next_spawn: nextTime.toISOString(), last_spawn: null });
    return nextTime;
  }
  return new Date(state.next_spawn);
}

function scheduleNextMinigame(guildId) {
  const guildKey = `minigame_${guildId}`;
  const days = Math.floor(Math.random() * (MINIGAME_CONFIG.max_interval_days - MINIGAME_CONFIG.min_interval_days + 1)) + MINIGAME_CONFIG.min_interval_days;
  const nextTime = new Date();
  nextTime.setDate(nextTime.getDate() + days);
  nextTime.setHours(Math.floor(Math.random() * (MINIGAME_CONFIG.end_hour - MINIGAME_CONFIG.start_hour)) + MINIGAME_CONFIG.start_hour, Math.floor(Math.random() * 60), 0, 0);
  events.set(guildKey, { next_spawn: nextTime.toISOString(), last_spawn: new Date().toISOString() });
  return nextTime;
}

function getMinigameChannel(guildId) {
  const state = events.get(`minigame_${guildId}`);
  return state?.channel_id || null;
}

function setMinigameChannel(guildId, channelId) {
  const guildKey = `minigame_${guildId}`;
  const state = events.get(guildKey) || {};
  if (channelId === null) delete state.channel_id;
  else state.channel_id = String(channelId);
  events.set(guildKey, state);
}

// ==================== GAMING ROOM (messages embed) ====================

/**
 * Retourne la liste des { channelId, messageId } pour un guild.
 */
function getGamingRoomMessages(guildId) {
  return gamingRooms.get(String(guildId)) || [];
}

/**
 * Enregistre un nouveau message Gaming Room.
 */
function addGamingRoomMessage(guildId, channelId, messageId) {
  const list = getGamingRoomMessages(guildId);
  list.push({ channelId: String(channelId), messageId: String(messageId) });
  gamingRooms.set(String(guildId), list);
}

/**
 * Retire un message Gaming Room par channelId.
 */
function removeGamingRoomMessage(guildId, channelId) {
  const list = getGamingRoomMessages(guildId);
  const filtered = list.filter(m => m.channelId !== String(channelId));
  gamingRooms.set(String(guildId), filtered);
}

// ==================== CONFIGS SERVEUR ====================

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

function loadServerConfig(guildId) { return servers.get(String(guildId)) || null; }
function saveServerConfig(guildId, config) { servers.set(String(guildId), config); }

// ==================== RAPPELS AUTOMATIQUES ====================

function initReminderGuild(guildId) {
  if (!reminders.has(String(guildId))) {
    reminders.set(String(guildId), { enabled: false, channel_id: null, interval_hours: 6.0, discussion_channel_id: null });
  }
  return reminders.get(String(guildId));
}

function getReminderConfig(guildId) { return reminders.get(String(guildId)) || null; }
function setReminderConfig(guildId, config) { reminders.set(String(guildId), config); }
function getAllReminderConfigs() {
  const all = {};
  const allEntries = reminders.entries ? [...reminders.entries()] : [...reminders];
  for (const [key, value] of allEntries) all[key] = value;
  return all;
}
function deleteReminderConfig(guildId) { reminders.delete(String(guildId)); }

// ==================== SALON D'ANNONCE PACKS ====================

function getPackAnnounceChannel(guildId) {
  const config = servers.get(String(guildId));
  return config?.pack_announce_channel || null;
}

function setPackAnnounceChannel(guildId, channelId) {
  const config = servers.get(String(guildId));
  if (!config) return;
  config.pack_announce_channel = channelId ? String(channelId) : null;
  servers.set(String(guildId), config);
}

// ==================== EXPORTS ====================

module.exports = {
  users, events, reminders, servers, gamingRooms,
  initFiles,
  getUserData, saveUserData, getGuildData, addCardToUser, removeCoins, getUserCardsGrouped,
  loadPackCards, loadAllCards, findCardById,
  canClaimFreePack, claimFreePack, getFreePackCooldown,
  loadEventState, saveEventState,
  getNextMinigameTime, scheduleNextMinigame,
  getMinigameChannel, setMinigameChannel,
  getGamingRoomMessages, addGamingRoomMessage, removeGamingRoomMessage,
  getPackAnnounceChannel, setPackAnnounceChannel,
  initServerConfig, loadServerConfig, saveServerConfig,
  initReminderGuild, getReminderConfig, setReminderConfig, getAllReminderConfigs, deleteReminderConfig,
};