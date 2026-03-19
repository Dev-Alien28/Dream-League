// src/commands/config.js - Panneau de configuration interactif
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const {
  loadServerConfig, saveServerConfig,
  addChannelPermission, removeChannelPermission, getAllowedChannels,
  addRolePermission, removeRolePermission, getAllowedRoles,
  getNoCoinsChannels, addNoCoinsChannel, removeNoCoinsChannel,
  checkConfigPermission,
} = require('../utils/permissions');
const { getMinigameChannel, getNextMinigameTime } = require('../utils/database');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON } = require('../config/settings');

function formatInterval(hours) {
  if (hours < 1) { const m = Math.round(hours * 60); return `${m} minute${m > 1 ? 's' : ''}`; }
  if (hours === 1) return '1 heure';
  return `${Math.floor(hours)} heures`;
}

// ==================== HELPERS PAGINATION ====================

/**
 * Découpe un tableau en chunks de taille max et retourne
 * un tableau de StringSelectMenuBuilder (un par chunk).
 * @param {Array}  items       - options Discord { label, value, ... }
 * @param {string} baseId      - customId de base ; chaque menu aura baseId_0, baseId_1, …
 * @param {string} placeholder - texte du placeholder
 * @param {number} chunkSize   - max options par menu (≤ 25)
 */
function buildSelectMenus(items, baseId, placeholder, chunkSize = 25) {
  const menus = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const pageNum = Math.floor(i / chunkSize) + 1;
    const totalPages = Math.ceil(items.length / chunkSize);
    const pageSuffix = totalPages > 1 ? ` (${pageNum}/${totalPages})` : '';
    menus.push(
      new StringSelectMenuBuilder()
        .setCustomId(`${baseId}_${Math.floor(i / chunkSize)}`)
        .setPlaceholder(`${placeholder}${pageSuffix}`)
        .addOptions(chunk),
    );
  }
  return menus;
}

/** Transforme une liste de salons texte du serveur en options Discord (max chunkSize par menu). */
function channelOptions(guild, valuePrefix) {
  return guild.channels.cache
    .filter(c => c.isTextBased() && !c.isThread())
    .map(c => ({
      label: `#${c.name}`.slice(0, 100),
      value: `${valuePrefix}${c.id}`,
      description: (c.parent?.name || 'Sans catégorie').slice(0, 100),
    }));
}

/** Transforme une liste de rôles du serveur en options Discord. */
function roleOptions(guild, valuePrefix) {
  return guild.roles.cache
    .filter(r => r.name !== '@everyone')
    .map(r => ({
      label: r.name.slice(0, 100),
      value: `${valuePrefix}${r.id}`,
    }));
}

/**
 * Construit les ActionRows à partir de plusieurs menus + un bouton retour.
 * Discord limite à 5 ActionRows par message.
 */
function buildRows(selectMenus, backId, extraButtons = []) {
  const rows = selectMenus.slice(0, 4).map(m => new ActionRowBuilder().addComponents(m));
  const backBtn = new ButtonBuilder().setCustomId(backId).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary);
  rows.push(new ActionRowBuilder().addComponents(backBtn, ...extraButtons));
  return rows;
}

// ==================== EMBEDS ====================

function createMainEmbed(interaction) {
  return new EmbedBuilder()
    .setTitle('⚙️ Configuration du Bot PSG')
    .setDescription(`Bienvenue dans le panneau de configuration pour **${interaction.guild.name}**\n\nChoisis une catégorie :`)
    .setColor(PSG_BLUE)
    .addFields(
      { name: '📺 Salons de Commandes', value: 'Configure où `/solde`, `/packs`, `/collection` et le mini-jeu peuvent être utilisés', inline: false },
      { name: '👑 Rôles Administrateurs', value: 'Définis quels rôles peuvent utiliser `/addcoins`, `/removecoins`, `/setcoins`', inline: false },
      { name: '🔧 Rôles de Configuration', value: 'Définis quels rôles peuvent accéder à `/config`', inline: false },
      { name: '📋 Salon de Logs', value: 'Définis où le bot enverra ses logs (achats packs, commandes admin, give, mini-jeu)', inline: false },
      { name: '📢 Rappels Automatiques', value: 'Configure les rappels personnalisables', inline: false },
      { name: '🚫 Salons Sans Coins', value: 'Définis les salons où les membres ne gagnent pas de coins', inline: false },
    )
    .setFooter({ text: 'Paris Saint-Germain • Configuration', iconURL: PSG_FOOTER_ICON });
}

function createMainComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config_channels').setLabel('📺 Salons de Commandes').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_roles').setLabel('👑 Rôles Administrateurs').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_roles_config').setLabel('🔧 Rôles Config').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config_logs').setLabel('📋 Salon de Logs').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_reminders').setLabel('📢 Rappels Automatiques').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_no_coins').setLabel('🚫 Salons Sans Coins').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config_view_full').setLabel('📊 Voir Configuration').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('config_close').setLabel('❌ Fermer').setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ==================== COMMANDE PRINCIPALE ====================

async function configCommand(interaction) {
  if (!checkConfigPermission(interaction)) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Accès refusé')
        .setDescription('Tu n\'as pas la permission d\'accéder à la configuration du bot.\n\n**Permissions requises :**\n• Propriétaire du serveur\n• Rôle avec permission "Administrateur"\n• Rôle configuré dans "Rôles de Configuration"')
        .setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }
  return interaction.reply({ embeds: [createMainEmbed(interaction)], components: createMainComponents(), flags: MessageFlags.Ephemeral });
}

// ==================== GESTIONNAIRE D'INTERACTIONS CONFIG ====================

async function handleConfigInteraction(interaction) {
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  const customId = interaction.customId;

  // Retour au menu principal
  if (customId === 'config_back_main') {
    return interaction.update({ embeds: [createMainEmbed(interaction)], components: createMainComponents() });
  }

  // Fermer
  if (customId === 'config_close') {
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('✅ Configuration terminée').setDescription('Tu peux utiliser `/config` à tout moment.').setColor(PSG_BLUE)],
      components: [],
    });
  }

  // ==================== SALONS DE COMMANDES ====================
  if (customId === 'config_channels') {
    const embed = new EmbedBuilder().setTitle('📺 Configuration des Salons').setDescription('Configure les salons autorisés pour chaque commande.').setColor(PSG_BLUE);
    for (const cmd of ['solde', 'packs', 'collection', 'minigame']) {
      const channels = getAllowedChannels(guildId, cmd);
      const chList = channels.map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
      embed.addFields({ name: `/${cmd}`, value: chList.length ? chList.join('\n') : 'Partout ✅', inline: true });
    }
    const options = [
      { label: 'Solde', value: 'solde', emoji: '💰' },
      { label: 'Packs', value: 'packs', emoji: '📦' },
      { label: 'Collection', value: 'collection', emoji: '🎴' },
      { label: 'Mini-jeu', value: 'minigame', emoji: '⚡' },
    ];
    const select = new StringSelectMenuBuilder().setCustomId('config_channels_select_cmd').setPlaceholder('Choisir une commande').addOptions(options);
    return interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(select),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_back_main').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)),
      ],
    });
  }

  if (customId === 'config_channels_select_cmd') {
    const cmd = interaction.values[0];
    const channels = getAllowedChannels(guildId, cmd);
    const chList = channels.map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
    const embed = new EmbedBuilder()
      .setTitle(`Configuration de /${cmd}`)
      .setDescription('Ajoute ou retire des salons autorisés.')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Salons actuels', value: chList.length ? chList.join('\n') : 'Partout ✅', inline: false });

    // Menus d'ajout paginés
    const addOpts = channelOptions(guild, `${cmd}__add__`);
    const addMenus = buildSelectMenus(addOpts, 'config_channel_add', '➕ Ajouter un salon');

    // Menus de suppression paginés
    const removeOpts = channels.map(id => {
      const ch = guild.channels.cache.get(id);
      return ch ? { label: `#${ch.name}`.slice(0, 100), value: `${cmd}__remove__${id}` } : null;
    }).filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_channel_remove', '➖ Retirer un salon');

    const allMenus = [...addMenus, ...removeMenus];
    const rows = buildRows(allMenus, 'config_channels');
    return interaction.update({ embeds: [embed], components: rows });
  }

  // Gestion dynamique des menus add/remove salons (customId = config_channel_add_N ou config_channel_remove_N)
  if (customId.startsWith('config_channel_add_')) {
    const value = interaction.values[0];
    const [cmd, , channelId] = value.split('__');
    addChannelPermission(guildId, cmd, channelId);
    const ch = guild.channels.cache.get(channelId);
    return interaction.reply({ content: `✅ ${ch} ajouté pour \`/${cmd}\``, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('config_channel_remove_')) {
    const value = interaction.values[0];
    const [cmd, , channelId] = value.split('__');
    removeChannelPermission(guildId, cmd, channelId);
    return interaction.reply({ content: `✅ Salon retiré pour \`/${cmd}\``, flags: MessageFlags.Ephemeral });
  }

  // ==================== RÔLES ADMIN ====================
  if (customId === 'config_roles') {
    const adminRoles = getAllowedRoles(guildId, 'admin');
    const roleList = adminRoles.map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    const embed = new EmbedBuilder()
      .setTitle('👑 Configuration des Rôles Administrateurs')
      .setDescription('Configure les rôles pouvant utiliser `/addcoins`, `/removecoins`, `/setcoins`, `/give`.')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Rôles Admin actuels', value: roleList.length ? roleList.join('\n') : 'Permissions Discord natives 🔧', inline: false });

    const addOpts = roleOptions(guild, 'admin__add__');
    const addMenus = buildSelectMenus(addOpts, 'config_role_add', '➕ Ajouter un rôle admin');

    const removeOpts = adminRoles.map(id => {
      const r = guild.roles.cache.get(id);
      return r ? { label: r.name.slice(0, 100), value: `admin__remove__${id}` } : null;
    }).filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_role_remove', '➖ Retirer un rôle admin');

    const rows = buildRows([...addMenus, ...removeMenus], 'config_back_main');
    return interaction.update({ embeds: [embed], components: rows });
  }

  if (customId.startsWith('config_role_add_')) {
    const value = interaction.values[0];
    const [, , roleId] = value.split('__');
    const role = guild.roles.cache.get(roleId);
    addRolePermission(guildId, 'admin', roleId);
    return interaction.reply({ content: `✅ ${role} peut maintenant utiliser les commandes admin`, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('config_role_remove_')) {
    const value = interaction.values[0];
    const [, , roleId] = value.split('__');
    const role = guild.roles.cache.get(roleId);
    removeRolePermission(guildId, 'admin', roleId);
    return interaction.reply({ content: `✅ ${role ? role.name : 'Rôle'} retiré des rôles admin`, flags: MessageFlags.Ephemeral });
  }

  // ==================== RÔLES DE CONFIGURATION ====================
  if (customId === 'config_roles_config') {
    const configRoles = getAllowedRoles(guildId, 'config');
    const roleList = configRoles.map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    const embed = new EmbedBuilder()
      .setTitle('🔧 Configuration des Rôles de Configuration')
      .setDescription('Configure les rôles pouvant accéder à `/config`.\n\n**Par défaut :**\n• Propriétaire du serveur\n• Rôles avec permission "Administrateur"\n\n**Si configuré :**\n• Les rôles listés ci-dessous (sans besoin de la permission Admin)')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Rôles Config actuels', value: roleList.length ? roleList.join('\n') : 'Permissions Discord natives 🔧', inline: false });

    const addOpts = roleOptions(guild, 'config__add__');
    const addMenus = buildSelectMenus(addOpts, 'config_rolecfg_add', '➕ Ajouter un rôle config');

    const removeOpts = configRoles.map(id => {
      const r = guild.roles.cache.get(id);
      return r ? { label: r.name.slice(0, 100), value: `config__remove__${id}` } : null;
    }).filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_rolecfg_remove', '➖ Retirer un rôle config');

    const rows = buildRows([...addMenus, ...removeMenus], 'config_back_main');
    return interaction.update({ embeds: [embed], components: rows });
  }

  if (customId.startsWith('config_rolecfg_add_')) {
    const value = interaction.values[0];
    const [, , roleId] = value.split('__');
    const role = guild.roles.cache.get(roleId);
    addRolePermission(guildId, 'config', roleId);
    return interaction.reply({ content: `✅ ${role} peut maintenant utiliser \`/config\``, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('config_rolecfg_remove_')) {
    const value = interaction.values[0];
    const [, , roleId] = value.split('__');
    const role = guild.roles.cache.get(roleId);
    removeRolePermission(guildId, 'config', roleId);
    return interaction.reply({ content: `✅ ${role ? role.name : 'Rôle'} retiré des rôles config`, flags: MessageFlags.Ephemeral });
  }

  // ==================== SALON DE LOGS ====================
  if (customId === 'config_logs') {
    const config = loadServerConfig(guildId);
    const logsChannelId = config?.logs_channel;
    const logsChannel = logsChannelId ? guild.channels.cache.get(logsChannelId) : null;

    const embed = new EmbedBuilder()
      .setTitle('📋 Configuration du Salon de Logs')
      .setDescription('Configure le salon qui recevra les logs du bot.\n\n**Logs enregistrés :**\n• 📦 Achats de packs\n• 👑 Commandes admin (addcoins, removecoins, setcoins)\n• 🎁 Cartes données (give)\n• ⚡ Victoires mini-jeu')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Salon actuel', value: logsChannel ? logsChannel.toString() : 'Non configuré ❌', inline: false });

    const opts = channelOptions(guild, '');
    const setMenus = buildSelectMenus(opts, 'config_logs_set', 'Définir le salon de logs');

    const disableBtn = new ButtonBuilder().setCustomId('config_logs_disable').setLabel('🗑️ Désactiver').setStyle(ButtonStyle.Danger);
    const rows = buildRows(setMenus, 'config_back_main', [disableBtn]);
    return interaction.update({ embeds: [embed], components: rows });
  }

  if (customId.startsWith('config_logs_set_')) {
    const channelId = interaction.values[0];
    const config = loadServerConfig(guildId) || {};
    config.logs_channel = channelId;
    saveServerConfig(guildId, config);
    const ch = guild.channels.cache.get(channelId);
    return interaction.reply({ content: `✅ ${ch} recevra maintenant les logs du bot`, flags: MessageFlags.Ephemeral });
  }

  if (customId === 'config_logs_disable') {
    const config = loadServerConfig(guildId) || {};
    config.logs_channel = null;
    saveServerConfig(guildId, config);
    return interaction.reply({ content: '✅ Logs désactivés', flags: MessageFlags.Ephemeral });
  }

  // ==================== RAPPELS AUTOMATIQUES ====================
  if (customId === 'config_reminders') {
    const reminder = interaction.client.autoReminder;
    const channelId = reminder?.getChannelId(guildId);
    const channel = channelId ? guild.channels.cache.get(channelId) : null;
    const isEnabled = reminder?.isEnabled(guildId);
    const interval = reminder?.getInterval(guildId) || 6;
    const discChannelId = reminder?.getDiscussionChannelId(guildId);
    const discChannel = discChannelId ? guild.channels.cache.get(discChannelId) : null;

    const embed = new EmbedBuilder()
      .setTitle('📢 Configuration des Rappels Automatiques')
      .setDescription('Configure les rappels automatiques.')
      .setColor(PSG_BLUE)
      .addFields(
        { name: '📢 Salon de rappels', value: channel ? channel.toString() : 'Non configuré ❌', inline: true },
        { name: '📊 Statut', value: isEnabled ? '✅ **Activés**' : '❌ **Désactivés**', inline: true },
        { name: '⏰ Fréquence', value: `Toutes les **${formatInterval(interval)}**`, inline: true },
        { name: '💬 Salon de discussion', value: discChannel ? discChannel.toString() : 'Message par défaut', inline: false },
      );

    const chOpts = channelOptions(guild, '');
    const reminderMenus = buildSelectMenus(chOpts, 'config_reminder_set_channel', 'Définir le salon de rappels');
    const discussionMenus = buildSelectMenus(chOpts, 'config_reminder_set_discussion', '💬 Salon de discussion');

    const intervalOptions = [
      { label: '1 minute', value: '0.0167', emoji: '⚡' }, { label: '5 minutes', value: '0.0833', emoji: '⚡' },
      { label: '15 minutes', value: '0.25', emoji: '⏱️' }, { label: '30 minutes', value: '0.5', emoji: '⏱️' },
      { label: '1 heure', value: '1', emoji: '⏰' }, { label: '2 heures', value: '2', emoji: '⏰' },
      { label: '3 heures', value: '3', emoji: '⏰' }, { label: '6 heures (recommandé)', value: '6', emoji: '✅' },
      { label: '12 heures', value: '12', emoji: '⏰' }, { label: '24 heures', value: '24', emoji: '⏰' },
    ];
    const intervalMenu = new StringSelectMenuBuilder()
      .setCustomId('config_reminder_set_interval')
      .setPlaceholder('⏰ Modifier le délai')
      .addOptions(intervalOptions);

    // On limite à 5 rows max : salon rappel (1) + interval (1) + discussion (1) + boutons (1) = 4
    const rows = [
      ...reminderMenus.slice(0, 1).map(m => new ActionRowBuilder().addComponents(m)),
      new ActionRowBuilder().addComponents(intervalMenu),
      ...discussionMenus.slice(0, 1).map(m => new ActionRowBuilder().addComponents(m)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('config_reminder_enable').setLabel('✅ Activer').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('config_reminder_disable').setLabel('❌ Désactiver').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('config_reminder_delete').setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('config_back_main').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
      ),
    ];
    return interaction.update({ embeds: [embed], components: rows });
  }

  if (customId.startsWith('config_reminder_set_channel_')) {
    interaction.client.autoReminder?.setReminderChannel(guildId, interaction.values[0]);
    return interaction.reply({ content: '✅ Salon de rappels configuré !', flags: MessageFlags.Ephemeral });
  }

  if (customId === 'config_reminder_set_interval') {
    const hours = parseFloat(interaction.values[0]);
    interaction.client.autoReminder?.setInterval(guildId, hours);
    return interaction.reply({ content: `✅ Intervalle défini à **${formatInterval(hours)}**`, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('config_reminder_set_discussion_')) {
    interaction.client.autoReminder?.setDiscussionChannel(guildId, interaction.values[0]);
    const ch = guild.channels.cache.get(interaction.values[0]);
    return interaction.reply({ content: `✅ Salon de discussion défini : ${ch}`, flags: MessageFlags.Ephemeral });
  }

  if (customId === 'config_reminder_enable') {
    const ok = interaction.client.autoReminder?.enableReminders(guildId);
    return interaction.reply({ content: ok ? '✅ Rappels activés !' : '❌ Configure d\'abord un salon de rappels.', flags: MessageFlags.Ephemeral });
  }

  if (customId === 'config_reminder_disable') {
    interaction.client.autoReminder?.disableReminders(guildId);
    return interaction.reply({ content: '✅ Rappels désactivés.', flags: MessageFlags.Ephemeral });
  }

  if (customId === 'config_reminder_delete') {
    interaction.client.autoReminder?.removeReminderChannel(guildId);
    return interaction.reply({ content: '✅ Configuration des rappels supprimée.', flags: MessageFlags.Ephemeral });
  }

  // ==================== SALONS SANS COINS ====================
  if (customId === 'config_no_coins') {
    const noCoins = getNoCoinsChannels(guildId);
    const chList = noCoins.map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
    const embed = new EmbedBuilder()
      .setTitle('🚫 Configuration des Salons Sans Coins')
      .setDescription('Configure les salons où les membres ne gagnent **pas** de coins.')
      .setColor(PSG_BLUE)
      .addFields(
        { name: 'Salons sans coins', value: chList.length ? chList.join('\n') : 'Aucun ✅ (coins gagnés partout)', inline: false },
        { name: 'ℹ️ Fonctionnement', value: '• Salons **NON listés** : coins gagnés\n• Salons **listés** : aucun coin', inline: false },
      );

    const addOpts = channelOptions(guild, 'nocoins__add__');
    const addMenus = buildSelectMenus(addOpts, 'config_nocoins_add', '➕ Ajouter salon sans coins');

    const removeOpts = noCoins.map(id => {
      const ch = guild.channels.cache.get(id);
      return ch ? { label: `#${ch.name}`.slice(0, 100), value: `nocoins__remove__${id}` } : null;
    }).filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_nocoins_remove', '➖ Retirer salon sans coins');

    const rows = buildRows([...addMenus, ...removeMenus], 'config_back_main');
    return interaction.update({ embeds: [embed], components: rows });
  }

  if (customId.startsWith('config_nocoins_add_')) {
    const value = interaction.values[0];
    const [, , channelId] = value.split('__');
    const ch = guild.channels.cache.get(channelId);
    addNoCoinsChannel(guildId, channelId);
    return interaction.reply({ content: `✅ ${ch} ajouté à la liste sans coins`, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('config_nocoins_remove_')) {
    const value = interaction.values[0];
    const [, , channelId] = value.split('__');
    const ch = guild.channels.cache.get(channelId);
    removeNoCoinsChannel(guildId, channelId);
    return interaction.reply({ content: `✅ ${ch ? ch.toString() : 'Salon'} retiré de la liste sans coins`, flags: MessageFlags.Ephemeral });
  }

  // ==================== VUE CONFIGURATION COMPLÈTE ====================
  if (customId === 'config_view_full') {
    const config = loadServerConfig(guildId);
    const embed = new EmbedBuilder()
      .setTitle(`📊 Configuration Complète - ${guild.name}`)
      .setDescription('Résumé de toute la configuration actuelle')
      .setColor(PSG_BLUE)
      .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

    for (const cmd of ['solde', 'packs', 'collection']) {
      const chs = getAllowedChannels(guildId, cmd).map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
      embed.addFields({ name: `📺 /${cmd}`, value: chs.length ? chs.join('\n') : 'Partout ✅', inline: true });
    }

    const mgChannelId = getMinigameChannel(guildId);
    const mgChannel = mgChannelId ? guild.channels.cache.get(mgChannelId) : null;
    if (mgChannel) {
      try {
        const nextTime = getNextMinigameTime(guildId);
        embed.addFields({ name: '⚡ Mini-jeu', value: `${mgChannel}\n⏰ <t:${Math.floor(nextTime.getTime() / 1000)}:R>`, inline: true });
      } catch {
        embed.addFields({ name: '⚡ Mini-jeu', value: mgChannel.toString(), inline: true });
      }
    } else {
      embed.addFields({ name: '⚡ Mini-jeu', value: 'Non configuré ❌', inline: true });
    }

    const adminRoles = getAllowedRoles(guildId, 'admin').map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({ name: '👑 Rôles Admin', value: adminRoles.length ? adminRoles.join('\n') : 'Permissions Discord natives 🔧', inline: false });

    const configRoles = getAllowedRoles(guildId, 'config').map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({ name: '🔧 Rôles Config', value: configRoles.length ? configRoles.join('\n') : 'Permissions Discord natives 🔧', inline: false });

    const logsChannelId = config?.logs_channel;
    const logsChannel = logsChannelId ? guild.channels.cache.get(logsChannelId) : null;
    embed.addFields({ name: '📋 Salon de Logs', value: logsChannel ? logsChannel.toString() : 'Non configuré ❌', inline: false });

    const reminder = interaction.client.autoReminder;
    if (reminder) {
      const remChId = reminder.getChannelId(guildId);
      const remCh = remChId ? guild.channels.cache.get(remChId) : null;
      const isEnabled = reminder.isEnabled(guildId);
      const interval = reminder.getInterval(guildId);
      const discChId = reminder.getDiscussionChannelId(guildId);
      const discCh = discChId ? guild.channels.cache.get(discChId) : null;
      let remVal = remCh ? `${remCh}\n${isEnabled ? '✅ Activé' : '❌ Désactivé'} • ${formatInterval(interval)}` : 'Non configuré ❌';
      if (discCh) remVal += `\n💬 ${discCh}`;
      embed.addFields({ name: '📢 Rappels Automatiques', value: remVal, inline: false });
    }

    const noCoins = getNoCoinsChannels(guildId).map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({ name: '🚫 Salons Sans Coins', value: noCoins.length ? noCoins.join('\n') : 'Aucun (coins partout) ✅', inline: false });

    return interaction.update({ embeds: [embed], components: createMainComponents() });
  }
}

module.exports = { configCommand, handleConfigInteraction };