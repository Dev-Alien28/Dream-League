// src/commands/collection.js - Affichage de la collection avec pagination
const {EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { getUserData, getUserCardsGrouped } = require('../utils/database');
const { checkChannelPermission, getAllowedChannel } = require('../utils/permissions');
const { PSG_BLUE, PSG_RED, CARD_TYPES, PSG_FOOTER_ICON } = require('../config/settings');
const { getRarityColor, getRarityEmoji, getRarityCardImage, formatCardStats } = require('../utils/cardHelpers');
const fs = require('fs');
const path = require('path');

// ✅ Raretés complètes incluant "Légendaire" et "Épique" (comme en Python)
const RARITY_ORDER = {
  Légendaire: 0,
  Legend:     0,
  Unique:     1,
  Épique:     2,
  Elite:      2,
  Advanced:   3,
  Basic:      4,
};

const CARDS_PER_PAGE = 10;

function getRarityOrder(rarity) {
  return RARITY_ORDER[rarity] ?? 999;
}

// ─── Helpers image ────────────────────────────────────────────────────────────

// ✅ __dirname = src/commands/ → '..' remonte à src/ → + imagePath = src/images/cards/Carte_X.png
function getCardImageFile(card) {
  const imagePath = card.image || '';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return null;

  const absolutePath = path.join(__dirname, '..', imagePath);
  if (imagePath && fs.existsSync(absolutePath)) {
    try {
      const filename = path.basename(absolutePath);
      return new AttachmentBuilder(absolutePath, { name: filename });
    } catch (e) {
      console.error(`❌ Erreur lecture image ${absolutePath}:`, e);
      return null;
    }
  }
  return null;
}

function getCardImageUrlLocal(card) {
  const imagePath = card.image || '';
  if (imagePath && (imagePath.startsWith('http://') || imagePath.startsWith('https://'))) {
    if (imagePath.length <= 2048) return imagePath;
  }
  return null;
}

// ─── Organisation des pages ───────────────────────────────────────────────────

function organizeCardsByRarity(cardsGrouped) {
  const byRarity = {};
  for (const [cardId, cardData] of Object.entries(cardsGrouped)) {
    const rarity = cardData.card.rareté;
    if (!byRarity[rarity]) byRarity[rarity] = [];
    byRarity[rarity].push([cardId, cardData]);
  }

  const sortedRarities = Object.keys(byRarity).sort((a, b) => getRarityOrder(a) - getRarityOrder(b));
  const pages = [];

  for (const rarity of sortedRarities) {
    const rarityCards = byRarity[rarity];
    for (let i = 0; i < rarityCards.length; i += CARDS_PER_PAGE) {
      pages.push({ rarity, cards: rarityCards.slice(i, i + CARDS_PER_PAGE), isContinuation: i > 0 });
    }
  }

  return pages;
}

// ─── Embed collection ─────────────────────────────────────────────────────────

function createCollectionEmbed(userName, pageData, currentPage, totalPages, uniqueCards, totalCards) {
  const embed = new EmbedBuilder()
    .setTitle(`📋 Collection de ${userName}`)
    .setDescription(`🎴 Total: ${totalCards} carte(s)\n✨ Cartes uniques: ${uniqueCards}\n📄 Page: ${currentPage}/${totalPages}`)
    .setColor(PSG_BLUE)
    .setFooter({ text: 'Sélectionne une carte pour voir ses détails • Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

  if (!pageData || !pageData.cards?.length) {
    embed.addFields({ name: '🔭 Collection vide', value: 'Achète des packs avec `/packs` pour commencer ta collection !', inline: false });
    return embed;
  }

  const { rarity, cards, isContinuation } = pageData;
  const rarityEmoji = getRarityEmoji(rarity);
  let sectionTitle = `${rarityEmoji}  ${rarity}`;
  if (isContinuation) sectionTitle += ' (suite)';

  const cardLines = cards.map(([, cardData]) => {
    const { card, count } = cardData;
    const typeEmoji = CARD_TYPES[card.type]?.emoji || '🎴';
    return `${typeEmoji} ${card.nom} x${count}`;
  });

  embed.addFields({ name: sectionTitle, value: cardLines.join('\n'), inline: false });
  return embed;
}

// ─── Composants (boutons + select) ───────────────────────────────────────────

function buildCollectionComponents(pages, currentPage, totalPages, cardsGrouped, viewerId) {
  const rows = [];

  const pageData = pages[currentPage];
  if (pageData?.cards?.length) {
    const options = pageData.cards.map(([cardId, cardData]) => {
      const { card, count } = cardData;
      const typeEmoji = CARD_TYPES[card.type]?.emoji || '🎴';
      const label = `${card.nom} x${count}`.slice(0, 100);
      const description = `${typeEmoji} ${card.type?.charAt(0).toUpperCase() + card.type?.slice(1)} - ${card.rareté}`.slice(0, 100);
      return { label, description, value: cardId, emoji: getRarityEmoji(card.rareté) };
    });

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`collection_card_${viewerId}`)
      .setPlaceholder(`🎴 ${pageData.rarity} - Page ${currentPage + 1}/${totalPages}`)
      .addOptions(options);
    rows.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`collection_prev_${viewerId}`).setLabel('◀️ Précédent').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`collection_next_${viewerId}`).setLabel('Suivant ▶️').setStyle(ButtonStyle.Primary).setDisabled(currentPage >= totalPages - 1),
    new ButtonBuilder().setCustomId(`collection_refresh_${viewerId}`).setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
  );
  rows.push(navRow);
  return rows;
}

// ─── Sessions en mémoire ──────────────────────────────────────────────────────

const collectionSessions = new Map();

// ─── Commande /collection ─────────────────────────────────────────────────────

async function collectionCommand(interaction, membre = null) {
  if (!checkChannelPermission(interaction, 'collection')) {
    const allowedChannel = getAllowedChannel(interaction.guildId, 'collection', interaction.client);
    const embed = new EmbedBuilder().setTitle('❌ Salon non autorisé').setColor(PSG_RED);
    if (allowedChannel) {
      embed.setDescription(`Cette commande ne peut pas être utilisée dans ce salon.\n\n➡️ **Utilise plutôt :** ${allowedChannel}`);
    } else {
      embed.setDescription("Cette commande ne peut pas être utilisée dans ce salon.\n\nAucun salon configuré. Contacte un administrateur avec `/config`.");
    }
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guildId;
  const targetUser = membre || interaction.user;
  const userId = targetUser.id;
  const viewerId = interaction.user.id;

  const cardsGrouped = getUserCardsGrouped(guildId, userId);

  if (!Object.keys(cardsGrouped).length) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(`📋 Collection de ${targetUser.displayName}`)
        .setDescription('🔭 Cette collection est vide!\n\nUtilise `/packs` pour commencer ta collection!')
        .setColor(PSG_BLUE)
        .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const pages = organizeCardsByRarity(cardsGrouped);
  const totalUnique = Object.keys(cardsGrouped).length;
  const totalCards = Object.values(cardsGrouped).reduce((s, d) => s + d.count, 0);

  collectionSessions.set(viewerId, {
    guildId,
    userId,
    viewerId,
    userName: targetUser.displayName,
    cardsGrouped,
    pages,
    currentPage: 0,
    totalUnique,
    totalCards,
  });

  const embed = createCollectionEmbed(targetUser.displayName, pages[0], 1, pages.length, totalUnique, totalCards);
  const components = buildCollectionComponents(pages, 0, pages.length, cardsGrouped, viewerId);

  return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

// ─── Gestion des interactions ─────────────────────────────────────────────────

async function handleCollectionInteraction(interaction) {
  const customId = interaction.customId;

  // ── Détail d'une carte ──
  if (customId.startsWith('collection_card_')) {
    const viewerId = customId.split('_')[2];
    if (interaction.user.id !== viewerId) {
      return interaction.reply({ content: "❌ Ce n'est pas ta vue!", flags: MessageFlags.Ephemeral });
    }
    const session = collectionSessions.get(viewerId);
    if (!session) return interaction.reply({ content: '❌ Session expirée.', flags: MessageFlags.Ephemeral });

    const cardId = interaction.values[0];
    const cardData = session.cardsGrouped[cardId];
    if (!cardData) return interaction.reply({ content: '❌ Carte introuvable.', flags: MessageFlags.Ephemeral });

    const { card, count } = cardData;
    const typeEmoji = CARD_TYPES[card.type]?.emoji || '🎴';

    const embed = new EmbedBuilder()
      .setTitle(`🎴 ${card.nom}`)
      .setDescription(`Carte ${card.type} de ${session.userName}`)
      .setColor(getRarityColor(card.rareté))
      .addFields(
        { name: `${typeEmoji} Type`, value: card.type?.charAt(0).toUpperCase() + card.type?.slice(1), inline: true },
        { name: '🏆 Rareté', value: `${getRarityEmoji(card.rareté)} ${card.rareté}`, inline: true },
        { name: '📦 Exemplaires', value: `x${count}`, inline: true },
        { name: '📊 Statistiques', value: formatCardStats(card), inline: false },
      )
      .setFooter({ text: "Paris Saint-Germain • Ici c'est Paris", iconURL: PSG_FOOTER_ICON });

    // ── Gestion image : priorité fichier local > URL > thumbnail par rareté ──
    const imageFile = getCardImageFile(card);
    if (imageFile) {
      embed.setImage(`attachment://${imageFile.name}`);
      return interaction.reply({ embeds: [embed], files: [imageFile], flags: MessageFlags.Ephemeral });
    }

    const cardImageUrl = getCardImageUrlLocal(card);
    if (cardImageUrl) {
      embed.setImage(cardImageUrl);
    } else {
      embed.setThumbnail(getRarityCardImage(card.rareté || 'Basic'));
    }
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ── Précédent ──
  if (customId.startsWith('collection_prev_')) {
    const viewerId = customId.split('_')[2];
    if (interaction.user.id !== viewerId) return interaction.reply({ content: "❌ Ce n'est pas ta vue!", flags: MessageFlags.Ephemeral });
    const session = collectionSessions.get(viewerId);
    if (!session) return interaction.reply({ content: '❌ Session expirée.', flags: MessageFlags.Ephemeral });

    session.currentPage = Math.max(0, session.currentPage - 1);
    const embed = createCollectionEmbed(session.userName, session.pages[session.currentPage], session.currentPage + 1, session.pages.length, session.totalUnique, session.totalCards);
    const components = buildCollectionComponents(session.pages, session.currentPage, session.pages.length, session.cardsGrouped, viewerId);
    return interaction.update({ embeds: [embed], components });
  }

  // ── Suivant ──
  if (customId.startsWith('collection_next_')) {
    const viewerId = customId.split('_')[2];
    if (interaction.user.id !== viewerId) return interaction.reply({ content: "❌ Ce n'est pas ta vue!", flags: MessageFlags.Ephemeral });
    const session = collectionSessions.get(viewerId);
    if (!session) return interaction.reply({ content: '❌ Session expirée.', flags: MessageFlags.Ephemeral });

    session.currentPage = Math.min(session.pages.length - 1, session.currentPage + 1);
    const embed = createCollectionEmbed(session.userName, session.pages[session.currentPage], session.currentPage + 1, session.pages.length, session.totalUnique, session.totalCards);
    const components = buildCollectionComponents(session.pages, session.currentPage, session.pages.length, session.cardsGrouped, viewerId);
    return interaction.update({ embeds: [embed], components });
  }

  // ── Actualiser ──
  if (customId.startsWith('collection_refresh_')) {
    const viewerId = customId.split('_')[2];
    if (interaction.user.id !== viewerId) return interaction.reply({ content: "❌ Ce n'est pas ta vue!", flags: MessageFlags.Ephemeral });
    const session = collectionSessions.get(viewerId);
    if (!session) return interaction.reply({ content: '❌ Session expirée.', flags: MessageFlags.Ephemeral });

    const fresh = getUserCardsGrouped(session.guildId, session.userId);
    session.cardsGrouped = fresh;
    session.pages = organizeCardsByRarity(fresh);
    session.totalUnique = Object.keys(fresh).length;
    session.totalCards = Object.values(fresh).reduce((s, d) => s + d.count, 0);
    session.currentPage = Math.min(session.currentPage, session.pages.length - 1);

    const embed = createCollectionEmbed(session.userName, session.pages[session.currentPage], session.currentPage + 1, session.pages.length, session.totalUnique, session.totalCards);
    const components = buildCollectionComponents(session.pages, session.currentPage, session.pages.length, session.cardsGrouped, viewerId);
    return interaction.update({ embeds: [embed], components });
  }
}

module.exports = { collectionCommand, handleCollectionInteraction };