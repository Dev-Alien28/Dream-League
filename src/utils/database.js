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

const users       = new Enmap({ name: 'users',        dataDir: path.join(DATA_DIR, 'enmap'), ensureProps: true });
const events      = new Enmap({ name: 'events',        dataDir: path.join(DATA_DIR, 'enmap') });
const reminders   = new Enmap({ name: 'reminders',     dataDir: path.join(DATA_DIR, 'enmap') });
const servers     = new Enmap({ name: 'servers',        dataDir: path.join(DATA_DIR, 'enmap') });
const gamingRooms = new Enmap({ name: 'gaming_rooms',  dataDir: path.join(DATA_DIR, 'enmap') });
const statsDb     = new Enmap({ name: 'stats',          dataDir: path.join(DATA_DIR, 'enmap') });

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

// ==================== STATISTIQUES ====================

/**
 * Retourne l'objet stats complet pour une guild.
 * Structure :
 *   pack_purchases : [{ ts, userId, packKey, price, cardName, cardRarity }]
 *   failed_purchases: [{ ts, userId, packKey, price, userCoins }]
 *   encounter_wins  : [{ ts, userId, cardName, cardRarity }]
 *   give_events     : [{ ts, adminId, userId, cardName, cardRarity }]
 */
function getStatsData(guildId) {
  const key = `stats_${guildId}`;
  if (!statsDb.has(key)) {
    statsDb.set(key, {
      pack_purchases:   [],
      failed_purchases: [],
      encounter_wins:   [],
      give_events:      [],
    });
  }
  return statsDb.get(key);
}

function _saveStatsData(guildId, data) {
  statsDb.set(`stats_${guildId}`, data);
}

/** Enregistre un achat de pack réussi. */
function recordPackPurchase(guildId, userId, packKey, price, cardName, cardRarity) {
  const data = getStatsData(guildId);
  data.pack_purchases.push({
    ts:         new Date().toISOString(),
    userId:     String(userId),
    packKey:    String(packKey),
    price:      price || 0,
    cardName:   cardName || '',
    cardRarity: cardRarity || '',
  });
  _saveStatsData(guildId, data);
}

/** Enregistre une tentative d'achat échouée (coins insuffisants). */
function recordFailedPurchase(guildId, userId, packKey, requiredPrice, userCoins) {
  const data = getStatsData(guildId);
  data.failed_purchases.push({
    ts:        new Date().toISOString(),
    userId:    String(userId),
    packKey:   String(packKey),
    price:     requiredPrice || 0,
    userCoins: userCoins || 0,
  });
  _saveStatsData(guildId, data);
}

/** Enregistre une victoire d'Encounter. */
function recordEncounterWin(guildId, userId, cardName, cardRarity) {
  const data = getStatsData(guildId);
  data.encounter_wins.push({
    ts:         new Date().toISOString(),
    userId:     String(userId),
    cardName:   cardName || '',
    cardRarity: cardRarity || '',
  });
  _saveStatsData(guildId, data);
}

/** Enregistre un give de carte (admin). */
function recordGiveEvent(guildId, adminId, userId, cardName, cardRarity) {
  const data = getStatsData(guildId);
  data.give_events.push({
    ts:         new Date().toISOString(),
    adminId:    String(adminId),
    userId:     String(userId),
    cardName:   cardName || '',
    cardRarity: cardRarity || '',
  });
  _saveStatsData(guildId, data);
}

// ==================== MINI-JEU ====================

function loadEventState() { return events.fetchEverything(); }
function saveEventState(state) {
  events.clear();
  for (const [k, v] of Object.entries(state)) events.set(k, v);
}

// ── Config Encounter ─────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MIN_MS = 86_400_000;
const DEFAULT_INTERVAL_MAX_MS = 86_400_000;
const DEFAULT_START_HOUR      = 8;
const DEFAULT_END_HOUR        = 23;
const DEFAULT_TIMEOUT_S       = 60;

function getEncounterConfig(guildId) {
  const state = events.get(`minigame_${guildId}`) || {};

  let minMs = state.interval_min_ms;
  let maxMs = state.interval_max_ms;
  if (minMs === undefined && state.interval_ms !== undefined) {
    minMs = state.interval_ms;
    maxMs = state.interval_ms;
  }

  return {
    interval_min_ms: minMs  ?? DEFAULT_INTERVAL_MIN_MS,
    interval_max_ms: maxMs  ?? DEFAULT_INTERVAL_MAX_MS,
    start_hour:      state.start_hour  ?? DEFAULT_START_HOUR,
    end_hour:        state.end_hour    ?? DEFAULT_END_HOUR,
    timeout_s:       state.timeout_s   ?? DEFAULT_TIMEOUT_S,
  };
}

function setEncounterConfig(guildId, { interval_min_ms, interval_max_ms, start_hour, end_hour, timeout_s }) {
  const guildKey = `minigame_${guildId}`;
  const state = events.get(guildKey) || {};

  if (interval_min_ms !== undefined) state.interval_min_ms = interval_min_ms;
  if (interval_max_ms !== undefined) state.interval_max_ms = interval_max_ms;
  if (start_hour      !== undefined) state.start_hour      = start_hour;
  if (end_hour        !== undefined) state.end_hour        = end_hour;
  if (timeout_s       !== undefined) state.timeout_s       = timeout_s;

  delete state.interval_ms;
  events.set(guildKey, state);

  const nextTime = _computeNextSpawn(guildId, new Date());
  const updated  = events.get(guildKey);
  updated.next_spawn = nextTime.toISOString();
  events.set(guildKey, updated);

  const { interval_min_ms: min, interval_max_ms: max } = getEncounterConfig(guildId);
  console.log(`✅ Encounter config mise à jour pour ${guildId} — fourchette: ${formatIntervalMs(min)}–${formatIntervalMs(max)} — prochain spawn: ${nextTime.toISOString()}`);
}

// ─── Formatage ────────────────────────────────────────────────────────────────

function formatIntervalMs(ms) {
  if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000} jour(s)`;
  if (ms >= 3_600_000  && ms % 3_600_000  === 0) return `${ms / 3_600_000} heure(s)`;
  return `${Math.round(ms / 60_000)} minute(s)`;
}

function parseIntervalInput(raw) {
  let s = raw.trim().toLowerCase();
  s = s
    .replace(/\bjours?\b/g,   'j')
    .replace(/\bheures?\b/g,  'h')
    .replace(/\bminutes?\b/g, 'm')
    .replace(/\bmins?\b/g,    'm')
    .replace(/\bhrs?\b/g,     'h')
    .replace(/\s+/g, '');

  const match = s.match(/^(\d+)(j|h|m)$/);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  if (val <= 0) return null;
  if (match[2] === 'j') return val * 86_400_000;
  if (match[2] === 'h') return val * 3_600_000;
  if (match[2] === 'm') return val * 60_000;
  return null;
}

// ─── Calcul du prochain spawn ─────────────────────────────────────────────────

function _computeNextSpawn(guildId, fromDate) {
  const { interval_min_ms, interval_max_ms, start_hour, end_hour } = getEncounterConfig(guildId);
  const from = fromDate || new Date();
  const now  = new Date();

  const interval_ms = interval_min_ms === interval_max_ms
    ? interval_min_ms
    : interval_min_ms + Math.floor(Math.random() * (interval_max_ms - interval_min_ms + 1));

  if (interval_ms < 3_600_000) {
    const candidate = new Date(from.getTime() + interval_ms);
    if (candidate <= now) return new Date(now.getTime() + interval_ms);
    return candidate;
  }

  const base = new Date(from.getTime() + interval_ms);

  const randomHour = start_hour + Math.floor(Math.random() * (end_hour - start_hour));
  const randomMin  = Math.floor(Math.random() * 60);

  const candidate = new Date(base);
  candidate.setHours(randomHour, randomMin, 0, 0);

  const futureThreshold = new Date(now.getTime() + 1000);
  while (candidate <= futureThreshold) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

function getNextMinigameTime(guildId) {
  const guildKey = `minigame_${guildId}`;
  const state = events.get(guildKey);
  if (!state?.next_spawn) {
    const nextTime = _computeNextSpawn(guildId, new Date());
    events.set(guildKey, { ...(state || {}), next_spawn: nextTime.toISOString(), last_spawn: null });
    return nextTime;
  }
  return new Date(state.next_spawn);
}

function scheduleNextMinigame(guildId) {
  const guildKey = `minigame_${guildId}`;
  const now      = new Date();
  const nextTime = _computeNextSpawn(guildId, now);
  const existing = events.get(guildKey) || {};
  events.set(guildKey, { ...existing, next_spawn: nextTime.toISOString(), last_spawn: now.toISOString() });
  console.log(`📅 Prochain Encounter pour ${guildId} : ${nextTime.toISOString()}`);
  return nextTime;
}

function getMinigameChannel(guildId) {
  const state = events.get(`minigame_${guildId}`);
  return state?.channel_id || null;
}

function setMinigameChannel(guildId, channelId) {
  const guildKey = `minigame_${guildId}`;
  const state    = events.get(guildKey) || {};
  if (channelId === null) delete state.channel_id;
  else state.channel_id = String(channelId);
  events.set(guildKey, state);
}

// ==================== GAMING ROOM (messages embed) ====================

function getGamingRoomMessages(guildId) {
  return gamingRooms.get(String(guildId)) || [];
}

function addGamingRoomMessage(guildId, channelId, messageId) {
  const list = getGamingRoomMessages(guildId);
  list.push({ channelId: String(channelId), messageId: String(messageId) });
  gamingRooms.set(String(guildId), list);
}

function removeGamingRoomMessage(guildId, channelId) {
  const list     = getGamingRoomMessages(guildId);
  const filtered = list.filter(m => m.channelId !== String(channelId));
  gamingRooms.set(String(guildId), filtered);
}

// ==================== CONFIGS SERVEUR ====================

function initServerConfig(guildId, guildName) {
  if (!servers.has(String(guildId))) {
    servers.set(String(guildId), {
      guild_id:   guildId,
      guild_name: guildName,
      channels:   { solde: [], packs: [], collection: [] },
      roles:      { admin: [], moderator: [], config: [] },
      no_coins_channels:   [],
      no_coins_categories: [],
      logs_channel: null,
    });
    console.log(`✅ Config serveur initialisée pour ${guildName} (${guildId})`);
  }
  return servers.get(String(guildId));
}

function loadServerConfig(guildId) { return servers.get(String(guildId)) || null; }
function saveServerConfig(guildId, config) { servers.set(String(guildId), config); }

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

// ==================== RAPPELS AUTOMATIQUES ====================

function initReminderGuild(guildId) {
  if (!reminders.has(String(guildId))) {
    reminders.set(String(guildId), {
      enabled: false, channel_id: null, interval_hours: 6.0, discussion_channel_id: null,
    });
  }
  return reminders.get(String(guildId));
}

function getReminderConfig(guildId)         { return reminders.get(String(guildId)) || null; }
function setReminderConfig(guildId, config) { reminders.set(String(guildId), config); }

function getAllReminderConfigs() {
  const all        = {};
  const allEntries = reminders.entries ? [...reminders.entries()] : [...reminders];
  for (const [key, value] of allEntries) all[key] = value;
  return all;
}

function deleteReminderConfig(guildId) { reminders.delete(String(guildId)); }

// ==================== EXPORTS ====================

module.exports = {
  users, events, reminders, servers, gamingRooms, statsDb,
  initFiles,
  getUserData, saveUserData, getGuildData, addCardToUser, removeCoins, getUserCardsGrouped,
  loadPackCards, loadAllCards, findCardById,
  canClaimFreePack, claimFreePack, getFreePackCooldown,
  loadEventState, saveEventState,
  getEncounterConfig, setEncounterConfig,
  formatIntervalMs, parseIntervalInput,
  getNextMinigameTime, scheduleNextMinigame,
  getMinigameChannel, setMinigameChannel,
  getGamingRoomMessages, addGamingRoomMessage, removeGamingRoomMessage,
  getPackAnnounceChannel, setPackAnnounceChannel,
  initServerConfig, loadServerConfig, saveServerConfig,
  initReminderGuild, getReminderConfig, setReminderConfig, getAllReminderConfigs, deleteReminderConfig,
  // Stats
  getStatsData, recordPackPurchase, recordFailedPurchase, recordEncounterWin, recordGiveEvent,
};