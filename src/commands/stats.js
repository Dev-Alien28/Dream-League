// src/commands/stats.js - Système de statistiques PSG Dream League
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON, PACKS_CONFIG } = require('../config/settings');
const { getStatsData, getGuildData, getUserData } = require('../utils/database');
const { checkConfigPermission } = require('../utils/permissions');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n) {
  return (n ?? 0).toLocaleString('fr-FR');
}

// ─── Raretés considérées comme "Give" (carte donnée par staff) ────────────────
// La rareté "Give" est réservée aux cartes données manuellement via /give
const GIVE_RARITIES = ['Give'];

// La rareté "Encounter" est réservée aux cartes gagnées via les Encounters
const ENCOUNTER_RARITIES = ['Encounter'];

// ─── Construction de l'embed stats ────────────────────────────────────────────

function buildStatsEmbed(guild, statsData, guildUserData) {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekStart  = new Date(Date.now() - 7 * 86400000);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  // ── 1. Packs ouverts par période ───────────────────────────────────────────
  const packEvents = statsData.pack_purchases || [];

  const packsToday  = packEvents.filter(e => new Date(e.ts) >= todayStart).length;
  const packsWeek   = packEvents.filter(e => new Date(e.ts) >= weekStart).length;
  const packsMonth  = packEvents.filter(e => new Date(e.ts) >= monthStart).length;

  // Pour "depuis le début" : on prend toutes les cartes en collection,
  // on soustrait les Encounter et les Give → ce qui reste = cartes obtenues via packs.
  // Cela couvre les anciennes stats d'avant l'ajout du système d'events.
  const allUsers = Object.values(guildUserData);
  const totalCardsFromPacks = allUsers.reduce((sum, u) => {
    return sum + (u.collection || []).filter(c =>
      !GIVE_RARITIES.includes(c.rareté) && !ENCOUNTER_RARITIES.includes(c.rareté)
    ).length;
  }, 0);
  // On prend le max entre les events enregistrés et le comptage collection
  // (au cas où des events existeraient en plus des anciennes cartes)
  const packsTotal = Math.max(packEvents.length, totalCardsFromPacks);

  // ── 2. Personnes uniques ayant ouvert au moins 1 booster ──────────────────
  // Basé sur les events enregistrés (fiable depuis l'ajout du système d'events)
  const uniqueBuyers = new Set(packEvents.map(e => e.userId)).size;

  // ── 3. Personnes ayant cliqué sans avoir les coins ─────────────────────────
  const failedEvents  = statsData.failed_purchases || [];
  const uniqueFailed  = new Set(failedEvents.map(e => e.userId)).size;

  // ── 4. Encounters ──────────────────────────────────────────────────────────
  const encounterWins  = statsData.encounter_wins || [];
  const encounterTotal = encounterWins.length;
  const encounterToday = encounterWins.filter(e => new Date(e.ts) >= todayStart).length;
  const encounterWeek  = encounterWins.filter(e => new Date(e.ts) >= weekStart).length;

  // ── 5. Cartes Give (via /give ou rareté "Give" dans les collections) ────────
  const giveEvents = statsData.give_events || [];
  const giveTotalEvents = giveEvents.length;
  const giveCardsInCollections = allUsers.reduce((sum, u) => {
    return sum + (u.collection || []).filter(c => GIVE_RARITIES.includes(c.rareté)).length;
  }, 0);
  const encounterCardsInCollections = allUsers.reduce((sum, u) => {
    return sum + (u.collection || []).filter(c => ENCOUNTER_RARITIES.includes(c.rareté)).length;
  }, 0);

  // On prend le max entre les deux sources pour chaque type
  // (les events sont précis mais peuvent manquer en cas de premier démarrage)
  const giveFinal     = Math.max(giveTotalEvents, giveCardsInCollections);
  const encounterFinal = Math.max(encounterTotal, encounterCardsInCollections);

  // ─── Embed ─────────────────────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setTitle(`📊 Statistiques PSG Dream League — ${guild.name}`)
    .setColor(PSG_BLUE)

    .setFooter({
      text: `Paris Saint-Germain • Actualisé ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`,
      iconURL: PSG_FOOTER_ICON,
    })
    .addFields(
      // ── Packs ouverts ─────────────────────────────────────────────────────
      {
        name: '📦 Packs ouverts',
        value:
          `Aujourd'hui : **${formatNumber(packsToday)}**\n`
          + `Cette semaine : **${formatNumber(packsWeek)}**\n`
          + `Ce mois : **${formatNumber(packsMonth)}**\n`
          + `Depuis le début : **${formatNumber(packsTotal)}**`,
        inline: true,
      },
      // ── Joueurs ────────────────────────────────────────────────────────────
      {
        name: '👥 Joueurs',
        value:
          `Ont ouvert un booster : **${formatNumber(uniqueBuyers)}**\n`
          + `Coins insuffisants : **${formatNumber(uniqueFailed)}**`,
        inline: true,
      },
      // Séparateur visuel
      { name: '\u200b', value: '\u200b', inline: false },
      // ── Encounters ────────────────────────────────────────────────────────
      {
        name: '⚡ Encounters remportés',
        value:
          `Total : **${formatNumber(encounterFinal)}**\n`
          + `Cette semaine : **${formatNumber(encounterWeek)}**\n`
          + `Aujourd'hui : **${formatNumber(encounterToday)}**`,
        inline: true,
      },
      // ── Give ──────────────────────────────────────────────────────────────
      {
        name: '🎁 Cartes données (Give)',
        value: `Total donné par le staff : **${formatNumber(giveFinal)}**`,
        inline: true,
      },
    );

  return embed;
}

// ─── Commande /stats ──────────────────────────────────────────────────────────

async function statsCommand(interaction) {
  if (!checkConfigPermission(interaction)) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Accès refusé')
        .setDescription("Tu n'as pas la permission d'accéder aux statistiques.")
        .setColor(PSG_RED)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId      = interaction.guildId;
  const statsData    = getStatsData(guildId);
  const guildUserData = getGuildData(guildId);

  const embed = buildStatsEmbed(interaction.guild, statsData, guildUserData);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stats_refresh_${interaction.user.id}`)
      .setLabel('🔄 Actualiser')
      .setStyle(ButtonStyle.Primary),
  );

  return interaction.reply({ embeds: [embed], components: [row] });
}

// ─── Bouton refresh ────────────────────────────────────────────────────────────

async function handleStatsRefresh(interaction) {
  if (!checkConfigPermission(interaction)) {
    return interaction.reply({
      content: "❌ Tu n'as pas la permission d'actualiser les stats.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const guildId       = interaction.guildId;
  const statsData     = getStatsData(guildId);
  const guildUserData = getGuildData(guildId);

  const embed = buildStatsEmbed(interaction.guild, statsData, guildUserData);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stats_refresh_${interaction.user.id}`)
      .setLabel('🔄 Actualiser')
      .setStyle(ButtonStyle.Primary),
  );

  return interaction.update({ embeds: [embed], components: [row] });
}

module.exports = { statsCommand, handleStatsRefresh };