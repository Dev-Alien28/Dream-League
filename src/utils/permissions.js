// src/utils/permissions.js - Gestion des permissions par serveur
const fs = require('fs');
const path = require('path');
const { SERVERS_DIR } = require('../config/settings');

function initServerConfig(guildId, guildName) {
  fs.mkdirSync(SERVERS_DIR, { recursive: true });
  const configPath = path.join(SERVERS_DIR, `${guildId}.json`);

  if (!fs.existsSync(configPath)) {
    const config = {
      guild_id: guildId,
      guild_name: guildName,
      channels: { solde: [], packs: [], collection: [] },
      roles: {
        admin: [],      // Rôles pour /addcoins, /removecoins, /setcoins, /give
        moderator: [],  // Rôles modération (si besoin futur)
        config: []      // Rôles pour accéder à /config
      },
      no_coins_channels: [],
      logs_channel: null,
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return config;
  }

  return loadServerConfig(guildId);
}

function loadServerConfig(guildId) {
  const configPath = path.join(SERVERS_DIR, `${guildId}.json`);
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return null;
}

function saveServerConfig(guildId, config) {
  fs.mkdirSync(SERVERS_DIR, { recursive: true });
  const configPath = path.join(SERVERS_DIR, `${guildId}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
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

/**
 * Vérifie si un utilisateur peut accéder à /config
 * Hiérarchie :
 * 1. Propriétaire du serveur
 * 2. Rôles "config" configurés
 * 3. Permission Discord "Administrator"
 */
function checkConfigPermission(interaction) {
  // 1. Propriétaire du serveur
  if (interaction.user.id === interaction.guild?.ownerId) return true;

  const guildId = interaction.guildId;
  const config = loadServerConfig(guildId);

  // 2. Rôles "config" configurés
  if (config) {
    const configRoles = config.roles?.config || [];
    if (configRoles.length > 0) {
      const userRoleIds = interaction.member?.roles?.cache?.map(r => String(r.id)) || [];
      const hasConfigRole = configRoles.some(roleId => userRoleIds.includes(String(roleId)));
      if (hasConfigRole) return true;
    }
  }

  // 3. Permission Discord "Administrator"
  return interaction.member?.permissions?.has('Administrator') ?? false;
}

/**
 * Vérifie les permissions pour les commandes admin (/addcoins, /removecoins, etc.)
 */
function checkRolePermission(interaction, permissionType) {
  // Propriétaire du serveur
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
  const hasRole = allowedRoles.some(roleId => userRoleIds.includes(String(roleId)));

  return hasRole || nativeCheck();
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

function isCoinsDisabledChannel(guildId, channelId) {
  return getNoCoinsChannels(guildId).includes(String(channelId));
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
  isCoinsDisabledChannel,
};