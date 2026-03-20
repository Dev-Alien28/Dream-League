// src/commands/config.js - Panneau de configuration interactif
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, MessageFlags } = require('discord.js');
const {
  loadServerConfig, saveServerConfig,
  addChannelPermission, removeChannelPermission, getAllowedChannels,
  addRolePermission, removeRolePermission, getAllowedRoles,
  getNoCoinsChannels, addNoCoinsChannel, removeNoCoinsChannel,
  getNoCoinsCategories, addNoCoinCategory, removeNoCoinCategory,
  checkConfigPermission,
} = require('../utils/permissions');
const { getMinigameChannel, getNextMinigameTime } = require('../utils/database');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON } = require('../config/settings');

function formatInterval(hours) {
  if (hours < 1) { const m = Math.round(hours * 60); return `${m} minute${m > 1 ? 's' : ''}`; }
  if (hours === 1) return '1 heure';
  return `${Math.floor(hours)} heures`;
}

// ==================== HELPERS ====================

function buildSelectMenus(items, baseId, placeholder, chunkSize = 25) {
  if (!items.length) return [];
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

function channelOptions(guild, valuePrefix) {
  return guild.channels.cache
    .filter(c => c.isTextBased() && !c.isThread())
    .map(c => ({
      label: `#${c.name}`.slice(0, 100),
      value: `${valuePrefix}${c.id}`,
      description: (c.parent?.name || 'Sans catégorie').slice(0, 100),
    }));
}

function categoryOptions(guild, valuePrefix) {
  return guild.channels.cache
    .filter(c => c.type === ChannelType.GuildCategory)
    .map(c => ({
      label: `📁 ${c.name}`.slice(0, 100),
      value: `${valuePrefix}${c.id}`,
    }));
}

function roleOptions(guild, valuePrefix) {
  return guild.roles.cache
    .filter(r => r.name !== '@everyone')
    .map(r => ({
      label: r.name.slice(0, 100),
      value: `${valuePrefix}${r.id}`,
    }));
}

/** Jusqu'à 4 rows de sélecteurs + 1 row bouton retour */
function buildSelectRows(selectMenus, backId, extraButtons = []) {
  const rows = selectMenus.slice(0, 4).map(m => new ActionRowBuilder().addComponents(m));
  const backBtn = new ButtonBuilder().setCustomId(backId).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary);
  rows.push(new ActionRowBuilder().addComponents(backBtn, ...extraButtons));
  return rows;
}

/** Row avec boutons ➕ Ajouter / ➖ Retirer / ⬅️ Retour */
function buildActionButtons(addId, removeId, backId, hasItems = true) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(addId).setLabel('➕ Ajouter').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(removeId).setLabel('➖ Retirer').setStyle(ButtonStyle.Danger).setDisabled(!hasItems),
    new ButtonBuilder().setCustomId(backId).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
  )];
}

// ==================== MAIN ====================

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
      { name: '🚫 Sans Coins', value: 'Définis les salons ou catégories entières où les membres ne gagnent pas de coins', inline: false },
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
      new ButtonBuilder().setCustomId('config_no_coins').setLabel('🚫 Sans Coins').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config_view_full').setLabel('📊 Voir Configuration').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('config_close').setLabel('❌ Fermer').setStyle(ButtonStyle.Danger),
    ),
  ];
}

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

// ==================== HANDLER ====================

async function handleConfigInteraction(interaction) {
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  const customId = interaction.customId;

  if (customId === 'config_back_main') {
    return interaction.update({ embeds: [createMainEmbed(interaction)], components: createMainComponents() });
  }

  if (customId === 'config_close') {
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('✅ Configuration terminée').setDescription('Tu peux utiliser `/config` à tout moment.').setColor(PSG_BLUE)],
      components: [],
    });
  }

  // ==================== SALONS DE COMMANDES ====================
  if (customId === 'config_channels') {
    const embed = new EmbedBuilder()
      .setTitle('📺 Salons de Commandes')
      .setDescription('Choisis une commande pour la configurer.')
      .setColor(PSG_BLUE);
    for (const cmd of ['solde', 'packs', 'collection', 'minigame']) {
      const chs = getAllowedChannels(guildId, cmd).map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
      embed.addFields({ name: `/${cmd}`, value: chs.length ? chs.join('\n') : 'Partout ✅', inline: true });
    }
    const select = new StringSelectMenuBuilder()
      .setCustomId('config_channels_select_cmd')
      .setPlaceholder('Choisir une commande à configurer')
      .addOptions([
        { label: 'Solde', value: 'solde', emoji: '💰' },
        { label: 'Packs', value: 'packs', emoji: '📦' },
        { label: 'Collection', value: 'collection', emoji: '🎴' },
        { label: 'Mini-jeu', value: 'minigame', emoji: '⚡' },
      ]);
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
      .setTitle(`📺 Salons pour /${cmd}`)
      .setColor(PSG_BLUE)
      .addFields({ name: 'Salons configurés', value: chList.length ? chList.join('\n') : 'Partout ✅', inline: false });
    return interaction.update({
      embeds: [embed],
      components: buildActionButtons(`config_ch_add_${cmd}`, `config_ch_rem_${cmd}`, 'config_channels', channels.length > 0),
    });
  }

  if (customId.startsWith('config_ch_add_')) {
    const cmd = customId.replace('config_ch_add_', '');
    const opts = channelOptions(guild, `${cmd}__add__`);
    const menus = buildSelectMenus(opts, 'config_channel_add', `➕ Salon pour /${cmd}`);
    if (!menus.length) return interaction.reply({ content: '❌ Aucun salon disponible.', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle(`➕ Ajouter un salon pour /${cmd}`).setColor(PSG_BLUE);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, `config_ch_back_${cmd}`) });
  }

  if (customId.startsWith('config_ch_rem_')) {
    const cmd = customId.replace('config_ch_rem_', '');
    const channels = getAllowedChannels(guildId, cmd);
    const removeOpts = channels.map(id => {
      const ch = guild.channels.cache.get(id);
      return ch ? { label: `#${ch.name}`.slice(0, 100), value: `${cmd}__remove__${id}` } : null;
    }).filter(Boolean);
    const menus = buildSelectMenus(removeOpts, 'config_channel_remove', `➖ Retirer salon pour /${cmd}`);
    if (!menus.length) return interaction.reply({ content: '❌ Aucun salon à retirer.', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle(`➖ Retirer un salon pour /${cmd}`).setColor(PSG_RED);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, `config_ch_back_${cmd}`) });
  }

  if (customId.startsWith('config_ch_back_')) {
    const cmd = customId.replace('config_ch_back_', '');
    const channels = getAllowedChannels(guildId, cmd);
    const chList = channels.map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
    const embed = new EmbedBuilder()
      .setTitle(`📺 Salons pour /${cmd}`)
      .setColor(PSG_BLUE)
      .addFields({ name: 'Salons configurés', value: chList.length ? chList.join('\n') : 'Partout ✅', inline: false });
    return interaction.update({
      embeds: [embed],
      components: buildActionButtons(`config_ch_add_${cmd}`, `config_ch_rem_${cmd}`, 'config_channels', channels.length > 0),
    });
  }

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
    const ch = guild.channels.cache.get(channelId);
    return interaction.reply({ content: `✅ ${ch ? ch.toString() : 'Salon'} retiré pour \`/${cmd}\``, flags: MessageFlags.Ephemeral });
  }

  // ==================== RÔLES ADMIN ====================
  if (customId === 'config_roles') {
    const adminRoles = getAllowedRoles(guildId, 'admin');
    const roleList = adminRoles.map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    const embed = new EmbedBuilder()
      .setTitle('👑 Rôles Administrateurs')
      .setDescription('Rôles pouvant utiliser `/addcoins`, `/removecoins`, `/setcoins`, `/give`.')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Rôles configurés', value: roleList.length ? roleList.join('\n') : 'Permissions Discord natives 🔧', inline: false });
    return interaction.update({
      embeds: [embed],
      components: buildActionButtons('config_roles_add', 'config_roles_rem', 'config_back_main', adminRoles.length > 0),
    });
  }

  if (customId === 'config_roles_add') {
    const opts = roleOptions(guild, 'admin__add__');
    const menus = buildSelectMenus(opts, 'config_role_add', '➕ Ajouter un rôle admin');
    if (!menus.length) return interaction.reply({ content: '❌ Aucun rôle disponible.', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle('➕ Ajouter un rôle administrateur').setColor(PSG_BLUE);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_roles') });
  }

  if (customId === 'config_roles_rem') {
    const adminRoles = getAllowedRoles(guildId, 'admin');
    const removeOpts = adminRoles.map(id => {
      const r = guild.roles.cache.get(id);
      return r ? { label: r.name.slice(0, 100), value: `admin__remove__${id}` } : null;
    }).filter(Boolean);
    const menus = buildSelectMenus(removeOpts, 'config_role_remove', '➖ Retirer un rôle admin');
    if (!menus.length) return interaction.reply({ content: '❌ Aucun rôle à retirer.', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle('➖ Retirer un rôle administrateur').setColor(PSG_RED);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_roles') });
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

  // ==================== RÔLES CONFIG ====================
  if (customId === 'config_roles_config') {
    const configRoles = getAllowedRoles(guildId, 'config');
    const roleList = configRoles.map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    const embed = new EmbedBuilder()
      .setTitle('🔧 Rôles de Configuration')
      .setDescription('Rôles pouvant accéder à `/config`.\n\n**Par défaut :** Propriétaire + permission Administrateur')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Rôles configurés', value: roleList.length ? roleList.join('\n') : 'Permissions Discord natives 🔧', inline: false });
    return interaction.update({
      embeds: [embed],
      components: buildActionButtons('config_rolecfg_add', 'config_rolecfg_rem', 'config_back_main', configRoles.length > 0),
    });
  }

  if (customId === 'config_rolecfg_add') {
    const opts = roleOptions(guild, 'config__add__');
    const menus = buildSelectMenus(opts, 'config_rolecfg_add_sel', '➕ Ajouter un rôle config');
    if (!menus.length) return interaction.reply({ content: '❌ Aucun rôle disponible.', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle('➕ Ajouter un rôle de configuration').setColor(PSG_BLUE);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_roles_config') });
  }

  if (customId === 'config_rolecfg_rem') {
    const configRoles = getAllowedRoles(guildId, 'config');
    const removeOpts = configRoles.map(id => {
      const r = guild.roles.cache.get(id);
      return r ? { label: r.name.slice(0, 100), value: `config__remove__${id}` } : null;
    }).filter(Boolean);
    const menus = buildSelectMenus(removeOpts, 'config_rolecfg_rem_sel', '➖ Retirer un rôle config');
    if (!menus.length) return interaction.reply({ content: '❌ Aucun rôle à retirer.', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle('➖ Retirer un rôle de configuration').setColor(PSG_RED);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_roles_config') });
  }

  if (customId.startsWith('config_rolecfg_add_sel_')) {
    const value = interaction.values[0];
    const [, , roleId] = value.split('__');
    const role = guild.roles.cache.get(roleId);
    addRolePermission(guildId, 'config', roleId);
    return interaction.reply({ content: `✅ ${role} peut maintenant utiliser \`/config\``, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('config_rolecfg_rem_sel_')) {
    const value = interaction.values[0];
    const [, , roleId] = value.split('__');
    const role = guild.roles.cache.get(roleId);
    removeRolePermission(guildId, 'config', roleId);
    return interaction.reply({ content: `✅ ${role ? role.name : 'Rôle'} retiré des rôles config`, flags: MessageFlags.Ephemeral });
  }

  // ==================== SALON DE LOGS ====================
  if (customId === 'config_logs') {
    const config = loadServerConfig(guildId);
    const logsChannel = config?.logs_channel ? guild.channels.cache.get(config.logs_channel) : null;
    const embed = new EmbedBuilder()
      .setTitle('📋 Salon de Logs')
      .setDescription('**Logs enregistrés :**\n• 📦 Achats de packs\n• 👑 Commandes admin\n• 🎁 Give\n• ⚡ Mini-jeu')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Salon actuel', value: logsChannel ? logsChannel.toString() : 'Non configuré ❌', inline: false });
    return interaction.update({
      embeds: [embed],
      components: buildActionButtons('config_logs_add', 'config_logs_disable', 'config_back_main', !!logsChannel),
    });
  }

  if (customId === 'config_logs_add') {
    const opts = channelOptions(guild, '');
    const menus = buildSelectMenus(opts, 'config_logs_set', '📋 Choisir le salon de logs');
    const embed = new EmbedBuilder().setTitle('📋 Choisir le salon de logs').setColor(PSG_BLUE);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_logs') });
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
    return interaction.reply({ content: '✅ Salon de logs désactivé', flags: MessageFlags.Ephemeral });
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
      .setTitle('📢 Rappels Automatiques')
      .setColor(PSG_BLUE)
      .addFields(
        { name: '📢 Salon', value: channel ? channel.toString() : 'Non configuré ❌', inline: true },
        { name: '📊 Statut', value: isEnabled ? '✅ Activé' : '❌ Désactivé', inline: true },
        { name: '⏰ Intervalle', value: formatInterval(interval), inline: true },
        { name: '💬 Discussion', value: discChannel ? discChannel.toString() : 'Non défini', inline: false },
      );

    return interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('config_rem_set_channel').setLabel('📢 Salon rappels').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('config_rem_set_discussion').setLabel('💬 Salon discussion').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('config_rem_set_interval').setLabel('⏰ Intervalle').setStyle(ButtonStyle.Primary),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('config_reminder_enable').setLabel('✅ Activer').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('config_reminder_disable').setLabel('❌ Désactiver').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('config_reminder_delete').setLabel('🗑️ Supprimer tout').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('config_back_main').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  if (customId === 'config_rem_set_channel') {
    const opts = channelOptions(guild, '');
    const menus = buildSelectMenus(opts, 'config_reminder_set_channel', '📢 Salon de rappels');
    const embed = new EmbedBuilder().setTitle('📢 Choisir le salon de rappels').setColor(PSG_BLUE);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_reminders') });
  }

  if (customId === 'config_rem_set_discussion') {
    const opts = channelOptions(guild, '');
    const menus = buildSelectMenus(opts, 'config_reminder_set_discussion', '💬 Salon de discussion');
    const embed = new EmbedBuilder().setTitle('💬 Choisir le salon de discussion').setColor(PSG_BLUE);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_reminders') });
  }

  if (customId === 'config_rem_set_interval') {
    const intervalOptions = [
      { label: '1 minute', value: '0.0167', emoji: '⚡' }, { label: '5 minutes', value: '0.0833', emoji: '⚡' },
      { label: '15 minutes', value: '0.25', emoji: '⏱️' }, { label: '30 minutes', value: '0.5', emoji: '⏱️' },
      { label: '1 heure', value: '1', emoji: '⏰' }, { label: '2 heures', value: '2', emoji: '⏰' },
      { label: '3 heures', value: '3', emoji: '⏰' }, { label: '6 heures (recommandé)', value: '6', emoji: '✅' },
      { label: '12 heures', value: '12', emoji: '⏰' }, { label: '24 heures', value: '24', emoji: '⏰' },
    ];
    const menu = new StringSelectMenuBuilder().setCustomId('config_reminder_set_interval').setPlaceholder('⏰ Choisir un intervalle').addOptions(intervalOptions);
    const embed = new EmbedBuilder().setTitle('⏰ Choisir l\'intervalle').setColor(PSG_BLUE);
    return interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_reminders').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary)),
      ],
    });
  }

  if (customId.startsWith('config_reminder_set_channel_')) {
    interaction.client.autoReminder?.setReminderChannel(guildId, interaction.values[0]);
    return interaction.reply({ content: '✅ Salon de rappels configuré !', flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('config_reminder_set_discussion_')) {
    interaction.client.autoReminder?.setDiscussionChannel(guildId, interaction.values[0]);
    const ch = guild.channels.cache.get(interaction.values[0]);
    return interaction.reply({ content: `✅ Salon de discussion défini : ${ch}`, flags: MessageFlags.Ephemeral });
  }

  if (customId === 'config_reminder_set_interval') {
    const hours = parseFloat(interaction.values[0]);
    interaction.client.autoReminder?.setInterval(guildId, hours);
    return interaction.reply({ content: `✅ Intervalle défini à **${formatInterval(hours)}**`, flags: MessageFlags.Ephemeral });
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

  // ==================== SANS COINS ====================
  if (customId === 'config_no_coins') {
    const noCoins = getNoCoinsChannels(guildId);
    const noCats = getNoCoinsCategories ? getNoCoinsCategories(guildId) : [];
    const chList = noCoins.map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
    const catList = noCats.map(id => { const c = guild.channels.cache.get(id); return c ? `📁 ${c.name}` : null; }).filter(Boolean);

    const embed = new EmbedBuilder()
      .setTitle('🚫 Sans Coins')
      .setDescription('Salons ou catégories où les membres ne gagnent pas de coins.\nChoisis une action :')
      .setColor(PSG_BLUE)
      .addFields(
        { name: '📺 Salons', value: chList.length ? chList.join('\n') : 'Aucun ✅', inline: true },
        { name: '📁 Catégories', value: catList.length ? catList.join('\n') : 'Aucune ✅', inline: true },
      );

    return interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('config_nc_ch_add').setLabel('➕ Salon').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('config_nc_ch_rem').setLabel('➖ Salon').setStyle(ButtonStyle.Danger).setDisabled(noCoins.length === 0),
          new ButtonBuilder().setCustomId('config_nc_cat_add').setLabel('➕ Catégorie').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('config_nc_cat_rem').setLabel('➖ Catégorie').setStyle(ButtonStyle.Danger).setDisabled(noCats.length === 0),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('config_back_main').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  if (customId === 'config_nc_ch_add') {
    const opts = channelOptions(guild, 'nocoins__add__');
    const menus = buildSelectMenus(opts, 'config_nocoins_add', '➕ Salon sans coins');
    const embed = new EmbedBuilder().setTitle('➕ Ajouter un salon sans coins').setColor(PSG_BLUE);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_no_coins') });
  }

  if (customId === 'config_nc_ch_rem') {
    const noCoins = getNoCoinsChannels(guildId);
    const removeOpts = noCoins.map(id => {
      const ch = guild.channels.cache.get(id);
      return ch ? { label: `#${ch.name}`.slice(0, 100), value: `nocoins__remove__${id}` } : null;
    }).filter(Boolean);
    const menus = buildSelectMenus(removeOpts, 'config_nocoins_remove', '➖ Retirer salon sans coins');
    if (!menus.length) return interaction.reply({ content: '❌ Aucun salon à retirer.', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle('➖ Retirer un salon sans coins').setColor(PSG_RED);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_no_coins') });
  }

  if (customId === 'config_nc_cat_add') {
    const opts = categoryOptions(guild, 'nocoincat__add__');
    const menus = buildSelectMenus(opts, 'config_nocoincat_add', '➕ Catégorie sans coins');
    if (!menus.length) return interaction.reply({ content: '❌ Aucune catégorie disponible.', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle('➕ Ajouter une catégorie sans coins').setColor(PSG_BLUE);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_no_coins') });
  }

  if (customId === 'config_nc_cat_rem') {
    const noCats = getNoCoinsCategories ? getNoCoinsCategories(guildId) : [];
    const removeOpts = noCats.map(id => {
      const cat = guild.channels.cache.get(id);
      return cat ? { label: `📁 ${cat.name}`.slice(0, 100), value: `nocoincat__remove__${id}` } : null;
    }).filter(Boolean);
    const menus = buildSelectMenus(removeOpts, 'config_nocoincat_remove', '➖ Retirer catégorie sans coins');
    if (!menus.length) return interaction.reply({ content: '❌ Aucune catégorie à retirer.', flags: MessageFlags.Ephemeral });
    const embed = new EmbedBuilder().setTitle('➖ Retirer une catégorie sans coins').setColor(PSG_RED);
    return interaction.update({ embeds: [embed], components: buildSelectRows(menus, 'config_no_coins') });
  }

  if (customId.startsWith('config_nocoins_add_')) {
    const value = interaction.values[0];
    const [, , channelId] = value.split('__');
    const ch = guild.channels.cache.get(channelId);
    addNoCoinsChannel(guildId, channelId);
    return interaction.reply({ content: `✅ ${ch} ajouté sans coins`, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('config_nocoins_remove_')) {
    const value = interaction.values[0];
    const [, , channelId] = value.split('__');
    const ch = guild.channels.cache.get(channelId);
    removeNoCoinsChannel(guildId, channelId);
    return interaction.reply({ content: `✅ ${ch ? ch.toString() : 'Salon'} retiré`, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('config_nocoincat_add_')) {
    const value = interaction.values[0];
    const [, , catId] = value.split('__');
    const cat = guild.channels.cache.get(catId);
    addNoCoinCategory(guildId, catId);
    return interaction.reply({ content: `✅ Catégorie **${cat?.name || catId}** ajoutée — tous ses salons sont sans coins`, flags: MessageFlags.Ephemeral });
  }

  if (customId.startsWith('config_nocoincat_remove_')) {
    const value = interaction.values[0];
    const [, , catId] = value.split('__');
    const cat = guild.channels.cache.get(catId);
    removeNoCoinCategory(guildId, catId);
    return interaction.reply({ content: `✅ Catégorie **${cat?.name || catId}** retirée`, flags: MessageFlags.Ephemeral });
  }

  // ==================== VUE COMPLÈTE ====================
  if (customId === 'config_view_full') {
    const config = loadServerConfig(guildId);
    const embed = new EmbedBuilder()
      .setTitle(`📊 Configuration — ${guild.name}`)
      .setColor(PSG_BLUE)
      .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

    for (const cmd of ['solde', 'packs', 'collection']) {
      const chs = getAllowedChannels(guildId, cmd).map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
      embed.addFields({ name: `📺 /${cmd}`, value: chs.length ? chs.slice(0, 5).join('\n') + (chs.length > 5 ? `\n+${chs.length - 5} autres` : '') : 'Partout ✅', inline: true });
    }

    const mgChannelId = getMinigameChannel(guildId);
    const mgChannel = mgChannelId ? guild.channels.cache.get(mgChannelId) : null;
    if (mgChannel) {
      try {
        const nextTime = getNextMinigameTime(guildId);
        embed.addFields({ name: '⚡ Mini-jeu', value: `${mgChannel}\n⏰ <t:${Math.floor(nextTime.getTime() / 1000)}:R>`, inline: true });
      } catch { embed.addFields({ name: '⚡ Mini-jeu', value: mgChannel.toString(), inline: true }); }
    } else {
      embed.addFields({ name: '⚡ Mini-jeu', value: 'Non configuré ❌', inline: true });
    }

    const adminRoles = getAllowedRoles(guildId, 'admin').map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({ name: '👑 Rôles Admin', value: adminRoles.length ? adminRoles.slice(0, 5).join('\n') + (adminRoles.length > 5 ? `\n+${adminRoles.length - 5} autres` : '') : 'Permissions Discord 🔧', inline: false });

    const configRoles = getAllowedRoles(guildId, 'config').map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({ name: '🔧 Rôles Config', value: configRoles.length ? configRoles.slice(0, 5).join('\n') + (configRoles.length > 5 ? `\n+${configRoles.length - 5} autres` : '') : 'Permissions Discord 🔧', inline: false });

    const logsChannel = config?.logs_channel ? guild.channels.cache.get(config.logs_channel) : null;
    embed.addFields({ name: '📋 Logs', value: logsChannel ? logsChannel.toString() : 'Non configuré ❌', inline: false });

    const reminder = interaction.client.autoReminder;
    if (reminder) {
      const remCh = reminder.getChannelId(guildId) ? guild.channels.cache.get(reminder.getChannelId(guildId)) : null;
      const discCh = reminder.getDiscussionChannelId(guildId) ? guild.channels.cache.get(reminder.getDiscussionChannelId(guildId)) : null;
      let remVal = remCh ? `${remCh}\n${reminder.isEnabled(guildId) ? '✅ Activé' : '❌ Désactivé'} • ${formatInterval(reminder.getInterval(guildId))}` : 'Non configuré ❌';
      if (discCh) remVal += `\n💬 ${discCh}`;
      embed.addFields({ name: '📢 Rappels', value: remVal, inline: false });
    }

    const noCoins = getNoCoinsChannels(guildId).map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({ name: '🚫 Salons', value: noCoins.length ? noCoins.slice(0, 5).join('\n') + (noCoins.length > 5 ? `\n+${noCoins.length - 5} autres` : '') : 'Aucun ✅', inline: true });

    const noCats = getNoCoinsCategories ? getNoCoinsCategories(guildId).map(id => { const c = guild.channels.cache.get(id); return c ? `📁 ${c.name}` : null; }).filter(Boolean) : [];
    embed.addFields({ name: '📁 Catégories', value: noCats.length ? noCats.slice(0, 5).join('\n') + (noCats.length > 5 ? `\n+${noCats.length - 5} autres` : '') : 'Aucune ✅', inline: true });

    return interaction.update({ embeds: [embed], components: createMainComponents() });
  }
}

module.exports = { configCommand, handleConfigInteraction };