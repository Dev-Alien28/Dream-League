// src/commands/give.js - Commande pour donner des cartes (ADMIN)
const { EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { getUserData, saveUserData, findCardById, getPackAnnounceChannel } = require('../utils/database');
const { checkRolePermission } = require('../utils/permissions');
const { PSG_GREEN, PSG_RED, PSG_FOOTER_ICON, CARD_TYPES } = require('../config/settings');
const { getRarityEmoji, getRarityColor, formatCardStats, formatCardName, formatArtistCredit } = require('../utils/cardHelpers');
const { logGiveCard } = require('../utils/logs');
const fs   = require('fs');
const path = require('path');

// ─── Helpers image ─────────────────────────────────────────────────────────────

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

// ─── Commande principale ───────────────────────────────────────────────────────

async function giveCommand(interaction, carteId, membre, raison = null) {

  // ✅ Defer immédiat pour éviter le timeout Discord (3s)
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error('⚠️ deferReply échoué dans giveCommand:', err.message);
    return;
  }

  if (!checkRolePermission(interaction, 'admin')) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Permission refusée')
        .setDescription('Seuls les administrateurs peuvent utiliser cette commande.')
        .setColor(PSG_RED)],
    });
  }

  if (membre.user.bot) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Erreur')
        .setDescription('Tu ne peux pas donner de cartes à un bot !')
        .setColor(PSG_RED)],
    });
  }

  const card = findCardById(carteId);
  if (!card) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Carte introuvable')
        .setDescription(`Aucune carte trouvée avec l'ID : \`${carteId}\`\n\nVérifie l'ID dans les fichiers JSON du dossier \`data/packs/\` ou \`data/give.json\``)
        .setColor(PSG_RED)
        .setFooter({ text: "Exemple d'ID valide : give_att_anelka_0001" })],
    });
  }

  const guildId        = interaction.guildId;
  const userId         = membre.id;
  const userData       = getUserData(guildId, userId);
  userData.collection.push(card);
  saveUserData(guildId, userId, userData);

  const typeEmoji      = CARD_TYPES[card.type]?.emoji || '🎴';
  const collectionSize = userData.collection.length;
  const cardCopies     = userData.collection.filter(c => c.nom === card.nom && c.rareté === card.rareté).length;
  const artistCredit   = formatArtistCredit(card);

  // ─── Embed carte ────────────────────────────────────────────────────────────
  function buildCardEmbed() {
    const embed = new EmbedBuilder()
      .setTitle('🎁 Carte offerte par le Staff !')
      .setDescription(`# 🎴 ${formatCardName(card)}`)
      .setColor(getRarityColor(card.rareté))
      .addFields(
        { name: `${typeEmoji} Type`,   value: card.type ? card.type.charAt(0).toUpperCase() + card.type.slice(1) : 'Joueur', inline: true },
        { name: '🏆 Rareté',           value: `${getRarityEmoji(card.rareté)} ${card.rareté}`, inline: true },
        { name: '📊 Statistiques',     value: formatCardStats(card), inline: false },
        { name: '🎴 Collection',       value: `${collectionSize} carte${collectionSize > 1 ? 's' : ''}`, inline: true },
        { name: '📦 Exemplaires',      value: `x${cardCopies}`, inline: true },
      )
      .setFooter({ text: `Donné par ${interaction.user.displayName} • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON });

    if (raison)       embed.addFields({ name: '📝 Raison',  value: raison,       inline: false });
    if (artistCredit) embed.addFields({ name: '\u200b',     value: artistCredit, inline: false });

    return embed;
  }

  // ─── Annonce publique dans le salon configuré ──────────────────────────────
  const announceChannelId = getPackAnnounceChannel(guildId);
  let cdnImageUrl = getCardImageUrlLocal(card);

  if (announceChannelId) {
    const announceChannel = interaction.guild.channels.cache.get(String(announceChannelId));
    if (announceChannel) {
      const publicEmbed = buildCardEmbed();
      try {
        const imageFile = getCardImageFile(card);
        if (imageFile) {
          publicEmbed.setImage(`attachment://${imageFile.name}`);
          const sentMsg = await announceChannel.send({
            content: `🎉 ${membre} a reçu une carte exclusive du Staff !`,
            embeds:  [publicEmbed],
            files:   [imageFile],
          });
          setTimeout(() => sentMsg.delete().catch(() => {}), 120_000);
          const attachment = sentMsg.attachments.first();
          if (attachment) cdnImageUrl = attachment.url;
        } else if (cdnImageUrl) {
          publicEmbed.setImage(cdnImageUrl);
          const sentMsg = await announceChannel.send({
            content: `🎉 ${membre} a reçu une carte exclusive du Staff !`,
            embeds:  [publicEmbed],
          });
          setTimeout(() => sentMsg.delete().catch(() => {}), 120_000);
        } else {
          const sentMsg = await announceChannel.send({
            content: `🎉 ${membre} a reçu une carte exclusive du Staff !`,
            embeds:  [publicEmbed],
          });
          setTimeout(() => sentMsg.delete().catch(() => {}), 120_000);
        }
      } catch { /* bot sans accès au salon */ }
    }
  }

  // ─── Confirmation éphémère à l'admin ──────────────────────────────────────
  const adminEmbed = new EmbedBuilder()
    .setTitle('✅ Carte donnée avec succès !')
    .setDescription(`Tu as donné la carte **${formatCardName(card)}** à ${membre}`)
    .setColor(PSG_GREEN)
    .addFields(
      { name: '🎴 Carte',        value: formatCardName(card),                            inline: true },
      { name: '🏆 Rareté',       value: `${getRarityEmoji(card.rareté)} ${card.rareté}`, inline: true },
      { name: '👤 Bénéficiaire', value: membre.toString(),                               inline: true },
    )
    .setFooter({ text: `Donné par ${interaction.user.displayName} • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON });

  if (raison)       adminEmbed.addFields({ name: '📝 Raison', value: raison,       inline: false });
  if (artistCredit) adminEmbed.addFields({ name: '\u200b',    value: artistCredit, inline: false });

  await interaction.editReply({ embeds: [adminEmbed] });
  logGiveCard(interaction, membre, card, raison).catch(() => {});
}

module.exports = { giveCommand };