// src/commands/gaming_room.js - Embed permanent PSG Dream League
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  AttachmentBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, MessageFlags,
} = require('discord.js');
const {
  getUserData, saveUserData, loadPackCards,
  canClaimFreePack, claimFreePack, getFreePackCooldown,
  getUserCardsGrouped, getPackAnnounceChannel,
} = require('../utils/database');
const { PSG_BLUE, PSG_RED, PACKS_CONFIG, CARD_TYPES, PSG_FOOTER_ICON } = require('../config/settings');
const {
  getRarityColor, getRarityEmoji, getRarityCardImage,
  formatCardStats, weightedRandom,
} = require('../utils/cardHelpers');
const { logPackPurchase } = require('../utils/logs');
const fs = require('fs');
const path = require('path');

// ─── Lock anti-double-achat ────────────────────────────────────────────────────
// Clé : `${guildId}:${userId}` → true pendant qu'un achat est en cours
const buyLocks = new Set();

// ─── Helpers image ────────────────────────────────────────────────────────────

function getCardImageFile(card) {
  const imagePath = card.image || '';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return null;
  const absolutePath = path.join(__dirname, '..', imagePath);
  if (imagePath && fs.existsSync(absolutePath)) {
    try { return new AttachmentBuilder(absolutePath, { name: path.basename(absolutePath) }); }
    catch { return null; }
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

// ─── EMBED PRINCIPAL GAMING ROOM ─────────────────────────────────────────────

async function sendGamingRoomEmbed(channel) {
  const boitePath = path.join(__dirname, '..', 'images', 'Boite.png');
  const hasImage = fs.existsSync(boitePath);

  const embed = new EmbedBuilder()
    .setTitle('Gaming Room 🕹️')
    .setDescription(
      'Clique sur un bouton ci-dessous !\n\n'
      + '🎴 **Boutique PSG Dream League**\n'
      + 'Retrouvez tous les boosters de cartes afin de composer votre équipe de rêve !\n\n'
      + '🗂️ **Collection**\n'
      + 'Observez votre collection complète de cartes\n\n'
      + '🪙 **Portefeuille**\n'
      + 'Regardez le total des PSG Coins accumulés\n\n'
      + '──────────────────────────\n'
      + '💬 **Venez discuter de PSG Dream League dans <#1326910792146354318> !**',
    )
    .setColor(PSG_BLUE)
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

  if (hasImage) embed.setImage('attachment://Boite.png');

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('gr_boosters').setLabel('🎴 Les Boosters').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('gr_collection').setLabel('🗂️ La Collection').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('gr_portefeuille').setLabel('🪙 Le Portefeuille').setStyle(ButtonStyle.Success),
    ),
  ];

  if (hasImage) {
    const file = new AttachmentBuilder(boitePath, { name: 'Boite.png' });
    return channel.send({ embeds: [embed], components, files: [file] });
  }
  return channel.send({ embeds: [embed], components });
}

// ─── BOUTON : LES BOOSTERS ───────────────────────────────────────────────────

async function handleBoosters(interaction) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const userData = getUserData(guildId, userId);

  const embed = new EmbedBuilder()
    .setTitle('🎁 BOUTIQUE PSG - PACKS DISPONIBLES')
    .setDescription('Clique sur un bouton ci-dessous pour acheter un pack !\nChaque pack contient **1 carte exclusive** avec des taux de drop différents.\n\u200b')
    .setColor(PSG_BLUE)
    .setFooter({
      text: `Ton solde : ${userData.coins} PSG Coins • ${interaction.guild.name} • Expire dans 1 min`,
      iconURL: PSG_FOOTER_ICON,
    });

  const packEntries = Object.entries(PACKS_CONFIG).filter(([k]) => k !== 'pack_event');

  for (let i = 0; i < packEntries.length; i++) {
    const [packKey, packInfo] = packEntries[i];
    let extraInfo = '';
    if (packKey === 'free_pack') {
      if (canClaimFreePack(guildId, userId)) {
        extraInfo = '\n✅ **Disponible maintenant !**';
      } else {
        const cooldown = getFreePackCooldown(guildId, userId);
        const hours = Math.floor(cooldown / 3600);
        const minutes = Math.floor((cooldown % 3600) / 60);
        extraInfo = `\n⏰ Disponible dans **${hours}h${String(minutes).padStart(2, '0')}m**`;
      }
    }
    embed.addFields({
      name: `${packInfo.emoji} **${packInfo.nom}**`,
      value: `${packInfo.description}${extraInfo}${i < packEntries.length - 1 ? '\n\u200b' : ''}`,
      inline: false,
    });
  }

  // Construction des boutons d'achat
  const rows = [];
  let row = new ActionRowBuilder();
  let btnCount = 0;
  for (const [packKey, packInfo] of packEntries) {
    if (btnCount === 5) { rows.push(row); row = new ActionRowBuilder(); btnCount = 0; }
    const style = packKey === 'free_pack' ? ButtonStyle.Success : ButtonStyle.Primary;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`gr_buy_pack_${packKey}_${userId}`)
        .setLabel(`${packInfo.emoji} ${packInfo.nom} - ${packInfo.prix} 🪙`)
        .setStyle(style),
    );
    btnCount++;
  }
  if (btnCount > 0) rows.push(row);

  const boitePath = path.join(__dirname, '..', 'images', 'Boite.png');
  const replyOptions = { embeds: [embed], components: rows, flags: MessageFlags.Ephemeral };
  if (fs.existsSync(boitePath)) {
    const file = new AttachmentBuilder(boitePath, { name: 'Boite.png' });
    embed.setImage('attachment://Boite.png');
    replyOptions.files = [file];
  }

  await interaction.reply(replyOptions);

  // Après 60s : désactiver les boutons plutôt que supprimer (évite les échecs d'interaction)
  setTimeout(async () => {
    try {
      const disabledRows = rows.map(r => {
        const newRow = new ActionRowBuilder();
        newRow.addComponents(
          r.components.map(btn =>
            ButtonBuilder.from(btn.toJSON()).setDisabled(true),
          ),
        );
        return newRow;
      });
      await interaction.editReply({ components: disabledRows });
    } catch { /* message déjà supprimé ou interaction expirée, ok */ }
  }, 60000);
}

// ─── BOUTON : ACHAT PACK ─────────────────────────────────────────────────────

async function handleBuyPack(interaction, packKey) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const lockKey = `${guildId}:${userId}`;

  // Anti-double-achat : si un achat est déjà en cours pour cet utilisateur, on ignore silencieusement
  if (buyLocks.has(lockKey)) {
    try { await interaction.deferUpdate(); } catch { /* ok */ }
    return;
  }
  buyLocks.add(lockKey);

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    // deferReply a planté (timeout réseau, interaction expirée...) → libérer le lock immédiatement
    buyLocks.delete(lockKey);
    console.error(`⚠️ deferReply échoué pour achat pack (${packKey}):`, err.message);
    return;
  }

  try {
    const packInfo = PACKS_CONFIG[packKey];
    if (!packInfo) return interaction.editReply({ content: '❌ Pack inconnu.' });

    // Lire le solde APRÈS le defer (données fraîches)
    const userData = getUserData(guildId, userId);

    if (packKey === 'free_pack') {
      if (!canClaimFreePack(guildId, userId)) {
        const cooldown = getFreePackCooldown(guildId, userId);
        const hours = Math.floor(cooldown / 3600);
        const minutes = Math.floor((cooldown % 3600) / 60);
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('⏰ Pack gratuit indisponible')
            .setDescription(`Tu as déjà réclamé ton pack gratuit !\n\n**Prochain pack dans :** ${hours}h ${minutes}m`)
            .setColor(PSG_RED)
            .setFooter({ text: 'Le pack gratuit se recharge toutes les 24 heures' })],
        });
      }
      claimFreePack(guildId, userId);
    } else if (userData.coins < packInfo.prix) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Solde insuffisant')
          .setDescription("Tu n'as pas assez de PSG Coins pour acheter ce pack !")
          .setColor(PSG_RED)
          .addFields(
            { name: '💰 Prix du pack', value: `${packInfo.prix} 🪙`, inline: true },
            { name: '💎 Ton solde', value: `${userData.coins} 🪙`, inline: true },
            { name: '❗ Il te manque', value: `${packInfo.prix - userData.coins} 🪙`, inline: true },
          )
          .setFooter({ text: 'Parlez dans le chat pour gagner des PSG Coins !' })],
      });
    }

    const allCards = loadPackCards(packKey);
    if (!allCards.length) {
      return interaction.editReply({
        embeds: [new EmbedBuilder().setTitle('❌ Erreur').setDescription('Aucune carte disponible dans ce pack.').setColor(PSG_RED)],
      });
    }

    const chosenRarity = weightedRandom(packInfo.drop_rates);
    const cardsOfRarity = allCards.filter(c => c.rareté === chosenRarity);
    const card = cardsOfRarity.length
      ? cardsOfRarity[Math.floor(Math.random() * cardsOfRarity.length)]
      : allCards[Math.floor(Math.random() * allCards.length)];

    // Relecture + débit atomique
    const freshData = getUserData(guildId, userId);
    if (packKey !== 'free_pack') freshData.coins -= packInfo.prix;
    freshData.collection.push(card);
    saveUserData(guildId, userId, freshData);

    logPackPurchase(interaction, packInfo, card, freshData.coins).catch(() => {});

    const typeEmoji = CARD_TYPES[card.type]?.emoji || '🎴';

    function buildCardEmbed() {
      return new EmbedBuilder()
        .setTitle(`🎁 ${packInfo.emoji} ${packInfo.nom} ouvert !`)
        .setDescription(`# 🎴 ${card.nom}`)
        .setColor(getRarityColor(card.rareté))
        .addFields(
          { name: `${typeEmoji} Type`, value: card.type ? card.type.charAt(0).toUpperCase() + card.type.slice(1) : 'Joueur', inline: true },
          { name: '🎲 Chance de drop', value: `${packInfo.drop_rates[card.rareté] ?? '?'}%`, inline: true },
          { name: '\u200b', value: '\u200b', inline: true },
          { name: '📊 Statistiques', value: formatCardStats(card), inline: false },
          { name: '💰 Nouveau solde', value: `${freshData.coins} 🪙`, inline: true },
          { name: '🎴 Collection', value: `${freshData.collection.length} cartes`, inline: true },
        )
        .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON });
    }

    const imageFile = getCardImageFile(card);
    const cardImageUrl = getCardImageUrlLocal(card);
    let cdnImageUrl = cardImageUrl || null;

    // Annonce publique
    const announceChannelId = getPackAnnounceChannel(guildId);
    if (announceChannelId) {
      const announceChannel = interaction.guild.channels.cache.get(String(announceChannelId));
      if (announceChannel) {
        const publicEmbed = buildCardEmbed();
        try {
          if (imageFile) {
            const announceFile = getCardImageFile(card);
            publicEmbed.setImage(`attachment://${announceFile.name}`);
            const sentMsg = await announceChannel.send({ content: `🎉 ${interaction.user}`, embeds: [publicEmbed], files: [announceFile] });
            const attachment = sentMsg.attachments.first();
            if (attachment) cdnImageUrl = attachment.url;
          } else {
            if (cardImageUrl) publicEmbed.setImage(cardImageUrl);
            else publicEmbed.setThumbnail(getRarityCardImage(card.rareté || 'Basic'));
            await announceChannel.send({ content: `🎉 ${interaction.user}`, embeds: [publicEmbed] });
          }
        } catch { /* bot sans accès au salon */ }
      }
    }

    // Réponse éphémère
    const ephemeralEmbed = buildCardEmbed();
    if (cdnImageUrl) {
      ephemeralEmbed.setImage(cdnImageUrl);
      await interaction.editReply({ embeds: [ephemeralEmbed] });
    } else if (imageFile) {
      const ephemeralFile = getCardImageFile(card);
      ephemeralEmbed.setImage(`attachment://${ephemeralFile.name}`);
      await interaction.editReply({ embeds: [ephemeralEmbed], files: [ephemeralFile] });
    } else {
      if (!cardImageUrl) ephemeralEmbed.setThumbnail(getRarityCardImage(card.rareté || 'Basic'));
      await interaction.editReply({ embeds: [ephemeralEmbed] });
    }

  } finally {
    // Libérer le lock dans tous les cas (succès ou erreur)
    buyLocks.delete(lockKey);
  }
}

// ─── BOUTON : LE PORTEFEUILLE ────────────────────────────────────────────────

async function handlePortefeuille(interaction) {
  const userData = getUserData(interaction.guildId, interaction.user.id);
  const embed = new EmbedBuilder()
    .setTitle(`💰 Solde de ${interaction.user.displayName}`)
    .setDescription(`Ton portefeuille PSG sur **${interaction.guild.name}**`)
    .setColor(PSG_BLUE)
    .addFields(
      { name: '💎 PSG Coins', value: `**${userData.coins}** 🪙`, inline: true },
      { name: '🎴 Collection', value: `${(userData.collection || []).length} carte(s)`, inline: true },
    )
    .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON })
    .setTimestamp();
  const avatarUrl = interaction.user.displayAvatarURL();
  if (avatarUrl) embed.setThumbnail(avatarUrl);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ─── BOUTON : LA COLLECTION → UserSelectMenu ──────────────────────────────────

async function handleCollection(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('🗂️ Collection')
    .setDescription('Sélectionne un membre pour voir sa collection, ou choisis-toi directement !')
    .setColor(PSG_BLUE)
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`gr_coll_user_select_${interaction.user.id}`)
      .setPlaceholder('👤 Choisir un membre...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  const myCollectionBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gr_coll_self_${interaction.user.id}`)
      .setLabel('📋 Ma collection')
      .setStyle(ButtonStyle.Primary),
  );

  return interaction.reply({
    embeds: [embed],
    components: [row, myCollectionBtn],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── COLLECTION : afficher pour un userId donné ───────────────────────────────

async function showCollection(interaction, targetUserId, targetUserName) {
  const guildId = interaction.guildId;
  const viewerId = interaction.user.id;
  const cardsGrouped = getUserCardsGrouped(guildId, targetUserId);

  const emptyEmbed = new EmbedBuilder()
    .setTitle(`📋 Collection de ${targetUserName}`)
    .setDescription('🔭 Cette collection est vide!\n\nAchète des packs pour commencer ta collection!')
    .setColor(PSG_BLUE)
    .setFooter({ text: `Paris Saint-Germain • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON });

  if (!Object.keys(cardsGrouped).length) {
    if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      return interaction.update({ embeds: [emptyEmbed], components: [] });
    }
    return interaction.reply({ embeds: [emptyEmbed], flags: MessageFlags.Ephemeral });
  }

  const pages = organizeCardsByRarity(cardsGrouped);
  const totalUnique = Object.keys(cardsGrouped).length;
  const totalCards = Object.values(cardsGrouped).reduce((s, d) => s + d.count, 0);

  collectionSessions.set(viewerId, {
    guildId,
    userId: targetUserId,
    userName: targetUserName,
    cardsGrouped,
    pages,
    currentPage: 0,
    totalUnique,
    totalCards,
    expireAt: Date.now() + 15 * 60 * 1000,
  });

  const embedPage = createCollectionEmbed(targetUserName, pages[0], 1, pages.length, totalUnique, totalCards);
  const components = buildCollectionComponents(pages, 0, pages.length, cardsGrouped, viewerId);

  if (interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
    return interaction.update({ embeds: [embedPage], components });
  }
  return interaction.reply({ embeds: [embedPage], components, flags: MessageFlags.Ephemeral });
}

// ─── COLLECTION : données ─────────────────────────────────────────────────────

const RARITY_ORDER = { Légendaire: 0, Legend: 0, Unique: 1, Épique: 2, Elite: 2, Advanced: 3, Basic: 4 };
const CARDS_PER_PAGE = 10;
const collectionSessions = new Map();

// Nettoyage périodique des sessions expirées (toutes les 5 min)
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of collectionSessions.entries()) {
    if (session.expireAt && now > session.expireAt) {
      collectionSessions.delete(key);
    }
  }
}, 5 * 60 * 1000);

function getRarityOrder(rarity) { return RARITY_ORDER[rarity] ?? 999; }

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

function createCollectionEmbed(userName, pageData, currentPage, totalPages, uniqueCards, totalCards) {
  const embed = new EmbedBuilder()
    .setTitle(`📋 Collection de ${userName}`)
    .setDescription(`🎴 Total: ${totalCards} carte(s)\n✨ Cartes uniques: ${uniqueCards}\n📄 Page: ${currentPage}/${totalPages}`)
    .setColor(PSG_BLUE)
    .setFooter({ text: 'Sélectionne une carte pour voir ses détails • Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

  if (!pageData?.cards?.length) {
    embed.addFields({ name: '🔭 Collection vide', value: 'Achète des packs pour commencer ta collection !', inline: false });
    return embed;
  }
  const { rarity, cards, isContinuation } = pageData;
  let sectionTitle = `${getRarityEmoji(rarity)}  ${rarity}`;
  if (isContinuation) sectionTitle += ' (suite)';
  embed.addFields({
    name: sectionTitle,
    value: cards.map(([, d]) => `${CARD_TYPES[d.card.type]?.emoji || '🎴'} ${d.card.nom} x${d.count}`).join('\n'),
    inline: false,
  });
  return embed;
}

function buildCollectionComponents(pages, currentPage, totalPages, cardsGrouped, viewerId) {
  const rows = [];
  const pageData = pages[currentPage];
  if (pageData?.cards?.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`gr_coll_card_${viewerId}`)
        .setPlaceholder(`🎴 ${pageData.rarity} - Page ${currentPage + 1}/${totalPages}`)
        .addOptions(pageData.cards.map(([cardId, cardData]) => ({
          label: `${cardData.card.nom} x${cardData.count}`.slice(0, 100),
          description: `${CARD_TYPES[cardData.card.type]?.emoji || '🎴'} ${cardData.card.type?.charAt(0).toUpperCase() + cardData.card.type?.slice(1)} - ${cardData.card.rareté}`.slice(0, 100),
          value: cardId,
          emoji: getRarityEmoji(cardData.card.rareté),
        }))),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gr_coll_prev_${viewerId}`).setLabel('◀️ Précédent').setStyle(ButtonStyle.Primary).setDisabled(currentPage === 0),
    new ButtonBuilder().setCustomId(`gr_coll_next_${viewerId}`).setLabel('Suivant ▶️').setStyle(ButtonStyle.Primary).setDisabled(currentPage >= totalPages - 1),
    new ButtonBuilder().setCustomId(`gr_coll_refresh_${viewerId}`).setLabel('🔄 Actualiser').setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}

// ─── Helper : recrée une session si absente (résistance aux redémarrages) ──────

function restoreSession(viewerId, guildId, userName) {
  const cardsGrouped = getUserCardsGrouped(guildId, viewerId);
  const pages = organizeCardsByRarity(cardsGrouped);
  const totalUnique = Object.keys(cardsGrouped).length;
  const totalCards = Object.values(cardsGrouped).reduce((s, d) => s + d.count, 0);

  const session = {
    guildId,
    userId: viewerId,
    userName: userName || 'Toi',
    cardsGrouped,
    pages,
    currentPage: 0,
    totalUnique,
    totalCards,
    expireAt: Date.now() + 15 * 60 * 1000,
  };

  collectionSessions.set(viewerId, session);
  return session;
}

// ─── GESTION INTERACTIONS COLLECTION ─────────────────────────────────────────

async function handleCollectionInteraction(interaction) {
  const customId = interaction.customId;

  // ── UserSelectMenu : un membre a été sélectionné ──────────────────────────
  if (customId.startsWith('gr_coll_user_select_')) {
    const requesterId = customId.replace('gr_coll_user_select_', '');
    if (interaction.user.id !== requesterId) {
      return interaction.reply({ content: "❌ Ce n'est pas ta vue !", flags: MessageFlags.Ephemeral });
    }
    const targetUser = interaction.users.first();
    if (!targetUser) return interaction.reply({ content: '❌ Membre introuvable.', flags: MessageFlags.Ephemeral });
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const targetName = targetMember?.displayName || targetUser.username;
    return showCollection(interaction, targetUser.id, targetName);
  }

  // ── Bouton "Ma collection" ────────────────────────────────────────────────
  if (customId.startsWith('gr_coll_self_')) {
    const requesterId = customId.replace('gr_coll_self_', '');
    if (interaction.user.id !== requesterId) {
      return interaction.reply({ content: "❌ Ce n'est pas ta vue !", flags: MessageFlags.Ephemeral });
    }
    return showCollection(interaction, interaction.user.id, interaction.user.displayName);
  }

  // ── StringSelectMenu : détail d'une carte ────────────────────────────────
  if (customId.startsWith('gr_coll_card_')) {
    const viewerId = customId.replace('gr_coll_card_', '');
    if (interaction.user.id !== viewerId) {
      return interaction.reply({ content: "❌ Ce n'est pas ta vue!", flags: MessageFlags.Ephemeral });
    }

    // ✅ Restauration automatique si session absente (ex: redémarrage du bot)
    const session = collectionSessions.get(viewerId)
      ?? restoreSession(viewerId, interaction.guildId, interaction.user.displayName);

    const card = session.cardsGrouped[interaction.values[0]]?.card;
    if (!card) return interaction.reply({ content: '❌ Carte introuvable.', flags: MessageFlags.Ephemeral });
    const count = session.cardsGrouped[interaction.values[0]].count;
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

    const imageFile = getCardImageFile(card);
    if (imageFile) {
      embed.setImage(`attachment://${imageFile.name}`);
      return interaction.reply({ embeds: [embed], files: [imageFile], flags: MessageFlags.Ephemeral });
    }
    const cardImageUrl = getCardImageUrlLocal(card);
    if (cardImageUrl) embed.setImage(cardImageUrl);
    else embed.setThumbnail(getRarityCardImage(card.rareté || 'Basic'));
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ── Boutons pagination ────────────────────────────────────────────────────
  if (customId.startsWith('gr_coll_prev_') || customId.startsWith('gr_coll_next_') || customId.startsWith('gr_coll_refresh_')) {
    const isPrev = customId.startsWith('gr_coll_prev_');
    const isNext = customId.startsWith('gr_coll_next_');
    const viewerId = customId.replace(/^gr_coll_(prev|next|refresh)_/, '');
    if (interaction.user.id !== viewerId) {
      return interaction.reply({ content: "❌ Ce n'est pas ta vue!", flags: MessageFlags.Ephemeral });
    }

    // ✅ Restauration automatique si session absente (ex: redémarrage du bot)
    const session = collectionSessions.get(viewerId)
      ?? restoreSession(viewerId, interaction.guildId, interaction.user.displayName);

    if (isPrev) session.currentPage = Math.max(0, session.currentPage - 1);
    else if (isNext) session.currentPage = Math.min(session.pages.length - 1, session.currentPage + 1);
    else {
      // Actualiser
      const fresh = getUserCardsGrouped(session.guildId, session.userId);
      session.cardsGrouped = fresh;
      session.pages = organizeCardsByRarity(fresh);
      session.totalUnique = Object.keys(fresh).length;
      session.totalCards = Object.values(fresh).reduce((s, d) => s + d.count, 0);
      session.currentPage = Math.min(session.currentPage, Math.max(0, session.pages.length - 1));
      session.expireAt = Date.now() + 15 * 60 * 1000;
    }

    return interaction.update({
      embeds: [createCollectionEmbed(session.userName, session.pages[session.currentPage], session.currentPage + 1, session.pages.length, session.totalUnique, session.totalCards)],
      components: buildCollectionComponents(session.pages, session.currentPage, session.pages.length, session.cardsGrouped, viewerId),
    });
  }
}

module.exports = {
  sendGamingRoomEmbed,
  handleBoosters,
  handleBuyPack,
  handlePortefeuille,
  handleCollection,
  handleCollectionInteraction,
};