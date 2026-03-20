// src/utils/permissions.js - Gestion des permissions par serveur
const { SERVERS_DIR } = require('../config/settings');

// ==================== NOTE ====================
// Les configs serveur sont stockées via Enmap dans database.js
// On importe loadServerConfig / saveServerConfig depuis database.js
// pour éviter la double lecture fichier/Enmap.
const { loadServerConfig, saveServerConfig } = require('./database');

// ==================== INIT ====================

function initServerConfig(guildId, guildName) {
  const existing = loadServerConfig(guildId);
  if (!existing) {
    const config = {
      guild_id: guildId,
      guild_name: guildName,
      channels: { solde: [], packs: [], collection: [] },
      roles: { admin: [], moderator: [], config: [] },
      no_coins_channels: [],
      no_coins_categories: [],
      logs_channel: null,
    };
    saveServerConfig(guildId, config);
    return config;
  }
  // Migration : ajouter les champs manquants si ancienne config
  let changed = false;
  if (!existing.roles?.config) { existing.roles = { ...existing.roles, config: [] }; changed = true; }
  if (!existing.no_coins_categories) { existing.no_coins_categories = []; changed = true; }
  if (changed) saveServerConfig(guildId, existing);
  return existing;
}

// ==================== PERMISSIONS SALONS ====================

function checkChannelPermission(interaction, commandName) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  const config = loadServerConfig(guildId);
  if (!config) return true;

  const allowedChannels = config.channels?.[commandName] || [];
  if (!allowedChannels.length) return true;

  return allowedChannels.map(String).includes(String(channelId));
}

function getAllowedChannel(guildId, commandName, client) {
  const config = loadServerConfig(String(guildId));
  if (!config) return null;

  const channelIds = config.channels?.[commandName] || [];
  if (!channelIds.length) return null;

  const guild = client?.guilds?.cache?.get(String(guildId));
  if (!guild) return null;

  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(String(channelId));
    if (channel) return channel;
  }
  return null;
}

// ==================== PERMISSIONS RÔLES ====================

function checkConfigPermission(interaction) {
  if (interaction.user.id === interaction.guild?.ownerId) return true;

  const guildId = interaction.guildId;
  const config = loadServerConfig(guildId);

  if (config) {
    const configRoles = config.roles?.config || [];
    if (configRoles.length > 0) {
      const userRoleIds = interaction.member?.roles?.cache?.map(r => String(r.id)) || [];
      if (configRoles.some(roleId => userRoleIds.includes(String(roleId)))) return true;
    }
  }

  return interaction.member?.permissions?.has('Administrator') ?? false;
}

function checkRolePermission(interaction, permissionType) {
  if (interaction.user.id === interaction.guild?.ownerId) return true;

  const guildId = interaction.guildId;
  const config = loadServerConfig(guildId);

  const nativeCheck = () => {
    const perms = interaction.member?.permissions;
    if (permissionType === 'admin') return perms?.has('Administrator') ?? false;
    if (permissionType === 'moderator') return perms?.has('ModerateMembers') || perms?.has('Administrator') || false;
    return false;
  };

  if (!config) return nativeCheck();

  const allowedRoles = config.roles?.[permissionType] || [];
  if (!allowedRoles.length) return nativeCheck();

  const userRoleIds = interaction.member?.roles?.cache?.map(r => String(r.id)) || [];
  return allowedRoles.some(roleId => userRoleIds.includes(String(roleId))) || nativeCheck();
}

// ==================== GESTION SALONS ====================

function addChannelPermission(guildId, commandName, channelId) {
  const config = loadServerConfig(guildId);
  if (!config) return false;
  if (!config.channels[commandName]) config.channels[commandName] = [];
  if (!config.channels[commandName].includes(String(channelId))) {
    config.channels[commandName].push(String(channelId));
    saveServerConfig(guildId, config);
    return true;
  }
  return false;
}

function removeChannelPermission(guildId, commandName, channelId) {
  const config = loadServerConfig(guildId);
  if (!config) return false;
  const idx = (config.channels[commandName] || []).indexOf(String(channelId));
  if (idx !== -1) {
    config.channels[commandName].splice(idx, 1);
    saveServerConfig(guildId, config);
    return true;
  }
  return false;
}

function getAllowedChannels(guildId, commandName) {
  const config = loadServerConfig(guildId);
  return config?.channels?.[commandName] || [];
}

// ==================== GESTION RÔLES ====================

function addRolePermission(guildId, permissionType, roleId) {
  const config = loadServerConfig(guildId);
  if (!config) return false;
  if (!config.roles[permissionType]) config.roles[permissionType] = [];
  if (!config.roles[permissionType].includes(String(roleId))) {
    config.roles[permissionType].push(String(roleId));
    saveServerConfig(guildId, config);
    return true;
  }
  return false;
}

function removeRolePermission(guildId, permissionType, roleId) {
  const config = loadServerConfig(guildId);
  if (!config) return false;
  const idx = (config.roles[permissionType] || []).indexOf(String(roleId));
  if (idx !== -1) {
    config.roles[permissionType].splice(idx, 1);
    saveServerConfig(guildId, config);
    return true;
  }
  return false;
}

function getAllowedRoles(guildId, permissionType) {
  const config = loadServerConfig(guildId);
  return config?.roles?.[permissionType] || [];
}

// ==================== SALONS SANS COINS ====================

function getNoCoinsChannels(guildId) {
  const config = loadServerConfig(guildId);
  return config?.no_coins_channels || [];
}

function addNoCoinsChannel(guildId, channelId) {
  const config = loadServerConfig(guildId);
  if (!config) return false;
  if (!config.no_coins_channels) config.no_coins_channels = [];
  if (!config.no_coins_channels.includes(String(channelId))) {
    config.no_coins_channels.push(String(channelId));
    saveServerConfig(guildId, config);
    return true;
  }
  return false;
}

function removeNoCoinsChannel(guildId, channelId) {
  const config = loadServerConfig(guildId);
  if (!config) return false;
  const idx = (config.no_coins_channels || []).indexOf(String(channelId));
  if (idx !== -1) {
    config.no_coins_channels.splice(idx, 1);
    saveServerConfig(guildId, config);
    return true;
  }
  return false;
}

// ==================== CATÉGORIES SANS COINS ====================

function getNoCoinsCategories(guildId) {
  const config = loadServerConfig(guildId);
  return config?.no_coins_categories || [];
}

function addNoCoinCategory(guildId, categoryId) {
  const config = loadServerConfig(guildId);
  if (!config) return false;
  if (!config.no_coins_categories) config.no_coins_categories = [];
  if (!config.no_coins_categories.includes(String(categoryId))) {
    config.no_coins_categories.push(String(categoryId));
    saveServerConfig(guildId, config);
    return true;
  }
  return false;
}

function removeNoCoinCategory(guildId, categoryId) {
  const config = loadServerConfig(guildId);
  if (!config) return false;
  const idx = (config.no_coins_categories || []).indexOf(String(categoryId));
  if (idx !== -1) {
    config.no_coins_categories.splice(idx, 1);
    saveServerConfig(guildId, config);
    return true;
  }
  return false;
}

/**
 * Vérifie si un salon est désactivé pour les coins.
 * Tient compte des salons individuels ET des catégories entières.
 * @param {string} guildId
 * @param {string} channelId
 * @param {string|null} parentId - ID de la catégorie parente du salon (channel.parentId)
 */
function isCoinsDisabledChannel(guildId, channelId, parentId = null) {
  const config = loadServerConfig(guildId);
  if (!config) return false;

  // Vérifier salon individuel
  const noCoinsChannels = config.no_coins_channels || [];
  if (noCoinsChannels.includes(String(channelId))) return true;

  // Vérifier catégorie parente
  if (parentId) {
    const noCoinsCategories = config.no_coins_categories || [];
    if (noCoinsCategories.includes(String(parentId))) return true;
  }

  return false;
}

module.exports = {
  initServerConfig,
  loadServerConfig,
  saveServerConfig,
  checkChannelPermission,
  getAllowedChannel,
  checkConfigPermission,
  checkRolePermission,
  addChannelPermission,
  removeChannelPermission,
  getAllowedChannels,
  addRolePermission,
  removeRolePermission,
  getAllowedRoles,
  getNoCoinsChannels,
  addNoCoinsChannel,
  removeNoCoinsChannel,
  getNoCoinsCategories,
  addNoCoinCategory,
  removeNoCoinCategory,
  isCoinsDisabledChannel,
};