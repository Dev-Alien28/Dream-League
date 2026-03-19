// src/commands/give.js - Commande pour donner des cartes (ADMIN)
const {EmbedBuilder, MessageFlags } = require('discord.js');
const { getUserData, saveUserData, findCardById } = require('../utils/database');
const { checkRolePermission } = require('../utils/permissions');
const { PSG_GREEN, PSG_RED, CARD_TYPES, PSG_FOOTER_ICON } = require('../config/settings');
const { getRarityColor, getRarityEmoji, getRarityCardImage, formatCardStats, getCardImageUrl } = require('../utils/cardHelpers');

async function giveCommand(interaction, carteId, membre, raison = null) {
  if (!checkRolePermission(interaction, 'admin')) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('❌ Permission refusée').setDescription('Seuls les administrateurs peuvent utiliser cette commande.').setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (membre.user.bot) {
    return interaction.reply({
      embeds: [new EmbedBuilder().setTitle('❌ Erreur').setDescription('Tu ne peux pas donner de cartes à un bot !').setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const card = findCardById(carteId);
  if (!card) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Carte introuvable')
        .setDescription(`Aucune carte trouvée avec l'ID : \`${carteId}\`\n\nVérifie l'ID dans les fichiers JSON du dossier \`data/packs/\``)
        .setColor(PSG_RED)
        .setFooter({ text: 'Exemple d\'ID valide : gk_donnarumma_basic' })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guildId;
  const userId = membre.id;
  const userData = getUserData(guildId, userId);
  userData.collection.push(card);
  saveUserData(guildId, userId, userData);

  // Embed de confirmation pour l'admin
  const adminEmbed = new EmbedBuilder()
    .setTitle('✅ Carte donnée avec succès !')
    .setDescription(`Tu as donné la carte **${card.nom}** à ${membre}`)
    .setColor(PSG_GREEN)
    .addFields(
      { name: '🎴 Carte', value: card.nom, inline: true },
      { name: '🏆 Rareté', value: `${getRarityEmoji(card.rareté)} ${card.rareté}`, inline: true },
      { name: '👤 Bénéficiaire', value: membre.toString(), inline: true },
    )
    .setFooter({ text: `Donné par ${interaction.user.displayName} • ${interaction.guild.name}`, iconURL: PSG_FOOTER_ICON });

  if (raison) adminEmbed.addFields({ name: '📝 Raison', value: raison, inline: false });

  await interaction.reply({ embeds: [adminEmbed], flags: MessageFlags.Ephemeral });

  // Embed pour le membre qui reçoit la carte
  const typeEmoji = CARD_TYPES[card.type]?.emoji || '🎴';
  const memberEmbed = new EmbedBuilder()
    .setTitle('🎁 TU AS REÇU UNE CARTE !')
    .setDescription(`# 🎴 ${card.nom}\n\nFélicitations ! Un administrateur t'a offert une carte exclusive !`)
    .setColor(getRarityColor(card.rareté))
    .addFields(
      { name: `${typeEmoji} Type`, value: card.type ? card.type.charAt(0).toUpperCase() + card.type.slice(1) : 'Joueur', inline: true },
      { name: '🏆 Rareté', value: `${getRarityEmoji(card.rareté)} ${card.rareté}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '📊 Statistiques', value: formatCardStats(card), inline: false },
      { name: '🎴 Ta collection', value: `${userData.collection.length} cartes`, inline: true },
    )
    .setFooter({ text: `Offert par ${interaction.user.displayName} • Paris Saint-Germain`, iconURL: PSG_FOOTER_ICON });

  if (raison) memberEmbed.addFields({ name: '💬 Message', value: raison, inline: false });

  const imageUrl = getCardImageUrl(card) || getRarityCardImage(card.rareté);
  if (imageUrl) memberEmbed.setImage(imageUrl);

  try {
    await membre.send({ embeds: [memberEmbed] });
  } catch {
    await interaction.followUp({
      embeds: [new EmbedBuilder()
        .setTitle('⚠️ Message privé non envoyé')
        .setDescription(`Je n'ai pas pu envoyer un message privé à ${membre}.\nLa carte a bien été ajoutée à sa collection.`)
        .setColor(0xFFA500)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { giveCommand };