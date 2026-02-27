// src/commands/solde.js
const {EmbedBuilder, MessageFlags } = require('discord.js');
const { getUserData } = require('../utils/database');
const { checkChannelPermission, getAllowedChannel } = require('../utils/permissions');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON } = require('../config/settings');

async function soldeCommand(interaction) {
  if (!checkChannelPermission(interaction, 'solde')) {
    const allowedChannel = getAllowedChannel(interaction.guildId, 'solde', interaction.client);
    const embed = new EmbedBuilder().setTitle('❌ Salon non autorisé').setColor(PSG_RED);
    if (allowedChannel) {
      embed.setDescription(`Cette commande ne peut pas être utilisée dans ce salon.\n\n➡️ **Utilise plutôt :** ${allowedChannel}`);
    } else {
      embed.setDescription("Cette commande ne peut pas être utilisée dans ce salon.\n\nAucun salon n'est configuré pour cette commande.\nContacte un administrateur pour configurer les salons avec `/config`.");
    }
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const userData = getUserData(guildId, userId);

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

module.exports = { soldeCommand };