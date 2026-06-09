// src/commands/statsmatch.js - Système de statistiques de match PSG Dream League
// ==================== FONCTIONNALITÉS ====================
// - /statsmatch classement : Top 10 des joueurs (victoires, défaites, nuls, win rate, ratio)
//   → L'embed reste permanent, données actualisables via bouton
//   → Le bouton "Voir un joueur" envoie des réponses éphémères sans toucher l'embed de base

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const { getMatchStats, getGuildData, getTeamData } = require('../utils/database');
const { getTeamStrength, FORMATIONS, getRarityEmoji, getCardStrength } = require('../utils/teamHelpers');
const { PSG_BLUE, PSG_FOOTER_ICON } = require('../config/settings');

// ==================== CONSTANTES ====================

const COLOR_GOLD  = 0xFFD700;
const COLOR_WIN   = 0x00D25B;
const COLOR_LOSE  = 0xDA0037;
const COLOR_DRAW  = 0xFFD700;

const MEDAL_EMOJIS = ['🥇', '🥈', '🥉'];

// ==================== HELPERS VISUELS ====================

function buildBar(value, type = 'win') {
  const clamped = Math.min(100, Math.max(0, value));
  const filled  = Math.round(clamped / 10);
  const empty   = 10 - filled;
  const colors  = {
    win:      { full: '🟩', empty: '⬛' },
    attack:   { full: '🟥', empty: '⬛' },
    defense:  { full: '🟦', empty: '⬛' },
    midfield: { full: '🟨', empty: '⬛' },
  };
  const c = colors[type] || colors.win;
  return c.full.repeat(filled) + c.empty.repeat(empty);
}

function buildRecentForm(stats) {
  if (!stats || stats.played === 0) return '*Aucun match joué*';
  const results = [];
  const total   = Math.min(stats.played, 5);
  const wRate   = stats.won   / stats.played;
  const dRate   = stats.drawn / stats.played;
  for (let i = 0; i < total; i++) {
    const r = Math.random();
    if (r < wRate)              results.push('🟩');
    else if (r < wRate + dRate) results.push('🟨');
    else                        results.push('🟥');
  }
  return results.join(' ') + '  *(indicatif)*';
}

function calcRatio(won, lost) {
  if (lost === 0) return won === 0 ? '—' : '∞';
  return (won / lost).toFixed(2);
}

function calcWinRate(won, played) {
  if (!played) return 0;
  return Math.round((won / played) * 100);
}

function getFormLabel(winRate) {
  if (winRate >= 70) return '🔥 Excellent';
  if (winRate >= 55) return '⚡ En forme';
  if (winRate >= 40) return '😐 Moyen';
  if (winRate >= 25) return '😓 En difficulté';
  return '💀 En crise';
}

function buildWinRateBar(winRate) {
  const filled = Math.round(winRate / 10);
  const bar    = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `\`${bar}\` ${winRate}%`;
}

function buildPowerStars(overall) {
  const stars = Math.round((overall / 300) * 5);
  return '⭐'.repeat(Math.min(5, stars)) + '☆'.repeat(Math.max(0, 5 - stars));
}

function getTeamTier(overall) {
  if (overall >= 260) return 'S — Élite mondiale';
  if (overall >= 230) return 'A — Haut niveau';
  if (overall >= 200) return 'B — Compétitif';
  if (overall >= 170) return 'C — En développement';
  return 'D — Débutant';
}

// ==================== HELPER NOM ====================

const NAME_EXCLUDED_WORDS = new Set([
  'Home','Away','Third','Fourth','Civil','Invictus','Héros','Hero','Legend','Légende',
  'Icon','Icône','Prime','Future','Flashback','Storyline','Record','Breaker','Showdown',
  'Headliner','Totw','Toty','Community','Shapeshifter','Rulebreaker','Vintage','Tuchel',
  'EDF','Era','Edt','Sbc','Obj','Fut','Wc','Ucl','Uel','Uecl','Starter',
]);

function cleanName(nom) {
  if (!nom) return nom;
  return nom.split(' ')
    .map(p => p.replace(/^\(+|\)+$/g, ''))
    .filter(p => p !== '' && !/^\d{2}\/\d{2}$/.test(p) && !NAME_EXCLUDED_WORDS.has(p))
    .join(' ') || nom;
}

// ==================== CLASSEMENT TOP 10 ====================

async function buildLeaderboard(guildId, guild) {
  const guildUsers = getGuildData(guildId);
  const entries    = [];

  for (const [userId] of Object.entries(guildUsers)) {
    const stats = getMatchStats(guildId, userId);
    if (!stats || stats.played === 0) continue;

    let displayName = `<@${userId}>`;
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      displayName  = member?.displayName || `<@${userId}>`;
    } catch {}

    entries.push({
      userId,
      displayName,
      ...stats,
      winRate: calcWinRate(stats.won, stats.played),
      ratio:   calcRatio(stats.won, stats.lost),
    });
  }

  entries.sort((a, b) => {
    if (b.won     !== a.won)     return b.won     - a.won;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    return b.played - a.played;
  });

  return entries.slice(0, 10);
}

async function buildLeaderboardEmbed(guildId, guild) {
  const top10 = await buildLeaderboard(guildId, guild);

  if (!top10.length) {
    return new EmbedBuilder()
      .setTitle('📊 Classement PSG Dream League')
      .setDescription('*Aucun match joué sur ce serveur pour le moment.*\n\nLancez votre premier match depuis la **Team Room** !')
      .setColor(PSG_BLUE)
      .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });
  }

  const lines = top10.map((entry, i) => {
    const medal = MEDAL_EMOJIS[i] ?? `**${i + 1}.**`;
    const wr    = buildWinRateBar(entry.winRate);
    return (
      `${medal} **${entry.displayName}**\n`
      + `┣ 🏆 ${entry.won}V  🤝 ${entry.drawn}N  ❌ ${entry.lost}D  *(${entry.played} matchs)*\n`
      + `┗ ${wr}  •  Ratio : **${entry.ratio}**  •  🏅 **${entry.won * 3 + entry.drawn} pts**`
    );
  });

  const totalPlayed = top10.reduce((s, e) => s + e.played, 0);
  const avgWinRate  = top10.length
    ? Math.round(top10.reduce((s, e) => s + e.winRate, 0) / top10.length)
    : 0;

  return new EmbedBuilder()
    .setTitle('🏆 Classement PSG Dream League — Top 10')
    .setDescription(
      '> Classement basé sur les **victoires**, puis le **win rate**.\n'
      + '> 🏅 Système de points : **3** pts victoire • **1** pt nul • **0** défaite\n\n'
      + lines.join('\n\n'),
    )
    .setColor(COLOR_GOLD)
    .addFields({
      name:  '📈 Stats globales du serveur',
      value: `🎮 Total matchs individuels : **${totalPlayed}**\n`
           + `📊 Win rate moyen (Top 10) : **${avgWinRate}%**\n`
           + `👥 Joueurs classés : **${top10.length}**`,
      inline: false,
    })
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })
    .setTimestamp();
}

// Boutons permanents de l'embed de base classement
function buildLeaderboardRows(ownerId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`statsmatch_refresh_classement_${ownerId}`)
      .setLabel('🔄 Actualiser')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`statsmatch_open_player_${ownerId}`)
      .setLabel('🔍 Voir un joueur')
      .setStyle(ButtonStyle.Primary),
  );
}

// ==================== FICHE JOUEUR DÉTAILLÉE ====================

async function buildPlayerStatsEmbed(guildId, targetUserId, guild) {
  const stats = getMatchStats(guildId, targetUserId);
  const td    = getTeamData(guildId, targetUserId);

  let displayName = `<@${targetUserId}>`;
  try {
    const member = await guild.members.fetch(targetUserId).catch(() => null);
    displayName  = member?.displayName || `Joueur ${targetUserId}`;
  } catch {}

  const played       = stats?.played  ?? 0;
  const won          = stats?.won     ?? 0;
  const drawn        = stats?.drawn   ?? 0;
  const lost         = stats?.lost    ?? 0;
  const winRate      = calcWinRate(won, played);
  const ratio        = calcRatio(won, lost);
  const form         = getFormLabel(winRate);
  const leaguePoints = won * 3 + drawn;
  const recentForm   = buildRecentForm(stats);

  // ── Équipe active ──
  const activeSquad = td?.squads?.[td?.activeSquad ?? 0] ?? null;
  const teamFields  = [];

  if (activeSquad) {
    const str      = getTeamStrength(activeSquad, activeSquad.formation);
    const tier     = getTeamTier(str.overall);
    const stars    = buildPowerStars(str.overall);
    const formData = FORMATIONS[activeSquad.formation];
    const titulaires = activeSquad.titulaires || [];

    // Meilleur joueur par poste
    const topByPoste = {};
    for (const card of titulaires) {
      const pos = card.position || 'Milieu';
      const cs  = getCardStrength(card);
      if (!topByPoste[pos] || cs > getCardStrength(topByPoste[pos])) topByPoste[pos] = card;
    }

    const posOrder   = ['Gardien', 'Défenseur', 'Milieu', 'Attaquant'];
    const posEmoji   = { Gardien: '🧤', Défenseur: '🛡️', Milieu: '⚙️', Attaquant: '⚽' };
    const topJoueurs = posOrder
      .filter(p => topByPoste[p])
      .map(p => {
        const c  = topByPoste[p];
        const cs = getCardStrength(c);
        return `${posEmoji[p]} **${cleanName(c.nom)}** — ${getRarityEmoji(c.rareté)} ${c.rareté} *(force: ${cs})*`;
      })
      .join('\n');

    // Comptage raretés
    const raretéCount = {};
    for (const c of titulaires) raretéCount[c.rareté] = (raretéCount[c.rareté] || 0) + 1;
    const raretéLine = Object.entries(raretéCount)
      .sort(([, a], [, b]) => b - a)
      .map(([r, n]) => `${getRarityEmoji(r)} ${r}: **${n}**`)
      .join('  •  ');

    // Tous les slots
    const slotsInfo = (td?.squads ?? []).map((sq, i) => {
      if (!sq) return `Slot ${i + 1} : *Vide*`;
      const s      = getTeamStrength(sq, sq.formation);
      const active = (td?.activeSquad ?? 0) === i ? ' 🟢' : '';
      return `Slot ${i + 1}${active} : **${sq.formation}** — Overall **${s.overall}**`;
    }).join('\n');

    teamFields.push(
      {
        name:  `🏟️ Équipe Active — ${activeSquad.name ?? 'Équipe'} (Slot ${(td?.activeSquad ?? 0) + 1})`,
        value: `Formation : **${activeSquad.formation}** — ${formData?.styleLabel ?? ''}\n`
             + `Tier : **${tier}** ${stars}\n`
             + `Overall : **${str.overall}** / 300`,
        inline: false,
      },
      {
        name:  '⚡ Force par secteur',
        value: `**Attaque :**  ${buildBar(Math.round((str.attack   / 300) * 100), 'attack')}  **${str.attack}**\n`
             + `**Défense :**  ${buildBar(Math.round((str.defense  / 300) * 100), 'defense')}  **${str.defense}**\n`
             + `**Milieu :**   ${buildBar(Math.round((str.midfield / 300) * 100), 'midfield')}  **${str.midfield}**`,
        inline: false,
      },
      {
        name:  '👑 Meilleur joueur par poste',
        value: topJoueurs || '*Aucun titulaire configuré*',
        inline: false,
      },
      {
        name:  '🃏 Composition des raretés (titulaires)',
        value: raretéLine || '*—*',
        inline: false,
      },
      {
        name:  '📂 Tous les slots',
        value: slotsInfo || '*Aucun slot*',
        inline: false,
      },
    );
  } else {
    teamFields.push({
      name:  '🏟️ Équipe',
      value: '*Aucune équipe active configurée.*',
      inline: false,
    });
  }

  const embedColor = played === 0 ? PSG_BLUE
    : winRate >= 55 ? COLOR_WIN
    : winRate >= 40 ? COLOR_DRAW
    : COLOR_LOSE;

  return new EmbedBuilder()
    .setTitle(`📋 Fiche de ${displayName}`)
    .setDescription(
      played === 0
        ? '*Aucun match joué pour le moment.*'
        : `${form}  •  **${played}** match${played > 1 ? 's' : ''} disputé${played > 1 ? 's' : ''}`,
    )
    .setColor(embedColor)
    .addFields(
      {
        name:  '🎮 Statistiques de match',
        value: played === 0
          ? '*Aucune statistique disponible.*'
          : `🏆 Victoires : **${won}**\n🤝 Nuls : **${drawn}**\n❌ Défaites : **${lost}**\n🎮 Matchs joués : **${played}**`,
        inline: true,
      },
      {
        name:  '📈 Performances',
        value: played === 0
          ? '*—*'
          : `📊 Win rate : ${buildWinRateBar(winRate)}\n`
          + `⚖️ Ratio V/D : **${ratio}**\n`
          + `🏅 Points League : **${leaguePoints} pts**\n`
          + `🎯 Forme : ${form}`,
        inline: true,
      },
      {
        name:  '🕐 Forme récente *(5 derniers)*',
        value: played === 0 ? '*Aucun match joué*' : recentForm,
        inline: false,
      },
      { name: '━━━━━━━━━━━━━━━━━━━━━━━━', value: '\u200B', inline: false },
      ...teamFields,
    )
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })
    .setTimestamp();
}

// ==================== HANDLER COMMANDE SLASH ====================

async function statsMatchCommand(interaction) {
  const sub     = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const guild   = interaction.guild;

  // Seule sous-commande disponible : classement
  if (sub === 'classement') {
    await interaction.deferReply();
    const embed = await buildLeaderboardEmbed(guildId, guild);
    const rows  = buildLeaderboardRows(interaction.user.id);
    return interaction.editReply({ embeds: [embed], components: [rows] });
  }
}

// ==================== HANDLER INTERACTIONS (boutons + userselect) ====================

async function handleStatsMatchInteraction(interaction) {
  const { customId } = interaction;
  const guildId      = interaction.guildId;
  const guild        = interaction.guild;

  // ── Refresh classement (met à jour l'embed de base en place) ──
  if (customId.startsWith('statsmatch_refresh_classement_')) {
    const ownerId = customId.split('_').pop();
    if (interaction.user.id !== ownerId)
      return interaction.reply({ content: "❌ Ce n'est pas ta vue.", flags: MessageFlags.Ephemeral });
    await interaction.deferUpdate();
    const embed = await buildLeaderboardEmbed(guildId, guild);
    const rows  = buildLeaderboardRows(ownerId);
    return interaction.editReply({ embeds: [embed], components: [rows] });
  }

  // ── Ouvrir sélecteur joueur → réponse éphémère, l'embed de base ne bouge pas ──
  if (customId.startsWith('statsmatch_open_player_')) {
    const ownerId = customId.split('_').pop();
    if (interaction.user.id !== ownerId)
      return interaction.reply({ content: "❌ Ce n'est pas ta vue.", flags: MessageFlags.Ephemeral });

    // On répond en éphémère sans toucher à l'embed de base (pas de deferUpdate)
    const embed = new EmbedBuilder()
      .setTitle('🔍 Recherche d\'un joueur')
      .setDescription('Sélectionnez un membre pour voir sa fiche de statistiques détaillées.')
      .setColor(PSG_BLUE)
      .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });
    const rows = [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`statsmatch_select_player_${ownerId}`)
          .setPlaceholder('👤 Choisir un joueur...')
          .setMinValues(1).setMaxValues(1),
      ),
    ];
    return interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
  }

  // ── Sélection joueur (UserSelectMenu) → réponse éphémère ──
  if (customId.startsWith('statsmatch_select_player_')) {
    const ownerId    = customId.split('_').pop();
    if (interaction.user.id !== ownerId)
      return interaction.reply({ content: "❌ Ce n'est pas ta vue.", flags: MessageFlags.Ephemeral });

    await interaction.deferUpdate();
    const targetUser = interaction.users?.first();
    if (!targetUser)
      return interaction.editReply({ content: '❌ Membre introuvable.', embeds: [], components: [] });

    const embed = await buildPlayerStatsEmbed(guildId, targetUser.id, guild);
    const rows  = [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`statsmatch_select_player_${ownerId}`)
          .setPlaceholder('👤 Voir un autre joueur...')
          .setMinValues(1).setMaxValues(1),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`statsmatch_refresh_player_${targetUser.id}_${ownerId}`)
          .setLabel('🔄 Actualiser cette fiche')
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
    return interaction.editReply({ embeds: [embed], components: rows });
  }

  // ── Refresh fiche joueur (dans le message éphémère) ──
  if (customId.startsWith('statsmatch_refresh_player_')) {
    const parts    = customId.split('_');
    const ownerId  = parts[parts.length - 1];
    const targetId = parts[parts.length - 2];
    if (interaction.user.id !== ownerId)
      return interaction.reply({ content: "❌ Ce n'est pas ta vue.", flags: MessageFlags.Ephemeral });

    await interaction.deferUpdate();
    const embed = await buildPlayerStatsEmbed(guildId, targetId, guild);
    const rows  = [
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(`statsmatch_select_player_${ownerId}`)
          .setPlaceholder('👤 Voir un autre joueur...')
          .setMinValues(1).setMaxValues(1),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`statsmatch_refresh_player_${targetId}_${ownerId}`)
          .setLabel('🔄 Actualiser cette fiche')
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
    return interaction.editReply({ embeds: [embed], components: rows });
  }
}

module.exports = {
  statsMatchCommand,
  handleStatsMatchInteraction,
  buildLeaderboardEmbed,
  buildPlayerStatsEmbed,
};