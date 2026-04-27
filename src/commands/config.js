// src/commands/config.js - Panneau de configuration interactif
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelType, MessageFlags,
} = require('discord.js');
const {
  loadServerConfig, saveServerConfig,
  addRolePermission, removeRolePermission, getAllowedRoles,
  getNoCoinsChannels, addNoCoinsChannel, removeNoCoinsChannel,
  getNoCoinsCategories, addNoCoinCategory, removeNoCoinCategory,
  checkConfigPermission,
} = require('../utils/permissions');
const {
  getMinigameChannel, setMinigameChannel, getNextMinigameTime,
  getGamingRoomMessages, addGamingRoomMessage, removeGamingRoomMessage,
  getPackAnnounceChannel, setPackAnnounceChannel,
  getEncounterConfig, setEncounterConfig,
  formatIntervalMs,
} = require('../utils/database');
const { sendGamingRoomEmbed } = require('./gaming_room');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON, MINIGAME_CONFIG } = require('../config/settings');

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function buildSelectMenus(items, baseId, placeholder, chunkSize = 25) {
  if (!items.length) return [];
  const menus = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk      = items.slice(i, i + chunkSize);
    const pageNum    = Math.floor(i / chunkSize) + 1;
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
      label:       `#${c.name}`.slice(0, 100),
      value:       `${valuePrefix}${c.id}`,
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

function buildRows(selectMenus, backId, extraButtons = []) {
  const rows = selectMenus.slice(0, 4).map(m => new ActionRowBuilder().addComponents(m));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(backId).setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
    ...extraButtons,
  ));
  return rows;
}

// ─── Embeds principaux ────────────────────────────────────────────────────────

function createMainEmbed(interaction) {
  return new EmbedBuilder()
    .setTitle('⚙️ Configuration du Bot PSG')
    .setDescription(`Bienvenue dans le panneau de configuration pour **${interaction.guild.name}**\n\nChoisis une catégorie :`)
    .setColor(PSG_BLUE)
    .addFields(
      { name: '🕹️ Gaming Room',              value: "Définis les salons où l'embed principal sera envoyé (Boosters, Collection)",                   inline: false },
      { name: '⚡ PSG Encounter',             value: "Définis le salon, l'intervalle et la fourchette horaire des Encounters",                       inline: false },
      { name: '👑 Rôles Administrateurs',     value: 'Définis quels rôles peuvent utiliser `/addcoins`, `/removecoins`, `/setcoins`, `/give`',       inline: false },
      { name: '🔧 Rôles de Configuration',    value: 'Définis quels rôles peuvent accéder à `/config`',                                             inline: false },
      { name: "📣 Salon d'annonce packs",     value: 'Définis le salon où les ouvertures de packs/encounters/gives seront annoncées publiquement',   inline: false },
      { name: '📋 Salon de Logs',             value: 'Définis où le bot enverra ses logs (achats packs, commandes admin, give, mini-jeu)',            inline: false },
      { name: '🚫 Salons/Catégories Sans Coins', value: 'Définis les salons ou catégories où les membres ne gagnent pas de coins',                  inline: false },
    )
    .setFooter({ text: 'Paris Saint-Germain • Configuration', iconURL: PSG_FOOTER_ICON });
}

function createMainComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config_gaming_room').setLabel('🕹️ Gaming Room').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_encounter').setLabel('⚡ PSG Encounter').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_roles').setLabel('👑 Rôles Admins').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_roles_config').setLabel('🔧 Rôles Config').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('config_pack_announce').setLabel('📣 Annonce packs').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_logs').setLabel('📋 Salon de Logs').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_no_coins').setLabel('🚫 Sans Coins').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('config_view_full').setLabel('📊 Voir Config').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('config_close').setLabel('❌ Fermer').setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ─── Commande principale ──────────────────────────────────────────────────────

async function configCommand(interaction) {
  if (!checkConfigPermission(interaction)) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Accès refusé')
        .setDescription("Tu n'as pas la permission d'accéder à la configuration du bot.\n\n**Permissions requises :**\n• Propriétaire du serveur\n• Rôle avec permission \"Administrateur\"\n• Rôle configuré dans \"Rôles de Configuration\"")
        .setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }
  return interaction.reply({ embeds: [createMainEmbed(interaction)], components: createMainComponents(), flags: MessageFlags.Ephemeral });
}

// ─── Helpers interaction ──────────────────────────────────────────────────────

async function safeUpdate(interaction, data) {
  try {
    if (interaction.isButton()) return await interaction.update(data);
    await interaction.deferUpdate();
    return await interaction.editReply(data);
  } catch (e) { console.error('⚠️ safeUpdate error:', e.message); }
}

async function safeReply(interaction, data) {
  try {
    if (interaction.deferred) return await interaction.editReply(data);
    return await interaction.reply({ ...data, flags: MessageFlags.Ephemeral });
  } catch (e) { console.error('⚠️ safeReply error:', e.message); }
}

// ─── Handler principal ────────────────────────────────────────────────────────

async function handleConfigInteraction(interaction) {
  const guildId  = interaction.guildId;
  const guild    = interaction.guild;
  const customId = interaction.customId;

  if (customId === 'config_back_main') return safeUpdate(interaction, { embeds: [createMainEmbed(interaction)], components: createMainComponents() });
  if (customId === 'config_close')     return safeUpdate(interaction, { embeds: [new EmbedBuilder().setTitle('✅ Configuration terminée').setDescription('Tu peux utiliser `/config` à tout moment.').setColor(PSG_BLUE)], components: [] });

  // ==================== 🕹️ GAMING ROOM ====================
  if (customId === 'config_gaming_room') {
    const rooms    = getGamingRoomMessages(guildId);
    const roomList = rooms.map(r => { const ch = guild.channels.cache.get(r.channelId); return ch ? ch.toString() : null; }).filter(Boolean);

    const embed = new EmbedBuilder()
      .setTitle('🕹️ Gaming Room')
      .setDescription(
        "L'embed Gaming Room contient les boutons **Boosters** et **Collection**.\n"
        + "Sélectionne un salon pour y envoyer l'embed, ou retire un salon existant.\n\n"
        + `**Salons actifs :** ${roomList.length ? roomList.join(', ') : 'Aucun ❌'}`,
      )
      .setColor(PSG_BLUE)
      .setFooter({ text: 'Tu peux avoir plusieurs salons Gaming Room simultanément', iconURL: PSG_FOOTER_ICON });

    const addMenus    = buildSelectMenus(channelOptions(guild, 'gr__add__'),    'config_gr_add',    "➕ Envoyer l'embed dans un salon");
    const removeOpts  = rooms
      .map(r => { const ch = guild.channels.cache.get(r.channelId); return ch ? { label: `#${ch.name}`.slice(0, 100), value: `gr__remove__${r.channelId}`, description: 'Retirer cet embed' } : null; })
      .filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_gr_remove', '➖ Retirer un salon Gaming Room');

    return safeUpdate(interaction, { embeds: [embed], components: buildRows([...addMenus, ...removeMenus], 'config_back_main') });
  }

  if (customId.startsWith('config_gr_add_')) {
    const channelId = interaction.values[0].replace('gr__add__', '');
    const channel   = guild.channels.cache.get(channelId);
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

  if (customId.startsWith('config_gr_remove_')) {
    const channelId = interaction.values[0].replace('gr__remove__', '');
    const rooms     = getGamingRoomMessages(guildId);
    const room      = rooms.find(r => r.channelId === channelId);
    if (room) {
      try {
        const ch = guild.channels.cache.get(channelId);
        if (ch) { const msg = await ch.messages.fetch(room.messageId).catch(() => null); if (msg) await msg.delete().catch(() => {}); }
      } catch { /* ok */ }
      removeGamingRoomMessage(guildId, channelId);
    }
    const ch = guild.channels.cache.get(channelId);
    return safeReply(interaction, { content: `✅ Gaming Room retiré${ch ? ` de ${ch}` : ''}` });
  }

  // ==================== ⚡ PSG ENCOUNTER ====================
  if (customId === 'config_encounter') {
    const currentChannelId = getMinigameChannel(guildId);
    const currentChannel   = currentChannelId ? guild.channels.cache.get(currentChannelId) : null;
    const nextTime         = currentChannelId ? getNextMinigameTime(guildId) : null;
    const { interval_ms, start_hour, end_hour } = getEncounterConfig(guildId);

    const embed = new EmbedBuilder()
      .setTitle('⚡ PSG Encounter')
      .setDescription(
        '**PSG Encounter** est un événement automatique avec une carte à gagner via un quiz !\n\n'
        + `📅 **Intervalle :** **${formatIntervalMs(interval_ms)}** après chaque Encounter\n`
        + `🕐 **Fourchette horaire :** entre **${String(start_hour).padStart(2, '0')}h00** et **${String(end_hour).padStart(2, '0')}h00** (heure tirée aléatoirement)\n`
        + `⏱️ **Temps de réponse :** ${MINIGAME_CONFIG.timeout} secondes\n\n`
        + `**Salon actuel :** ${currentChannel ? currentChannel.toString() : 'Aucun ❌'}\n`
        + (nextTime ? `**Prochain Encounter :** <t:${Math.floor(nextTime.getTime() / 1000)}:F> (<t:${Math.floor(nextTime.getTime() / 1000)}:R>)` : ''),
      )
      .setColor(0xFFD700)
      .setFooter({ text: '⚠️ 1 seul salon Encounter par serveur • Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

    const setMenus     = buildSelectMenus(channelOptions(guild, 'encounter__set__'), 'config_encounter_set', '📍 Définir/changer le salon Encounter');
    const extraButtons = [
      new ButtonBuilder().setCustomId('config_encounter_settings').setLabel('⚙️ Intervalle & Horaires').setStyle(ButtonStyle.Primary),
    ];
    if (currentChannelId) {
      extraButtons.push(new ButtonBuilder().setCustomId('config_encounter_remove').setLabel('🗑️ Retirer le salon').setStyle(ButtonStyle.Danger));
    }
    return safeUpdate(interaction, { embeds: [embed], components: buildRows(setMenus, 'config_back_main', extraButtons) });
  }

  if (customId.startsWith('config_encounter_set_')) {
    await interaction.deferUpdate();
    const channelId = interaction.values[0].replace('encounter__set__', '');
    setMinigameChannel(guildId, channelId);
    const ch       = guild.channels.cache.get(channelId);
    const nextTime = getNextMinigameTime(guildId);
    return interaction.editReply({
      content:    `✅ Salon Encounter défini sur ${ch} !\n\n⏰ **Prochain Encounter :** <t:${Math.floor(nextTime.getTime() / 1000)}:F> (<t:${Math.floor(nextTime.getTime() / 1000)}:R>)`,
      embeds:     [],
      components: [],
    });
  }

  if (customId === 'config_encounter_remove') {
    setMinigameChannel(guildId, null);
    return safeReply(interaction, { content: '✅ Salon Encounter retiré. Aucun Encounter ne sera spawné.' });
  }

  // ── Sous-panneau : intervalle + fourchette horaire (select menus, sans modal) ──
  if (customId === 'config_encounter_settings') {
    const { interval_ms, start_hour, end_hour } = getEncounterConfig(guildId);

    const INTERVALS = [
      { label: '5 minutes',  value: 'enc_int__300000' },
      { label: '15 minutes', value: 'enc_int__900000' },
      { label: '30 minutes', value: 'enc_int__1800000' },
      { label: '1 heure',    value: 'enc_int__3600000' },
      { label: '2 heures',   value: 'enc_int__7200000' },
      { label: '4 heures',   value: 'enc_int__14400000' },
      { label: '6 heures',   value: 'enc_int__21600000' },
      { label: '12 heures',  value: 'enc_int__43200000' },
      { label: '1 jour',     value: 'enc_int__86400000' },
      { label: '2 jours',    value: 'enc_int__172800000' },
      { label: '3 jours',    value: 'enc_int__259200000' },
      { label: '7 jours',    value: 'enc_int__604800000' },
    ].map(o => ({ ...o, default: String(interval_ms) === o.value.replace('enc_int__', '') }));

    const START_HOURS = Array.from({ length: 23 }, (_, i) => ({
      label:   `Début : ${String(i).padStart(2, '0')}h00`,
      value:   `enc_start__${i}`,
      default: start_hour === i,
    }));

    const END_HOURS = Array.from({ length: 23 }, (_, i) => ({
      label:   `Fin : ${String(i + 1).padStart(2, '0')}h00`,
      value:   `enc_end__${i + 1}`,
      default: end_hour === i + 1,
    }));

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Intervalle & Horaires des Encounters')
      .setDescription(
        `Paramètres actuels :\n\n`
        + `📅 **Intervalle :** ${formatIntervalMs(interval_ms)}\n`
        + `🕐 **Fourchette :** ${String(start_hour).padStart(2, '0')}h00 → ${String(end_hour).padStart(2, '0')}h00\n\n`
        + `Sélectionne les nouvelles valeurs ci-dessous.\nChaque menu applique immédiatement le changement.`,
      )
      .setColor(0xFFD700)
      .setFooter({ text: 'Paris Saint-Germain • Encounter Settings', iconURL: PSG_FOOTER_ICON });

    const rows = [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('config_enc_interval_0')
          .setPlaceholder('📅 Choisir l\'intervalle entre chaque Encounter')
          .addOptions(INTERVALS),
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('config_enc_start_0')
          .setPlaceholder('🕐 Heure de début de la fourchette')
          .addOptions(START_HOURS),
      ),
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('config_enc_end_0')
          .setPlaceholder('🕑 Heure de fin de la fourchette')
          .addOptions(END_HOURS),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('config_encounter').setLabel('⬅️ Retour').setStyle(ButtonStyle.Secondary),
      ),
    ];

    return safeUpdate(interaction, { embeds: [embed], components: rows });
  }

  // ── Application immédiate des valeurs sélectionnées ───────────────────────
  if (customId.startsWith('config_enc_interval_')) {
    await interaction.deferUpdate();
    const newMs = parseInt(interaction.values[0].replace('enc_int__', ''), 10);
    const { start_hour, end_hour } = getEncounterConfig(guildId);
    setEncounterConfig(guildId, { interval_ms: newMs, start_hour, end_hour });
    const nextTime = getNextMinigameTime(guildId);
    return interaction.editReply({
      content: `✅ **Intervalle mis à jour : ${formatIntervalMs(newMs)}**\n⏰ Prochain Encounter : <t:${Math.floor(nextTime.getTime() / 1000)}:F> (<t:${Math.floor(nextTime.getTime() / 1000)}:R>)`,
      embeds: [], components: [],
    });
  }

  if (customId.startsWith('config_enc_start_')) {
    await interaction.deferUpdate();
    const newStart = parseInt(interaction.values[0].replace('enc_start__', ''), 10);
    const { interval_ms, end_hour } = getEncounterConfig(guildId);
    if (newStart >= end_hour) {
      return interaction.editReply({ content: `❌ L'heure de début (**${newStart}h**) doit être inférieure à l'heure de fin (**${end_hour}h**).`, embeds: [], components: [] });
    }
    setEncounterConfig(guildId, { interval_ms, start_hour: newStart, end_hour });
    const nextTime = getNextMinigameTime(guildId);
    return interaction.editReply({
      content: `✅ **Heure de début mise à jour : ${String(newStart).padStart(2, '0')}h00**\n⏰ Prochain Encounter : <t:${Math.floor(nextTime.getTime() / 1000)}:F> (<t:${Math.floor(nextTime.getTime() / 1000)}:R>)`,
      embeds: [], components: [],
    });
  }

  if (customId.startsWith('config_enc_end_')) {
    await interaction.deferUpdate();
    const newEnd = parseInt(interaction.values[0].replace('enc_end__', ''), 10);
    const { interval_ms, start_hour } = getEncounterConfig(guildId);
    if (newEnd <= start_hour) {
      return interaction.editReply({ content: `❌ L'heure de fin (**${newEnd}h**) doit être supérieure à l'heure de début (**${start_hour}h**).`, embeds: [], components: [] });
    }
    setEncounterConfig(guildId, { interval_ms, start_hour, end_hour: newEnd });
    const nextTime = getNextMinigameTime(guildId);
    return interaction.editReply({
      content: `✅ **Heure de fin mise à jour : ${String(newEnd).padStart(2, '0')}h00**\n⏰ Prochain Encounter : <t:${Math.floor(nextTime.getTime() / 1000)}:F> (<t:${Math.floor(nextTime.getTime() / 1000)}:R>)`,
      embeds: [], components: [],
    });
  }

  // ==================== 👑 RÔLES ADMIN ====================
  if (customId === 'config_roles') {
    const adminRoles = getAllowedRoles(guildId, 'admin');
    const embed = new EmbedBuilder()
      .setTitle('👑 Rôles Administrateurs')
      .setDescription('Configure les rôles pouvant utiliser `/addcoins`, `/removecoins`, `/setcoins`, `/give`.')
      .setColor(PSG_BLUE)
      .addFields({
        name:   'Rôles actuels',
        value:  adminRoles.map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean).join('\n') || 'Permissions Discord natives 🔧',
        inline: false,
      });

    const addMenus    = buildSelectMenus(roleOptions(guild, 'admin__add__'),    'config_role_add',    '➕ Ajouter un rôle admin');
    const removeOpts  = adminRoles.map(id => { const r = guild.roles.cache.get(id); return r ? { label: r.name.slice(0, 100), value: `admin__remove__${id}` } : null; }).filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_role_remove', '➖ Retirer un rôle admin');

    return safeUpdate(interaction, { embeds: [embed], components: buildRows([...addMenus, ...removeMenus], 'config_back_main') });
  }

  if (customId.startsWith('config_role_add_')) {
    await interaction.deferUpdate();
    const roleId = interaction.values[0].split('__')[2];
    addRolePermission(guildId, 'admin', roleId);
    return interaction.editReply({ content: `✅ ${guild.roles.cache.get(roleId)} peut maintenant utiliser les commandes admin`, embeds: [], components: [] });
  }
  if (customId.startsWith('config_role_remove_')) {
    await interaction.deferUpdate();
    const roleId = interaction.values[0].split('__')[2];
    removeRolePermission(guildId, 'admin', roleId);
    return interaction.editReply({ content: '✅ Rôle retiré des rôles admin', embeds: [], components: [] });
  }

  // ==================== 🔧 RÔLES CONFIG ====================
  if (customId === 'config_roles_config') {
    const configRoles = getAllowedRoles(guildId, 'config');
    const embed = new EmbedBuilder()
      .setTitle('🔧 Rôles de Configuration')
      .setDescription('Configure les rôles pouvant accéder à `/config`.\n\n**Par défaut :** Propriétaire du serveur + rôles Administrateur')
      .setColor(PSG_BLUE)
      .addFields({
        name:   'Rôles actuels',
        value:  configRoles.map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean).join('\n') || 'Permissions Discord natives 🔧',
        inline: false,
      });

    const addMenus    = buildSelectMenus(roleOptions(guild, 'config__add__'),    'config_rolecfg_add',    '➕ Ajouter un rôle config');
    const removeOpts  = configRoles.map(id => { const r = guild.roles.cache.get(id); return r ? { label: r.name.slice(0, 100), value: `config__remove__${id}` } : null; }).filter(Boolean);
    const removeMenus = buildSelectMenus(removeOpts, 'config_rolecfg_remove', '➖ Retirer un rôle config');

    return safeUpdate(interaction, { embeds: [embed], components: buildRows([...addMenus, ...removeMenus], 'config_back_main') });
  }

  if (customId.startsWith('config_rolecfg_add_')) {
    await interaction.deferUpdate();
    const roleId = interaction.values[0].split('__')[2];
    addRolePermission(guildId, 'config', roleId);
    return interaction.editReply({ content: `✅ ${guild.roles.cache.get(roleId)} peut maintenant utiliser \`/config\``, embeds: [], components: [] });
  }
  if (customId.startsWith('config_rolecfg_remove_')) {
    await interaction.deferUpdate();
    const roleId = interaction.values[0].split('__')[2];
    removeRolePermission(guildId, 'config', roleId);
    return interaction.editReply({ content: '✅ Rôle retiré des rôles config', embeds: [], components: [] });
  }

  // ==================== 📣 SALON D'ANNONCE PACKS ====================
  if (customId === 'config_pack_announce') {
    const announceChannelId = getPackAnnounceChannel(guildId);
    const announceChannel   = announceChannelId ? guild.channels.cache.get(announceChannelId) : null;

    const embed = new EmbedBuilder()
      .setTitle("📣 Salon d'annonce packs")
      .setDescription('Configure le salon où les ouvertures de packs seront annoncées **publiquement**.\n\nÀ chaque ouverture de pack, give ou victoire Encounter, le bot enverra un message visible par tous.')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Salon actuel', value: announceChannel ? announceChannel.toString() : 'Non configuré ❌ (aucune annonce publique)', inline: false })
      .setFooter({ text: 'Paris Saint-Germain • Configuration', iconURL: PSG_FOOTER_ICON });

    const setMenus   = buildSelectMenus(channelOptions(guild, 'announce__set__'), 'config_packannounce_set', "📣 Définir le salon d'annonce");
    const disableBtn = new ButtonBuilder().setCustomId('config_packannounce_disable').setLabel('🗑️ Désactiver').setStyle(ButtonStyle.Danger);

    return safeUpdate(interaction, { embeds: [embed], components: buildRows(setMenus, 'config_back_main', [disableBtn]) });
  }

  if (customId.startsWith('config_packannounce_set_')) {
    await interaction.deferUpdate();
    const channelId = interaction.values[0].replace('announce__set__', '');
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
    const config      = loadServerConfig(guildId);
    const logsChannel = config?.logs_channel ? guild.channels.cache.get(config.logs_channel) : null;

    const embed = new EmbedBuilder()
      .setTitle('📋 Salon de Logs')
      .setDescription('Configure le salon qui recevra les logs du bot.\n\n**Logs enregistrés :**\n• 📦 Achats de packs\n• 👑 Commandes admin (addcoins, removecoins, setcoins)\n• 🎁 Cartes données (give)\n• ⚡ Victoires Encounter\n• 📋 Toutes les commandes utilisées')
      .setColor(PSG_BLUE)
      .addFields({ name: 'Salon actuel', value: logsChannel ? logsChannel.toString() : 'Non configuré ❌', inline: false });

    const setMenus   = buildSelectMenus(channelOptions(guild, 'logs__set__'), 'config_logs_set', 'Définir le salon de logs');
    const disableBtn = new ButtonBuilder().setCustomId('config_logs_disable').setLabel('🗑️ Désactiver').setStyle(ButtonStyle.Danger);

    return safeUpdate(interaction, { embeds: [embed], components: buildRows(setMenus, 'config_back_main', [disableBtn]) });
  }

  if (customId.startsWith('config_logs_set_')) {
    await interaction.deferUpdate();
    const channelId = interaction.values[0].replace('logs__set__', '');
    const config    = loadServerConfig(guildId) || {};
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
    const noCoins      = getNoCoinsChannels(guildId);
    const noCategories = getNoCoinsCategories ? getNoCoinsCategories(guildId) : [];

    const embed = new EmbedBuilder()
      .setTitle('🚫 Salons/Catégories Sans Coins')
      .setDescription('Configure les salons ou catégories entières où les membres ne gagnent **pas** de coins.')
      .setColor(PSG_BLUE)
      .addFields(
        { name: '📺 Salons sans coins',     value: noCoins.map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean).join('\n') || 'Aucun ✅',                                     inline: false },
        { name: '📁 Catégories sans coins', value: noCategories.map(id => { const c = guild.channels.cache.get(id); return c ? `📁 ${c.name}` : null; }).filter(Boolean).join('\n') || 'Aucune ✅', inline: false },
        { name: 'ℹ️ Fonctionnement',        value: '• Salons/catégories listés → aucun coin\n• Tous les autres → coins gagnés normalement',                                                  inline: false },
      );

    const allMenus = [
      ...buildSelectMenus(channelOptions(guild,  'nocoins__add__'),    'config_nocoins_add',      '➕ Ajouter salon sans coins'),
      ...buildSelectMenus(
        noCoins.map(id => { const ch = guild.channels.cache.get(id); return ch ? { label: `#${ch.name}`.slice(0, 100), value: `nocoins__remove__${id}` } : null; }).filter(Boolean),
        'config_nocoins_remove', '➖ Retirer salon',
      ),
      ...buildSelectMenus(categoryOptions(guild, 'nocoincat__add__'),  'config_nocoincat_add',    '➕ Ajouter catégorie sans coins'),
      ...buildSelectMenus(
        noCategories.map(id => { const c = guild.channels.cache.get(id); return c ? { label: `📁 ${c.name}`.slice(0, 100), value: `nocoincat__remove__${id}` } : null; }).filter(Boolean),
        'config_nocoincat_remove', '➖ Retirer catégorie',
      ),
    ];

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
    const embed  = new EmbedBuilder()
      .setTitle(`📊 Configuration Complète — ${guild.name}`)
      .setColor(PSG_BLUE)
      .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

    // Gaming Room
    const rooms = getGamingRoomMessages(guildId);
    embed.addFields({
      name:   '🕹️ Gaming Room',
      value:  rooms.map(r => guild.channels.cache.get(r.channelId)?.toString()).filter(Boolean).join('\n') || 'Non configuré ❌',
      inline: false,
    });

    // Encounter
    const encId   = getMinigameChannel(guildId);
    const encCh   = encId ? guild.channels.cache.get(encId) : null;
    const encNext = encId ? getNextMinigameTime(guildId) : null;
    const { interval_ms, start_hour, end_hour } = getEncounterConfig(guildId);
    embed.addFields({
      name:   '⚡ Encounter',
      value:  encCh
        ? `${encCh}\nProchain : <t:${Math.floor(encNext.getTime() / 1000)}:R>\nIntervalle : ${formatIntervalMs(interval_ms)} | Horaires : ${String(start_hour).padStart(2, '0')}h–${String(end_hour).padStart(2, '0')}h`
        : 'Non configuré ❌',
      inline: false,
    });

    // Rôles admin
    const adminRoles = getAllowedRoles(guildId, 'admin').map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({
      name:   '👑 Rôles Admin',
      value:  adminRoles.length ? adminRoles.slice(0, 5).join('\n') + (adminRoles.length > 5 ? `\n+${adminRoles.length - 5} autres` : '') : 'Permissions Discord 🔧',
      inline: false,
    });

    // Rôles config
    const configRoles = getAllowedRoles(guildId, 'config').map(id => guild.roles.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({
      name:   '🔧 Rôles Config',
      value:  configRoles.length ? configRoles.slice(0, 5).join('\n') + (configRoles.length > 5 ? `\n+${configRoles.length - 5} autres` : '') : 'Permissions Discord 🔧',
      inline: false,
    });

    // Logs
    const logsCh = config?.logs_channel ? guild.channels.cache.get(config.logs_channel) : null;
    embed.addFields({ name: '📋 Logs', value: logsCh ? logsCh.toString() : 'Non configuré ❌', inline: true });

    // Annonce packs
    const announceChannelId = getPackAnnounceChannel(guildId);
    const announceChannel   = announceChannelId ? guild.channels.cache.get(announceChannelId) : null;
    embed.addFields({ name: '📣 Annonce packs', value: announceChannel ? announceChannel.toString() : 'Non configuré ❌', inline: true });

    // Sans coins (salons)
    const noCoins = getNoCoinsChannels(guildId).map(id => guild.channels.cache.get(id)?.toString()).filter(Boolean);
    embed.addFields({
      name:   '🚫 Sans Coins',
      value:  noCoins.length ? noCoins.slice(0, 5).join('\n') + (noCoins.length > 5 ? `\n+${noCoins.length - 5} autres` : '') : 'Aucun ✅',
      inline: true,
    });

    // Sans coins (catégories)
    const noCats = (getNoCoinsCategories ? getNoCoinsCategories(guildId) : [])
      .map(id => { const c = guild.channels.cache.get(id); return c ? `📁 ${c.name}` : null; }).filter(Boolean);
    embed.addFields({
      name:   '📁 Catégories Sans Coins',
      value:  noCats.length ? noCats.slice(0, 5).join('\n') + (noCats.length > 5 ? `\n+${noCats.length - 5} autres` : '') : 'Aucune ✅',
      inline: true,
    });

    return safeUpdate(interaction, { embeds: [embed], components: createMainComponents() });
  }
}

module.exports = { configCommand, handleConfigInteraction };