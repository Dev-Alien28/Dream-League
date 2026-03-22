// src/commands/config.js - Panneau de configuration interactif
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, MessageFlags } = require('discord.js');
const {
  loadServerConfig, saveServerConfig,
  addRolePermission, removeRolePermission, getAllowedRoles,
  addChannelPermission, removeChannelPermission, getAllowedChannels,
  getNoCoinsChannels, addNoCoinsChannel, removeNoCoinsChannel,
  getNoCoinsCategories, addNoCoinCategory, removeNoCoinCategory,
  checkConfigPermission,
} = require('../utils/permissions');
const {
  getMinigameChannel, getNextMinigameTime,
  getGamingRoomMessages, addGamingRoomMessage, removeGamingRoomMessage,
  getPackAnnounceChannel, setPackAnnounceChannel,
} = require('../utils/database');
const { sendGamingRoomEmbed } = require('./gaming_room');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON } = require('../config/settings');

// ==================== HELPERS PAGINATION ====================

function buildSelectMenus(items, baseId, placeholder, chunkSize = 25) {
  if (!items.length) return [];
  const menus = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const pageNum = Math.floor(i / chunkSize) + 1;
    const totalPages = Math.ceil(items.length / chunkSize);
    menus.push(
      new StringSelectMenuBuilder()
        .setCustomId(`${baseId}_${Math.floor(i / chunkSize)}`)
        .setPlaceholder(`${placeholder}${totalPages > 1 ? ` (${pageNum}/${totalPages})` : ''}`)
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
    .map(c => ({ label: `📁 ${c.name}`.slice(0, 100), value: `${valuePrefix}${c.id}` }));
}

function roleOptions(guild, valuePrefix) {
  return guild.roles.cache
    .filter(r => r.name !== '@everyone')
    .map(r => ({ label: r.name.slice(0, 100), value: `${valuePrefix}${r.id}` }));
}

// Construit les ActionRows : max 4 menus + 1 row de boutons
function buildRows(selectMenus, backId, extraButtons = []) {
  const rows = selectMenus.slice(0, 4).map(m => new ActionRowBuilder().addComponents(m));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(backId).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
    ...extraButtons,
  ));
  return rows;
}

// ==================== EMBEDS PRINCIPAUX ====================

function createMainEmbed(interaction) {
  return new EmbedBuilder()
    .setTitle('⚙️ Configuration du Bot PSG')
    .setDescription(`Bienvenue dans le panneau de configuration pour **${interaction.guild.name}**\n\nChoisis une catégorie :`)
    .setColor(PSG_BLUE)
    .addFields(
      { name: '🕹️ Gaming Room', value: 'Définis les salons où l\'embed principal sera envoyé (Boosters, Collection, Portefeuille)', inline: false },
      { name: '🗂️ Salon /collection', value: 'Définis les salons où la commande `/collection` peut être utilisée', inline: false },
      { name: '👑 Rôles Administrateurs', value: 'Définis quels rôles peuvent utiliser `/addcoins`, `/removecoins`, `/setcoins`, `/give`', inline: false },
      { name: '🔧 Rôles de Configuration', value: 'Définis quels rôles peuvent accéder à `/config`', inline: false },
      { name: '📣 Salon d\'annonce packs', value: 'Définis le salon où les ouvertures de packs seront annoncées publiquement avec @mention du joueur', inline: false },
      { name: '📋 Salon de Logs', value: 'Définis où le bot enverra ses logs (achats packs, commandes admin, give, mini-jeu)', inline: false },
      { name: '🚫 Salons/Catégories Sans Coins', value: 'Définis les salons ou catégories où les membres ne gagnent pas de coins', inline: false },
    )
    .setFooter({ text: 'Paris Saint-Germain • Configuration', iconURL: PSG_FOOTER_ICON });
}

function createMainComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config_gaming_room').setLabel('🕹️ Gaming Room').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_roles').setLabel('👑 Rôles Admins').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_roles_config').setLabel('🔧 Rôles Config').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config_collection_salon').setLabel('🗂️ Salon /collection').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_pack_announce').setLabel('📣 Annonce packs').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_logs').setLabel('📋 Salon de Logs').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_no_coins').setLabel('🚫 Sans Coins').setStyle(ButtonStyle.Primary),
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

// ==================== HELPER : répondre sans risque de timeout ====================
// FIX: Toutes les interactions de select menu utilisent deferUpdate + editReply
// pour éviter les ConnectTimeoutError lors des interaction.update() ou reply() tardifs.

async function safeUpdate(interaction, data) {
  try {
    if (interaction.isButton()) {
      return await interaction.update(data);
    }
    // Pour les select menus : deferUpdate puis editReply
    await interaction.deferUpdate();
    return await interaction.editReply(data);
  } catch (e) {
    console.error('⚠️ safeUpdate error:', e.message);
  }
}

async function safeReply(interaction, data) {
  try {
    if (interaction.deferred) return await interaction.editReply(data);
    return await interaction.reply({ ...data, flags: MessageFlags.Ephemeral });
  } catch (e) {
    console.error('⚠️ safeReply error:', e.message);
  }
}

// ==================== GESTIONNAIRE D'INTERACTIONS ====================

async function handleConfigInteraction(interaction) {
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  const customId = interaction.customId;

  if (customId === 'config_back_main') return safeUpdate(interaction, { embeds: [createMainEmbed(interaction)], components: createMainComponents() });
  if (customId === 'config_close') return safeUpdate(interaction, { embeds: [new EmbedBuilder().setTitle('✅ Configuration terminée').setDescription('Tu peux utiliser `/config` à tout moment.').setColor(PSG_BLUE)], components: [] });

  // ==================== 🕹️ GAMING ROOM ====================
  if (customId === 'config_gaming_room') {
    const rooms = getGamingRoomMessages(guildId);
    const roomList = rooms.map(r => { const ch = guild.channels.cache.get(r.channelId); return ch ? ch.toString() : null; }).filter(Boolean);

    const embed = new EmbedBuilder()
      .setTitle('🕹️ Gaming Room')
      .setDescription(
        'L\'embed Gaming Room contient les boutons **Boosters**, **Collection** et **Portefeuille**.\n'
        + 'Sélectionne un salon pour y envoyer l\'embed, ou retire un salon existant.\n\n'
        + `**Salons actifs :** ${roomList.length ? roomList.join(', ') : 'Aucun ❌'}`,
      )
      .setColor(PSG_BLUE)
      .setFooter({ text: 'Tu peux avoir plusieurs salons Gaming Room simultanément', iconURL: PSG_FOOTER_ICON });

    const addOpts = channelOptions(guild, 'gr__add__');
    const addMenus = buildSelectMenus(addOpts, 'config_gr_add', '➕ Envoyer l\'embed dans un salon');

    const removeOpts = rooms.map(r => {
      const ch = guild.channels.cache.get(r.channelId);
      return ch ? { label: `#${ch.name}`.slice(0, 100), value: `gr__remove__${r.channelId}`, description: 'Retirer cet embed' } : null;
    }).filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_gr_remove', '➖ Retirer un salon Gaming Room');

    const rows = buildRows([...addMenus, ...removeMenus], 'config_back_main');
    return safeUpdate(interaction, { embeds: [embed], components: rows });
  }

  // Ajouter salon Gaming Room
  if (customId.startsWith('config_gr_add_')) {
    const channelId = interaction.values[0].replace('gr__add__', '');
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return safeReply(interaction, { content: '❌ Salon introuvable.' });

    const existing = getGamingRoomMessages(guildId);
    if (existing.some(r => r.channelId === channelId)) {
      return safeReply(interaction, { content: `⚠️ Un embed Gaming Room existe déjà dans ${channel} !` });
    }

    try {
      await interaction.deferUpdate();
      const message = await sendGamingRoomEmbed(channel);
      addGamingRoomMessage(guildId, channelId, message.id);
      return await interaction.editReply({ content: `✅ Embed Gaming Room envoyé dans ${channel} !`, embeds: [], components: [] });
    } catch (e) {
      console.error('❌ Erreur envoi Gaming Room:', e.message);
      return await interaction.editReply({ content: `❌ Impossible d'envoyer dans ${channel} — vérifie les permissions du bot.`, embeds: [], components: [] });
    }
  }

  // Retirer salon Gaming Room
  if (customId.startsWith('config_gr_remove_')) {
    const channelId = interaction.values[0].replace('gr__remove__', '');
    const rooms = getGamingRoomMessages(guildId);
    const room = rooms.find(r => r.channelId === channelId);

    if (room) {
      try {
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
          const msg = await channel.messages.fetch(room.messageId).catch(() => null);
          if (msg) await msg.delete().catch(() => {});
        }
      } catch { /* message déjà supprimé */ }
      removeGamingRoomMessage(guildId, channelId);
    }

    const ch = guild.channels.cache.get(channelId);
    return safeReply(interaction, { content: `✅ Gaming Room retiré${ch ? ` de ${ch}` : ''}` });
  }

  // ==================== 🗂️ SALON /COLLECTION ====================
  // FIX: Utilise config.channels.collection (via addChannelPermission/getAllowedChannels)
  // au lieu de l'ancien config.collection_channels — cohérent avec gaming_room.js et permissions.js

  if (customId === 'config_collection_salon') {
    const collectionChannels = getAllowedChannels(guildId, 'collection');
    const chList = collectionChannels.map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);

    const embed = new EmbedBuilder()
      .setTitle('🗂️ Salon /collection')
      .setDescription(
        'Configure les salons où la commande `/collection` peut être utilisée.\n\n'
        + 'Si aucun salon n\'est configuré, la commande est utilisable partout.\n\n'
        + `**Salons autorisés :** ${chList.length ? chList.join(', ') : 'Partout ✅'}`,
      )
      .setColor(PSG_BLUE);

    const addOpts = channelOptions(guild, 'collsalon__add__');
    const addMenus = buildSelectMenus(addOpts, 'config_collsalon_add', '➕ Ajouter un salon autorisé');
    const removeOpts = collectionChannels.map(id => {
      const ch = guild.channels.cache.get(id);
      return ch ? { label: `#${ch.name}`.slice(0, 100), value: `collsalon__remove__${id}` } : null;
    }).filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_collsalon_remove', '➖ Retirer un salon');

    return safeUpdate(interaction, { embeds: [embed], components: buildRows([...addMenus, ...removeMenus], 'config_back_main') });
  }

  if (customId.startsWith('config_collsalon_add_')) {
    // FIX: deferUpdate d'abord pour éviter le timeout réseau
    await interaction.deferUpdate();
    const value = interaction.values[0];
    const channelId = value.replace('collsalon__add__', '');
    addChannelPermission(guildId, 'collection', channelId);
    const ch = guild.channels.cache.get(channelId);
    return interaction.editReply({ content: `✅ ${ch} ajouté aux salons autorisés pour \`/collection\``, embeds: [], components: [] });
  }

  if (customId.startsWith('config_collsalon_remove_')) {
    await interaction.deferUpdate();
    const value = interaction.values[0];
    const channelId = value.replace('collsalon__remove__', '');
    removeChannelPermission(guildId, 'collection', channelId);
    return interaction.editReply({ content: '✅ Salon retiré des salons autorisés pour `/collection`', embeds: [], components: [] });
  }

  // ==================== 👑 RÔLES ADMIN ====================
  if (customId === 'config_roles') {
    const adminRoles = getAllowedRoles(guildId, 'admin');
    const embed = new EmbedBuilder()
      .setTitle('👑 Rôles Administrateurs')
      .setDescription('Configure les rôles pouvant utiliser `/addcoins`, `/removecoins`, `/setcoins`, `/give`.')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Rôles actuels', value: adminRoles.map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean).join('\n') || 'Permissions Discord natives 🔧', inline: false });

    const addMenus = buildSelectMenus(roleOptions(guild, 'admin__add__'), 'config_role_add', '➕ Ajouter un rôle admin');
    const removeOpts = adminRoles.map(id => { const r = guild.roles.cache.get(id); return r ? { label: r.name.slice(0, 100), value: `admin__remove__${id}` } : null; }).filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_role_remove', '➖ Retirer un rôle admin');
    return safeUpdate(interaction, { embeds: [embed], components: buildRows([...addMenus, ...removeMenus], 'config_back_main') });
  }

  if (customId.startsWith('config_role_add_')) {
    await interaction.deferUpdate();
    const parts = interaction.values[0].split('__');
    const roleId = parts[2];
    addRolePermission(guildId, 'admin', roleId);
    const role = guild.roles.cache.get(roleId);
    return interaction.editReply({ content: `✅ ${role} peut maintenant utiliser les commandes admin`, embeds: [], components: [] });
  }

  if (customId.startsWith('config_role_remove_')) {
    await interaction.deferUpdate();
    const parts = interaction.values[0].split('__');
    const roleId = parts[2];
    const role = guild.roles.cache.get(roleId);
    removeRolePermission(guildId, 'admin', roleId);
    return interaction.editReply({ content: `✅ ${role?.name || 'Rôle'} retiré des rôles admin`, embeds: [], components: [] });
  }

  // ==================== 🔧 RÔLES CONFIG ====================
  if (customId === 'config_roles_config') {
    const configRoles = getAllowedRoles(guildId, 'config');
    const embed = new EmbedBuilder()
      .setTitle('🔧 Rôles de Configuration')
      .setDescription('Configure les rôles pouvant accéder à `/config`.\n\n**Par défaut :** Propriétaire du serveur + rôles Administrateur')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Rôles actuels', value: configRoles.map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean).join('\n') || 'Permissions Discord natives 🔧', inline: false });

    const addMenus = buildSelectMenus(roleOptions(guild, 'config__add__'), 'config_rolecfg_add', '➕ Ajouter un rôle config');
    const removeOpts = configRoles.map(id => { const r = guild.roles.cache.get(id); return r ? { label: r.name.slice(0, 100), value: `config__remove__${id}` } : null; }).filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_rolecfg_remove', '➖ Retirer un rôle config');
    return safeUpdate(interaction, { embeds: [embed], components: buildRows([...addMenus, ...removeMenus], 'config_back_main') });
  }

  if (customId.startsWith('config_rolecfg_add_')) {
    await interaction.deferUpdate();
    const parts = interaction.values[0].split('__');
    const roleId = parts[2];
    addRolePermission(guildId, 'config', roleId);
    const role = guild.roles.cache.get(roleId);
    return interaction.editReply({ content: `✅ ${role} peut maintenant utiliser \`/config\``, embeds: [], components: [] });
  }

  if (customId.startsWith('config_rolecfg_remove_')) {
    await interaction.deferUpdate();
    const parts = interaction.values[0].split('__');
    const roleId = parts[2];
    removeRolePermission(guildId, 'config', roleId);
    return interaction.editReply({ content: '✅ Rôle retiré des rôles config', embeds: [], components: [] });
  }

  // ==================== 📣 SALON D'ANNONCE PACKS ====================
  if (customId === 'config_pack_announce') {
    const announceChannelId = getPackAnnounceChannel(guildId);
    const announceChannel = announceChannelId ? guild.channels.cache.get(announceChannelId) : null;

    const embed = new EmbedBuilder()
      .setTitle('📣 Salon d\'annonce packs')
      .setDescription(
        'Configure le salon où les ouvertures de packs seront annoncées **publiquement**.\n\n'
        + 'À chaque ouverture de pack, le bot enverra un message visible par tous avec :\n'
        + '• La mention @joueur\n'
        + '• La carte obtenue et ses stats\n'
        + '• La rareté et le taux de drop\n\n'
        + 'Le joueur reçoit toujours son message **éphémère** en plus.',
      )
      .setColor(PSG_BLUE)
      .addFields({ name: 'Salon actuel', value: announceChannel ? announceChannel.toString() : 'Non configuré ❌ (aucune annonce publique)', inline: false })
      .setFooter({ text: 'Paris Saint-Germain • Configuration', iconURL: PSG_FOOTER_ICON });

    const setMenus = buildSelectMenus(channelOptions(guild, ''), 'config_packannounce_set', '📣 Définir le salon d\'annonce');
    const disableBtn = new ButtonBuilder().setCustomId('config_packannounce_disable').setLabel('🗑️ Désactiver').setStyle(ButtonStyle.Danger);
    return safeUpdate(interaction, { embeds: [embed], components: buildRows(setMenus, 'config_back_main', [disableBtn]) });
  }

  if (customId.startsWith('config_packannounce_set_')) {
    await interaction.deferUpdate();
    const channelId = interaction.values[0];
    setPackAnnounceChannel(guildId, channelId);
    const ch = guild.channels.cache.get(channelId);
    return interaction.editReply({ content: `✅ ${ch} recevra maintenant les annonces d'ouverture de packs`, embeds: [], components: [] });
  }

  if (customId === 'config_packannounce_disable') {
    setPackAnnounceChannel(guildId, null);
    return safeReply(interaction, { content: '✅ Annonces de packs désactivées' });
  }

  // ==================== 📋 SALON DE LOGS ====================
  if (customId === 'config_logs') {
    const config = loadServerConfig(guildId);
    const logsChannel = config?.logs_channel ? guild.channels.cache.get(config.logs_channel) : null;

    const embed = new EmbedBuilder()
      .setTitle('📋 Salon de Logs')
      .setDescription('Configure le salon qui recevra les logs du bot.\n\n**Logs enregistrés :**\n• 📦 Achats de packs\n• 👑 Commandes admin (addcoins, removecoins, setcoins)\n• 🎁 Cartes données (give)\n• ⚡ Victoires mini-jeu\n• 📋 Toutes les commandes utilisées')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Salon actuel', value: logsChannel ? logsChannel.toString() : 'Non configuré ❌', inline: false });

    const setMenus = buildSelectMenus(channelOptions(guild, ''), 'config_logs_set', 'Définir le salon de logs');
    const disableBtn = new ButtonBuilder().setCustomId('config_logs_disable').setLabel('🗑️ Désactiver').setStyle(ButtonStyle.Danger);
    return safeUpdate(interaction, { embeds: [embed], components: buildRows(setMenus, 'config_back_main', [disableBtn]) });
  }

  if (customId.startsWith('config_logs_set_')) {
    await interaction.deferUpdate();
    const channelId = interaction.values[0];
    const config = loadServerConfig(guildId) || {};
    config.logs_channel = channelId;
    saveServerConfig(guildId, config);
    const ch = guild.channels.cache.get(channelId);
    return interaction.editReply({ content: `✅ ${ch} recevra maintenant les logs du bot`, embeds: [], components: [] });
  }

  if (customId === 'config_logs_disable') {
    const config = loadServerConfig(guildId) || {};
    config.logs_channel = null;
    saveServerConfig(guildId, config);
    return safeReply(interaction, { content: '✅ Logs désactivés' });
  }

  // ==================== 🚫 SALONS/CATÉGORIES SANS COINS ====================
  if (customId === 'config_no_coins') {
    const noCoins = getNoCoinsChannels(guildId);
    const noCategories = getNoCoinsCategories ? getNoCoinsCategories(guildId) : [];

    const embed = new EmbedBuilder()
      .setTitle('🚫 Salons/Catégories Sans Coins')
      .setDescription('Configure les salons ou catégories entières où les membres ne gagnent **pas** de coins.')
      .setColor(PSG_BLUE)
      .addFields(
        { name: '📺 Salons sans coins', value: noCoins.map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean).join('\n') || 'Aucun ✅', inline: false },
        { name: '📁 Catégories sans coins', value: noCategories.map(id => { const c = guild.channels.cache.get(id); return c ? `📁 ${c.name}` : null; }).filter(Boolean).join('\n') || 'Aucune ✅', inline: false },
        { name: 'ℹ️ Fonctionnement', value: '• Salons/catégories listés → aucun coin\n• Tous les autres → coins gagnés normalement', inline: false },
      );

    const addChMenus = buildSelectMenus(channelOptions(guild, 'nocoins__add__'), 'config_nocoins_add', '➕ Ajouter salon sans coins');
    const removeChOpts = noCoins.map(id => { const ch = guild.channels.cache.get(id); return ch ? { label: `#${ch.name}`.slice(0, 100), value: `nocoins__remove__${id}` } : null; }).filter(Boolean);
    const removeChMenus = buildSelectMenus(removeChOpts, 'config_nocoins_remove', '➖ Retirer salon sans coins');

    const addCatMenus = buildSelectMenus(categoryOptions(guild, 'nocoincat__add__'), 'config_nocoincat_add', '➕ Ajouter catégorie sans coins');
    const removeCatOpts = noCategories.map(id => { const c = guild.channels.cache.get(id); return c ? { label: `📁 ${c.name}`.slice(0, 100), value: `nocoincat__remove__${id}` } : null; }).filter(Boolean);
    const removeCatMenus = buildSelectMenus(removeCatOpts, 'config_nocoincat_remove', '➖ Retirer catégorie sans coins');

    const allMenus = [...addChMenus, ...removeChMenus, ...addCatMenus, ...removeCatMenus];
    return safeUpdate(interaction, { embeds: [embed], components: buildRows(allMenus, 'config_back_main') });
  }

  if (customId.startsWith('config_nocoins_add_')) {
    await interaction.deferUpdate();
    const channelId = interaction.values[0].replace('nocoins__add__', '');
    addNoCoinsChannel(guildId, channelId);
    const ch = guild.channels.cache.get(channelId);
    return interaction.editReply({ content: `✅ ${ch} ajouté à la liste sans coins`, embeds: [], components: [] });
  }

  if (customId.startsWith('config_nocoins_remove_')) {
    await interaction.deferUpdate();
    const channelId = interaction.values[0].replace('nocoins__remove__', '');
    removeNoCoinsChannel(guildId, channelId);
    return interaction.editReply({ content: '✅ Salon retiré de la liste sans coins', embeds: [], components: [] });
  }

  if (customId.startsWith('config_nocoincat_add_')) {
    await interaction.deferUpdate();
    const catId = interaction.values[0].replace('nocoincat__add__', '');
    addNoCoinCategory(guildId, catId);
    const cat = guild.channels.cache.get(catId);
    return interaction.editReply({ content: `✅ Catégorie **${cat?.name || catId}** ajoutée — tous ses salons sont sans coins`, embeds: [], components: [] });
  }

  if (customId.startsWith('config_nocoincat_remove_')) {
    await interaction.deferUpdate();
    const catId = interaction.values[0].replace('nocoincat__remove__', '');
    removeNoCoinCategory(guildId, catId);
    return interaction.editReply({ content: '✅ Catégorie retirée de la liste sans coins', embeds: [], components: [] });
  }

  // ==================== 📊 VUE CONFIGURATION COMPLÈTE ====================
  if (customId === 'config_view_full') {
    const config = loadServerConfig(guildId);
    const embed = new EmbedBuilder()
      .setTitle(`📊 Configuration Complète — ${guild.name}`)
      .setColor(PSG_BLUE)
      .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

    const rooms = getGamingRoomMessages(guildId);
    const roomList = rooms.map(r => { const ch = guild.channels.cache.get(r.channelId); return ch ? ch.toString() : null; }).filter(Boolean);
    embed.addFields({ name: '🕹️ Gaming Room', value: roomList.length ? roomList.join('\n') : 'Non configuré ❌', inline: false });

    // FIX: Utilise getAllowedChannels pour cohérence
    const collectionChannels = getAllowedChannels(guildId, 'collection');
    const collList = collectionChannels.map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({ name: '🗂️ Salon /collection', value: collList.length ? collList.join('\n') : 'Partout ✅', inline: true });

    const mgChannelId = getMinigameChannel(guildId);
    const mgChannel = mgChannelId ? guild.channels.cache.get(mgChannelId) : null;
    embed.addFields({ name: '⚡ Mini-jeu', value: mgChannel ? mgChannel.toString() : 'Non configuré ❌', inline: true });

    const adminRoles = getAllowedRoles(guildId, 'admin').map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({ name: '👑 Rôles Admin', value: adminRoles.length ? adminRoles.slice(0, 5).join('\n') + (adminRoles.length > 5 ? `\n+${adminRoles.length - 5} autres` : '') : 'Permissions Discord 🔧', inline: false });

    const configRoles = getAllowedRoles(guildId, 'config').map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({ name: '🔧 Rôles Config', value: configRoles.length ? configRoles.slice(0, 5).join('\n') + (configRoles.length > 5 ? `\n+${configRoles.length - 5} autres` : '') : 'Permissions Discord 🔧', inline: false });

    const logsChannel = config?.logs_channel ? guild.channels.cache.get(config.logs_channel) : null;
    embed.addFields({ name: '📋 Logs', value: logsChannel ? logsChannel.toString() : 'Non configuré ❌', inline: true });

    const announceChannelId = getPackAnnounceChannel(guildId);
    const announceChannel = announceChannelId ? guild.channels.cache.get(announceChannelId) : null;
    embed.addFields({ name: '📣 Annonce packs', value: announceChannel ? announceChannel.toString() : 'Non configuré ❌', inline: true });

    const noCoins = getNoCoinsChannels(guildId).map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({ name: '🚫 Salons Sans Coins', value: noCoins.length ? noCoins.slice(0, 5).join('\n') + (noCoins.length > 5 ? `\n+${noCoins.length - 5} autres` : '') : 'Aucun ✅', inline: true });

    const noCats = (getNoCoinsCategories ? getNoCoinsCategories(guildId) : []).map(id => { const c = guild.channels.cache.get(id); return c ? `📁 ${c.name}` : null; }).filter(Boolean);
    embed.addFields({ name: '📁 Catégories Sans Coins', value: noCats.length ? noCats.slice(0, 5).join('\n') + (noCats.length > 5 ? `\n+${noCats.length - 5} autres` : '') : 'Aucune ✅', inline: true });

    return safeUpdate(interaction, { embeds: [embed], components: createMainComponents() });
  }
}

module.exports = { configCommand, handleConfigInteraction };