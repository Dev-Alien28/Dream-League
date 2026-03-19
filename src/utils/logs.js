// src/utils/logs.js - Logs uniquement liés au bot PSG Dream League
const { EmbedBuilder } = require('discord.js');
const { loadServerConfig } = require('./permissions');
const { PSG_BLUE, PSG_RED, PSG_GREEN, PSG_FOOTER_ICON } = require('../config/settings');

async function getLogsChannel(guild) {
  const config = loadServerConfig(String(guild.id));
  if (!config?.logs_channel) return null;
  try {
    return guild.channels.cache.get(String(config.logs_channel)) || null;
  } catch {
    return null;
  }
}

async function safeSend(channel, embed) {
  try {
    await channel.send({ embeds: [embed] });
  } catch { /* silencieux */ }
}

// ==================== LOG ACHAT PACK ====================

async function logPackPurchase(interaction, packInfo, card, newCoins) {
  const channel = await getLogsChannel(interaction.guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('📦 Pack acheté')
    .setDescription(`${interaction.user} a acheté un pack`)
    .setColor(PSG_BLUE)
    .addFields(
      { name: '🎁 Pack', value: `${packInfo.emoji} ${packInfo.nom}`, inline: true },
      { name: '💰 Prix', value: `${packInfo.prix} 🪙`, inline: true },
      { name: '💎 Solde restant', value: `${newCoins} 🪙`, inline: true },
      { name: '🎴 Carte obtenue', value: card.nom, inline: true },
      { name: '🏆 Rareté', value: card.rareté, inline: true },
      { name: '📺 Salon', value: interaction.channel?.toString() || 'Inconnu', inline: true },
    )
    .setThumbnail(interaction.user.displayAvatarURL())
    .setFooter({ text: `ID: ${interaction.user.id} • Paris Saint-Germain`, iconURL: PSG_FOOTER_ICON })
    .setTimestamp();

  await safeSend(channel, embed);
}

// ==================== LOG COMMANDES ADMIN COINS ====================

async function logAdminCoins(interaction, action, membre, montant, ancienSolde, nouveauSolde) {
  const channel = await getLogsChannel(interaction.guild);
  if (!channel) return;

  const titles = {
    add: '➕ Coins ajoutés (Admin)',
    remove: '➖ Coins retirés (Admin)',
    set: '⚙️ Coins définis (Admin)',
  };

  const colors = {
    add: PSG_GREEN || 0x00C851,
    remove: PSG_RED,
    set: PSG_BLUE,
  };

  const embed = new EmbedBuilder()
    .setTitle(titles[action] || '⚙️ Action Admin Coins')
    .setColor(colors[action] || PSG_BLUE)
    .addFields(
      { name: '👑 Administrateur', value: `${interaction.user}`, inline: true },
      { name: '👤 Membre ciblé', value: `${membre}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '💰 Ancien solde', value: `${ancienSolde} 🪙`, inline: true },
      { name: '🔄 Montant', value: `${action === 'remove' ? '-' : action === 'add' ? '+' : '='}${montant} 🪙`, inline: true },
      { name: '💎 Nouveau solde', value: `${nouveauSolde} 🪙`, inline: true },
    )
    .setFooter({ text: `Admin: ${interaction.user.id} • Cible: ${membre.id} • Paris Saint-Germain`, iconURL: PSG_FOOTER_ICON })
    .setTimestamp();

  await safeSend(channel, embed);
}

// ==================== LOG GIVE CARTE ====================

async function logGiveCard(interaction, membre, card, raison) {
  const channel = await getLogsChannel(interaction.guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('🎁 Carte donnée (Admin)')
    .setDescription(`${interaction.user} a donné une carte à ${membre}`)
    .setColor(PSG_GREEN || 0x00C851)
    .addFields(
      { name: '👑 Administrateur', value: `${interaction.user}`, inline: true },
      { name: '👤 Bénéficiaire', value: `${membre}`, inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '🎴 Carte', value: card.nom, inline: true },
      { name: '🏆 Rareté', value: card.rareté, inline: true },
      { name: '🆔 ID Carte', value: card.id || 'N/A', inline: true },
    )
    .setFooter({ text: `Admin: ${interaction.user.id} • Bénéficiaire: ${membre.id} • Paris Saint-Germain`, iconURL: PSG_FOOTER_ICON })
    .setTimestamp();

  if (raison) embed.addFields({ name: '📝 Raison', value: raison, inline: false });

  await safeSend(channel, embed);
}

// ==================== LOG MINIGAME ====================

async function logMinigameWin(interaction, card, guildId) {
  const guild = interaction.guild || interaction.client?.guilds?.cache?.get(guildId);
  if (!guild) return;
  const channel = await getLogsChannel(guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('⚡ Mini-jeu remporté !')
    .setDescription(`${interaction.user} a gagné le mini-jeu **Joueur Fuyard** !`)
    .setColor(0xFFD700)
    .addFields(
      { name: '🏆 Gagnant', value: `${interaction.user}`, inline: true },
      { name: '🎴 Carte gagnée', value: card.nom, inline: true },
      { name: '✨ Rareté', value: card.rareté, inline: true },
    )
    .setThumbnail(interaction.user.displayAvatarURL())
    .setFooter({ text: `ID: ${interaction.user.id} • Paris Saint-Germain`, iconURL: PSG_FOOTER_ICON })
    .setTimestamp();

  await safeSend(channel, embed);
}

module.exports = {
  logPackPurchase,
  logAdminCoins,
  logGiveCard,
  logMinigameWin,
};