// src/commands/admin.js - Commandes admin (addcoins, removecoins, setcoins, removecard)
const { EmbedBuilder, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserData, saveUserData, getUserCardsGrouped } = require('../utils/database');
const { checkRolePermission } = require('../utils/permissions');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON, CARD_TYPES } = require('../config/settings');
const { logAdminCoins } = require('../utils/logs');
const { getRarityEmoji } = require('../utils/cardHelpers');

const PSG_LOGO = PSG_FOOTER_ICON;

function buildFooter(guild) {
  return { text: `Paris Saint-Germain • ${guild.name}`, iconURL: PSG_LOGO };
}

// ─── Sessions de suppression (paginées) ───────────────────────────────────────
const removeCardSessions = new Map();
const CARDS_PER_PAGE = 25;

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of removeCardSessions.entries()) {
    if (now > session.expireAt) removeCardSessions.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Helpers removecard ───────────────────────────────────────────────────────

function buildRemoveCardEmbed(targetName, currentPage, totalPages, totalCards) {
  return new EmbedBuilder()
    .setTitle(`🗑️ Retirer une carte — ${targetName}`)
    .setDescription(
      `**${totalCards} carte(s)** dans la collection.\n`
      + `Page **${currentPage + 1}/${totalPages}** — Sélectionne la carte à supprimer.`,
    )
    .setColor(PSG_RED)
    .setFooter({ text: `Paris Saint-Germain • Session expire dans 15 min`, iconURL: PSG_LOGO });
}

function buildRemoveCardComponents(session, adminId) {
  const { pages, currentPage } = session;
  const pageCards  = pages[currentPage];
  const totalPages = pages.length;

  const rows = [];

  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`admin_removecard_select_${adminId}`)
      .setPlaceholder('🎴 Sélectionne une carte à supprimer...')
      .addOptions(pageCards.map(([collectionIndex, card]) => ({
        label:       `${card.nom} (${card.rareté})`.slice(0, 100),
        description: `${CARD_TYPES[card.type]?.emoji || '🎴'} ${card.type} — Index #${collectionIndex}`.slice(0, 100),
        value:       String(collectionIndex),
        emoji:       getRarityEmoji(card.rareté),
      }))),
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`admin_removecard_prev_${adminId}`)
      .setLabel('◀️ Précédent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId(`admin_removecard_next_${adminId}`)
      .setLabel('Suivant ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`admin_removecard_cancel_${adminId}`)
      .setLabel('❌ Annuler')
      .setStyle(ButtonStyle.Danger),
  ));

  return rows;
}

function paginateCollection(collection) {
  const indexed = collection.map((card, index) => [index, card]);
  const pages   = [];
  for (let i = 0; i < indexed.length; i += CARDS_PER_PAGE) {
    pages.push(indexed.slice(i, i + CARDS_PER_PAGE));
  }
  return pages;
}

// ─── COMMANDES COINS ──────────────────────────────────────────────────────────

async function addCoinsCommand(interaction, membre, montant) {
  if (!checkRolePermission(interaction, 'admin')) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('❌ Accès refusé').setDescription("Tu n'as pas les permissions administrateur pour utiliser cette commande.").setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId     = interaction.guildId;
  const userId      = membre.id;
  const userData    = getUserData(guildId, userId);
  const ancienSolde = userData.coins;
  userData.coins   += montant;
  saveUserData(guildId, userId, userData);

  const embed = new EmbedBuilder()
    .setTitle('✅ PSG Coins ajoutés!')
    .setDescription(`Tu as ajouté **${montant} PSG Coins** à ${membre}!`)
    .setColor(PSG_BLUE)
    .addFields(
      { name: '💰 Ancien solde',  value: `${ancienSolde} 🪙`,    inline: true },
      { name: '💎 Nouveau solde', value: `${userData.coins} 🪙`, inline: true },
    )
    .setFooter(buildFooter(interaction.guild));

  await interaction.reply({ embeds: [embed] });
  logAdminCoins(interaction, 'add', membre, montant, ancienSolde, userData.coins).catch(() => {});
}

async function removeCoinsCommand(interaction, membre, montant) {
  if (!checkRolePermission(interaction, 'admin')) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('❌ Accès refusé').setDescription("Tu n'as pas les permissions administrateur pour utiliser cette commande.").setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId     = interaction.guildId;
  const userId      = membre.id;
  const userData    = getUserData(guildId, userId);
  const ancienSolde = userData.coins;

  userData.coins -= montant;
  saveUserData(guildId, userId, userData);

  const embed = new EmbedBuilder()
    .setTitle('✅ PSG Coins retirés!')
    .setDescription(`Tu as retiré **${montant} PSG Coins** à ${membre}!`)
    .setColor(PSG_BLUE)
    .addFields(
      { name: '💰 Ancien solde',  value: `${ancienSolde} 🪙`,    inline: true },
      { name: '💎 Nouveau solde', value: `${userData.coins} 🪙`, inline: true },
    )
    .setFooter(buildFooter(interaction.guild));

  await interaction.reply({ embeds: [embed] });
  logAdminCoins(interaction, 'remove', membre, montant, ancienSolde, userData.coins).catch(() => {});
}

async function setCoinsCommand(interaction, membre, montant) {
  if (!checkRolePermission(interaction, 'admin')) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('❌ Accès refusé').setDescription("Tu n'as pas les permissions administrateur pour utiliser cette commande.").setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId     = interaction.guildId;
  const userId      = membre.id;
  const userData    = getUserData(guildId, userId);
  const ancienSolde = userData.coins;
  userData.coins    = montant;
  saveUserData(guildId, userId, userData);

  const embed = new EmbedBuilder()
    .setTitle('✅ Solde modifié!')
    .setDescription(`Tu as défini le solde de ${membre} à **${montant} PSG Coins** sur ce serveur!`)
    .setColor(PSG_BLUE)
    .addFields(
      { name: '💰 Ancien solde',  value: `${ancienSolde} 🪙`, inline: true },
      { name: '💎 Nouveau solde', value: `${montant} 🪙`,     inline: true },
    )
    .setFooter(buildFooter(interaction.guild));

  await interaction.reply({ embeds: [embed] });
  logAdminCoins(interaction, 'set', membre, montant, ancienSolde, montant).catch(() => {});
}

// ─── REMOVECARD : commande initiale ──────────────────────────────────────────

async function removeCardCommand(interaction, membre) {
  if (!checkRolePermission(interaction, 'admin')) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('❌ Accès refusé').setDescription("Tu n'as pas les permissions administrateur pour utiliser cette commande.").setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (membre.user.bot) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('❌ Erreur').setDescription('Tu ne peux pas retirer de cartes à un bot !').setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId    = interaction.guildId;
  const adminId    = interaction.user.id;
  const userData   = getUserData(guildId, membre.id);
  const collection = userData.collection || [];

  if (!collection.length) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('📭 Collection vide')
        .setDescription(`${membre} n'a aucune carte dans sa collection.`)
        .setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const pages      = paginateCollection(collection);
  const targetName = membre.displayName || membre.user.username;

  removeCardSessions.set(adminId, {
    guildId,
    targetUserId: membre.id,
    targetName,
    pages,
    currentPage: 0,
    expireAt:    Date.now() + 15 * 60 * 1000,
  });

  const embed      = buildRemoveCardEmbed(targetName, 0, pages.length, collection.length);
  const components = buildRemoveCardComponents(removeCardSessions.get(adminId), adminId);

  return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

// ─── REMOVECARD : gestion des interactions (select + pagination) ──────────────

async function handleRemoveCardInteraction(interaction) {
  const customId = interaction.customId;
  const adminId  = customId.split('_').pop();

  if (interaction.user.id !== adminId) {
    return interaction.reply({ content: "❌ Ce n'est pas ta session !", flags: MessageFlags.Ephemeral });
  }

  const session = removeCardSessions.get(adminId);
  if (!session) {
    return interaction.reply({ content: '❌ Session expirée, relance `/removecard`.', flags: MessageFlags.Ephemeral });
  }

  // ── Annulation ────────────────────────────────────────────────────────────
  if (customId.startsWith('admin_removecard_cancel_')) {
    removeCardSessions.delete(adminId);
    return interaction.update({
      embeds: [new EmbedBuilder().setTitle('❌ Annulé').setDescription('Suppression de carte annulée.').setColor(PSG_RED)],
      components: [],
    });
  }

  // ── Pagination ────────────────────────────────────────────────────────────
  if (customId.startsWith('admin_removecard_prev_')) {
    session.currentPage = Math.max(0, session.currentPage - 1);
    const embed = buildRemoveCardEmbed(session.targetName, session.currentPage, session.pages.length, session.pages.flat().length);
    return interaction.update({ embeds: [embed], components: buildRemoveCardComponents(session, adminId) });
  }

  if (customId.startsWith('admin_removecard_next_')) {
    session.currentPage = Math.min(session.pages.length - 1, session.currentPage + 1);
    const embed = buildRemoveCardEmbed(session.targetName, session.currentPage, session.pages.length, session.pages.flat().length);
    return interaction.update({ embeds: [embed], components: buildRemoveCardComponents(session, adminId) });
  }

  // ── Sélection d'une carte ─────────────────────────────────────────────────
  if (customId.startsWith('admin_removecard_select_')) {
    const collectionIndex = parseInt(interaction.values[0], 10);
    const userData        = getUserData(session.guildId, session.targetUserId);
    const collection      = userData.collection || [];
    const card            = collection[collectionIndex];

    if (!card) {
      return interaction.update({
        embeds: [new EmbedBuilder().setTitle('❌ Carte introuvable').setDescription('La carte sélectionnée est introuvable, la collection a peut-être changé.').setColor(PSG_RED)],
        components: [],
      });
    }

    collection.splice(collectionIndex, 1);
    userData.collection = collection;
    saveUserData(session.guildId, session.targetUserId, userData);
    removeCardSessions.delete(adminId);

    return interaction.update({
      embeds: [new EmbedBuilder()
        .setTitle('✅ Carte supprimée !')
        .setDescription(`La carte **${card.nom}** a été retirée de la collection de **${session.targetName}**.`)
        .setColor(PSG_BLUE)
        .addFields(
          { name: '🎴 Carte',               value: card.nom,                                           inline: true },
          { name: '🏆 Rareté',              value: `${getRarityEmoji(card.rareté)} ${card.rareté}`,   inline: true },
          { name: '📦 Collection restante', value: `${userData.collection.length} carte(s)`,           inline: true },
        )
        .setFooter({ text: `Retiré par ${interaction.user.displayName} • Paris Saint-Germain`, iconURL: PSG_LOGO })],
      components: [],
    });
  }
}

module.exports = {
  addCoinsCommand,
  removeCoinsCommand,
  setCoinsCommand,
  removeCardCommand,
  handleRemoveCardInteraction,
};