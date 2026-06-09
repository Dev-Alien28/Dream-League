// src/commands/transfert.js — Commande /transfert (V1)
// Permet au staff de transférer la collection et les coins d'un membre vers un autre.
// Cas d'usage typique : perte de compte Discord → nouveau compte.

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { getUserData, saveUserData } = require('../utils/database');
const { checkRolePermission }       = require('../utils/permissions');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON } = require('../config/settings');
const { getRarityEmoji }            = require('../utils/cardHelpers');

const PSG_LOGO = PSG_FOOTER_ICON;

// ── Sessions de confirmation (expire après 2 min) ─────────────────────────────
const transfertSessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of transfertSessions.entries()) {
    if (now > session.expireAt) transfertSessions.delete(key);
  }
}, 60_000);

// ── Helper footer ──────────────────────────────────────────────────────────────

function buildFooter(guild) {
  return { text: `Paris Saint-Germain • ${guild.name}`, iconURL: PSG_LOGO };
}

// ── Calcul d'un résumé de collection ─────────────────────────────────────────

function buildCollectionSummary(collection) {
  if (!collection || collection.length === 0) return '_Aucune carte_';

  const byRarity = {};
  for (const card of collection) {
    const r = card.rareté || 'Inconnu';
    byRarity[r] = (byRarity[r] || 0) + 1;
  }

  return Object.entries(byRarity)
    .map(([r, count]) => `${getRarityEmoji(r)} **${r}** × ${count}`)
    .join('\n');
}

// ── COMMANDE PRINCIPALE ───────────────────────────────────────────────────────

async function transfertCommand(interaction) {
  // ── 1. Permission staff ──────────────────────────────────────────────────
  if (!checkRolePermission(interaction, 'admin') && !checkRolePermission(interaction, 'moderator')) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Accès refusé')
          .setDescription("Tu n'as pas les permissions nécessaires pour utiliser cette commande.")
          .setColor(PSG_RED),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId = interaction.guildId;
  const source  = interaction.options.getMember('source');
  const cible   = interaction.options.getMember('cible');

  // ── 2. Validations basiques ───────────────────────────────────────────────

  if (!source || !cible) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Membre introuvable')
          .setDescription("Impossible de trouver l'un des deux membres sur ce serveur.")
          .setColor(PSG_RED),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (source.id === cible.id) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Membres identiques')
          .setDescription('La source et la cible ne peuvent pas être le même membre.')
          .setColor(PSG_RED),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (source.user.bot || cible.user.bot) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Bot détecté')
          .setDescription('Tu ne peux pas transférer vers/depuis un bot.')
          .setColor(PSG_RED),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (cible.id === interaction.client.user.id) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Cible invalide')
          .setDescription('Tu ne peux pas transférer vers le bot lui-même.')
          .setColor(PSG_RED),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── 3. Lecture des données ────────────────────────────────────────────────

  const sourceData = getUserData(guildId, source.id);
  const cibleData  = getUserData(guildId, cible.id);

  const sourceCards = sourceData.collection || [];
  const sourceCoins = sourceData.coins      ?? 0;

  // ── 4. Vérification : la source a-t-elle quelque chose à transférer ? ────

  if (sourceCards.length === 0 && sourceCoins === 0) {
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📭 Rien à transférer')
          .setDescription(`${source} n'a ni coins ni cartes sur ce serveur.`)
          .setColor(PSG_RED),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── 5. Aperçu + demande de confirmation ──────────────────────────────────

  const adminId    = interaction.user.id;
  const sessionKey = `transfert_${adminId}`;

  transfertSessions.set(sessionKey, {
    guildId,
    sourceId:   source.id,
    cibleId:    cible.id,
    sourceName: source.displayName || source.user.username,
    cibleName:  cible.displayName  || cible.user.username,
    expireAt:   Date.now() + 2 * 60 * 1000,
  });

  const cibleCards = cibleData.collection || [];
  const cibleCoins = cibleData.coins      ?? 0;

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Confirmation du transfert')
    .setDescription(
      `Tu es sur le point de transférer **tout** le contenu de ${source} vers ${cible}.\n`
      + `Cette action est **irréversible**.\n\u200B`,
    )
    .setColor(0xFFA500)
    .addFields(
      {
        name:   `📤 Source — ${source.displayName || source.user.username}`,
        value:
          `💰 **Coins :** ${sourceCoins} 🪙\n`
          + `🎴 **Cartes :** ${sourceCards.length}\n${buildCollectionSummary(sourceCards)}`,
        inline: true,
      },
      {
        name:   `📥 Cible — ${cible.displayName || cible.user.username}`,
        value:
          `💰 **Coins actuels :** ${cibleCoins} 🪙 → **${cibleCoins + sourceCoins} 🪙**\n`
          + `🎴 **Cartes actuelles :** ${cibleCards.length} → **${cibleCards.length + sourceCards.length}**`,
        inline: true,
      },
    )
    .setFooter({ text: `Session expire dans 2 min • Paris Saint-Germain`, iconURL: PSG_LOGO });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`transfert_confirm_${adminId}`)
      .setLabel('✅ Confirmer le transfert')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`transfert_cancel_${adminId}`)
      .setLabel('❌ Annuler')
      .setStyle(ButtonStyle.Secondary),
  );

  return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

// ── GESTION DES INTERACTIONS (boutons) ───────────────────────────────────────

async function handleTransfertInteraction(interaction) {
  const customId = interaction.customId;
  const adminId  = customId.split('_').pop();

  if (interaction.user.id !== adminId) {
    return interaction.reply({
      content: "❌ Ce n'est pas ta session de transfert !",
      flags: MessageFlags.Ephemeral,
    });
  }

  const sessionKey = `transfert_${adminId}`;
  const session    = transfertSessions.get(sessionKey);

  if (!session) {
    return interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle('⏰ Session expirée')
          .setDescription('La session a expiré (2 min). Relance `/transfert` pour recommencer.')
          .setColor(PSG_RED),
      ],
      components: [],
    });
  }

  // ── Annulation ────────────────────────────────────────────────────────────

  if (customId.startsWith('transfert_cancel_')) {
    transfertSessions.delete(sessionKey);
    return interaction.update({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Transfert annulé')
          .setDescription("Aucune donnée n'a été modifiée.")
          .setColor(PSG_RED),
      ],
      components: [],
    });
  }

  // ── Confirmation ──────────────────────────────────────────────────────────

  if (customId.startsWith('transfert_confirm_')) {
    // Désactive les boutons immédiatement pour éviter le double-clic
    await interaction.deferUpdate().catch(() => {});

    const { guildId, sourceId, cibleId, sourceName, cibleName } = session;
    transfertSessions.delete(sessionKey);

    // Re-lecture fraîche des données (évite les race conditions)
    const sourceData = getUserData(guildId, sourceId);
    const cibleData  = getUserData(guildId, cibleId);

    const transferedCards = [...(sourceData.collection || [])];
    const transferedCoins = sourceData.coins ?? 0;

    // Fusion vers la cible
    cibleData.collection = [...(cibleData.collection || []), ...transferedCards];
    cibleData.coins      = (cibleData.coins ?? 0) + transferedCoins;

    // Remise à zéro de la source (on conserve last_free_pack et messages)
    sourceData.collection = [];
    sourceData.coins      = 0;

    // Sauvegarde
    saveUserData(guildId, cibleId,  cibleData);
    saveUserData(guildId, sourceId, sourceData);

    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Transfert effectué avec succès !')
      .setDescription(
        `La collection et les coins de **${sourceName}** ont été transférés vers **${cibleName}**.`,
      )
      .setColor(PSG_BLUE)
      .addFields(
        {
          name:   '📤 Source (après transfert)',
          value:  `💰 Coins : **0** 🪙\n🎴 Cartes : **0**`,
          inline: true,
        },
        {
          name:   '📥 Cible (après transfert)',
          value:
            `💰 Coins : **${cibleData.coins}** 🪙\n`
            + `🎴 Cartes : **${cibleData.collection.length}** `
            + `(+${transferedCards.length} transférée(s), +${transferedCoins} coin(s))`,
          inline: true,
        },
      )
      .addFields({
        name:  '📋 Détail des cartes transférées',
        value: buildCollectionSummary(transferedCards) || '_Aucune carte_',
      })
      .setFooter({
        text:    `Effectué par ${interaction.user.displayName} • Paris Saint-Germain`,
        iconURL: PSG_LOGO,
      })
      .setTimestamp();

    return interaction.editReply({ embeds: [successEmbed], components: [] });
  }
}

module.exports = {
  transfertCommand,
  handleTransfertInteraction,
};