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
      { name: '📋 Salon de Logs', value: 'Définis où le bot enverra les logs du serveur', inline: false },
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
    return interaction.update({ embeds: [new EmbedBuilder().setTitle('✅ Configuration terminée').setDescription('Tu peux utiliser `/config` à tout moment.').setColor(PSG_BLUE)], components: [] });
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

    const textChannels = guild.channels.cache.filter(c => c.isTextBased() && !c.isThread()).first(25);
    const addOptions = textChannels.map(c => ({ label: `#${c.name}`.slice(0, 100), value: `${cmd}__add__${c.id}`, description: c.parent?.name || 'Sans catégorie' }));
    const removeOptions = channels.map(id => {
      const ch = guild.channels.cache.get(id);
      return ch ? { label: `#${ch.name}`.slice(0, 100), value: `${cmd}__remove__${id}` } : null;
    }).filter(Boolean);

    const rows = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_channels').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))];
    if (addOptions.length) rows.unshift(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_channel_add').setPlaceholder('➕ Ajouter un salon').addOptions(addOptions)));
    if (removeOptions.length) rows.splice(rows.length - 1, 0, new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_channel_remove').setPlaceholder('➖ Retirer un salon').addOptions(removeOptions)));

    return interaction.update({ embeds: [embed], components: rows.slice(0, 5) });
  }

  if (customId === 'config_channel_add') {
    const value = interaction.values[0];
    const [cmd, , channelId] = value.split('__');
    addChannelPermission(guildId, cmd, channelId);
    const ch = guild.channels.cache.get(channelId);
    return interaction.reply({ content: `✅ ${ch} ajouté pour \`/${cmd}\``, flags: MessageFlags.Ephemeral });
  }

  if (customId === 'config_channel_remove') {
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

    const roles = guild.roles.cache.filter(r => r.name !== '@everyone').first(25);
    const addOptions = roles.map(r => ({ label: r.name.slice(0, 100), value: `admin__add__${r.id}`, emoji: '👑' }));
    const removeOptions = adminRoles.map(id => {
      const r = guild.roles.cache.get(id);
      return r ? { label: r.name.slice(0, 100), value: `admin__remove__${id}` } : null;
    }).filter(Boolean);

    const rows = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_back_main').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))];
    if (addOptions.length) rows.unshift(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_role_add').setPlaceholder('➕ Ajouter un rôle admin').addOptions(addOptions)));
    if (removeOptions.length) rows.splice(rows.length - 1, 0, new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_role_remove').setPlaceholder('➖ Retirer un rôle admin').addOptions(removeOptions)));

    return interaction.update({ embeds: [embed], components: rows.slice(0, 5) });
  }

  if (customId === 'config_role_add') {
    const value = interaction.values[0];
    const [, , roleId] = value.split('__');
    const role = guild.roles.cache.get(roleId);
    addRolePermission(guildId, 'admin', roleId);
    return interaction.reply({ content: `✅ ${role} peut maintenant utiliser les commandes admin`, flags: MessageFlags.Ephemeral });
  }

  if (customId === 'config_role_remove') {
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

    const roles = guild.roles.cache.filter(r => r.name !== '@everyone').first(25);
    const addOptions = roles.map(r => ({ label: r.name.slice(0, 100), value: `config__add__${r.id}`, emoji: '🔧' }));
    const removeOptions = configRoles.map(id => {
      const r = guild.roles.cache.get(id);
      return r ? { label: r.name.slice(0, 100), value: `config__remove__${id}` } : null;
    }).filter(Boolean);

    const rows = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_back_main').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))];
    if (addOptions.length) rows.unshift(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_role_config_action').setPlaceholder('➕ Ajouter un rôle config').addOptions(addOptions)));
    if (removeOptions.length) rows.splice(rows.length - 1, 0, new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_role_config_action').setPlaceholder('➖ Retirer un rôle config').addOptions(removeOptions)));

    return interaction.update({ embeds: [embed], components: rows.slice(0, 5) });
  }

  if (customId === 'config_role_config_action') {
    const value = interaction.values[0];
    const [, action, roleId] = value.split('__');
    const role = guild.roles.cache.get(roleId);
    if (action === 'add') {
      addRolePermission(guildId, 'config', roleId);
      return interaction.reply({ content: `✅ ${role} peut maintenant utiliser \`/config\``, flags: MessageFlags.Ephemeral });
    } else {
      removeRolePermission(guildId, 'config', roleId);
      return interaction.reply({ content: `✅ ${role ? role.name : 'Rôle'} retiré des rôles config`, flags: MessageFlags.Ephemeral });
    }
  }

  // ==================== SALON DE LOGS ====================
  if (customId === 'config_logs') {
    const config = loadServerConfig(guildId);
    const logsChannelId = config?.logs_channel;
    const logsChannel = logsChannelId ? guild.channels.cache.get(logsChannelId) : null;

    const embed = new EmbedBuilder()
      .setTitle('📋 Configuration du Salon de Logs')
      .setDescription('Configure le salon qui recevra tous les logs.')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Salon actuel', value: logsChannel ? logsChannel.toString() : 'Non configuré ❌', inline: false });

    const textChannels = guild.channels.cache.filter(c => c.isTextBased() && !c.isThread()).first(25);
    const options = textChannels.map(c => ({ label: `#${c.name}`.slice(0, 100), value: c.id, description: c.parent?.name || 'Sans catégorie' }));

    const rows = [
      ...(options.length ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_logs_set').setPlaceholder('Définir le salon de logs').addOptions(options))] : []),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('config_logs_disable').setLabel('🗑️ Désactiver les logs').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('config_back_main').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
      ),
    ];

    return interaction.update({ embeds: [embed], components: rows });
  }

  if (customId === 'config_logs_set') {
    const channelId = interaction.values[0];
    const config = loadServerConfig(guildId) || {};
    config.logs_channel = channelId;
    saveServerConfig(guildId, config);
    const ch = guild.channels.cache.get(channelId);
    return interaction.reply({ content: `✅ ${ch} recevra maintenant tous les logs du serveur`, flags: MessageFlags.Ephemeral });
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

    const textChannels = guild.channels.cache.filter(c => c.isTextBased() && !c.isThread()).first(25);
    const channelOptions = textChannels.map(c => ({ label: `#${c.name}`.slice(0, 100), value: c.id, description: c.parent?.name || 'Sans catégorie' }));
    const intervalOptions = [
      { label: '1 minute', value: '0.0167', emoji: '⚡' }, { label: '5 minutes', value: '0.0833', emoji: '⚡' },
      { label: '15 minutes', value: '0.25', emoji: '⏱️' }, { label: '30 minutes', value: '0.5', emoji: '⏱️' },
      { label: '1 heure', value: '1', emoji: '⏰' }, { label: '2 heures', value: '2', emoji: '⏰' },
      { label: '3 heures', value: '3', emoji: '⏰' }, { label: '6 heures (recommandé)', value: '6', emoji: '✅' },
      { label: '12 heures', value: '12', emoji: '⏰' }, { label: '24 heures', value: '24', emoji: '⏰' },
    ];

    const rows = [
      ...(channelOptions.length ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_reminder_set_channel').setPlaceholder('Définir le salon de rappels').addOptions(channelOptions))] : []),
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_reminder_set_interval').setPlaceholder('⏰ Modifier le délai').addOptions(intervalOptions)),
      ...(channelOptions.length ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_reminder_set_discussion').setPlaceholder('💬 Salon de discussion').addOptions(channelOptions))] : []),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('config_reminder_enable').setLabel('✅ Activer').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('config_reminder_disable').setLabel('❌ Désactiver').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('config_reminder_delete').setLabel('🗑️ Tout supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('config_back_main').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
      ),
    ];

    return interaction.update({ embeds: [embed], components: rows.slice(0, 5) });
  }

  if (customId === 'config_reminder_set_channel') {
    interaction.client.autoReminder?.setReminderChannel(guildId, interaction.values[0]);
    return interaction.reply({ content: `✅ Salon de rappels configuré !`, flags: MessageFlags.Ephemeral });
  }

  if (customId === 'config_reminder_set_interval') {
    const hours = parseFloat(interaction.values[0]);
    interaction.client.autoReminder?.setInterval(guildId, hours);
    return interaction.reply({ content: `✅ Intervalle défini à **${formatInterval(hours)}**`, flags: MessageFlags.Ephemeral });
  }

  if (customId === 'config_reminder_set_discussion') {
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

    const textChannels = guild.channels.cache.filter(c => c.isTextBased() && !c.isThread()).first(25);
    const addOptions = textChannels.map(c => ({ label: `#${c.name}`.slice(0, 100), value: `nocoins__add__${c.id}`, description: c.parent?.name || 'Sans catégorie' }));
    const removeOptions = noCoins.map(id => {
      const ch = guild.channels.cache.get(id);
      return ch ? { label: `#${ch.name}`.slice(0, 100), value: `nocoins__remove__${id}` } : null;
    }).filter(Boolean);

    const rows = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('config_back_main').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary))];
    if (addOptions.length) rows.unshift(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_nocoins_action').setPlaceholder('➕ Ajouter salon sans coins').addOptions(addOptions)));
    if (removeOptions.length) rows.splice(rows.length - 1, 0, new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('config_nocoins_action').setPlaceholder('➖ Retirer salon sans coins').addOptions(removeOptions)));

    return interaction.update({ embeds: [embed], components: rows.slice(0, 5) });
  }

  if (customId === 'config_nocoins_action') {
    const value = interaction.values[0];
    const [, action, channelId] = value.split('__');
    const ch = guild.channels.cache.get(channelId);
    if (action === 'add') {
      addNoCoinsChannel(guildId, channelId);
      return interaction.reply({ content: `✅ ${ch} ajouté à la liste sans coins`, flags: MessageFlags.Ephemeral });
    } else {
      removeNoCoinsChannel(guildId, channelId);
      return interaction.reply({ content: `✅ ${ch ? ch.toString() : 'Salon'} retiré de la liste sans coins`, flags: MessageFlags.Ephemeral });
    }
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