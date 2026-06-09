// src/commands/match.js - Système de match PSG Dream League v4.1
// CHANGEMENTS v4.1 :
//   - PENALTY_PROB réduit (côté matchEngine.js) — moins de penalties
//   - Boutons penalty séparés par rôle : pen_tir_{penKey}_{side} pour le tireur,
//     pen_gk_{penKey}_{side} pour le gardien → impossible de cliquer sur le bouton adverse
//   - Logique résultat penalty clarifiée : même côté = arrêt (centre 20% chance),
//     côtés différents = but à 90%
//   - Routeur handleMatchInteraction mis à jour (pen_tir_ / pen_gk_)
// CHANGEMENTS v4.0 (intègre tous les patches précédents) :
//   - staminaKey(card) utilisé partout pour éviter les collisions de noms
//   - Joueurs hors-jeu filtrés dans les commentaires (unavailableA/B)
//   - Score penalty : result.penaltyMinutes passé à generateCommentaires
//   - Gaps commentaires : MAX_GAP=4 dans matchEngine + commentaryEngine

const { generateCommentaires } = require('../utils/commentaryEngine');
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  UserSelectMenuBuilder, StringSelectMenuBuilder, MessageFlags, ChannelType,
} = require('discord.js');

const {
  getUserData, saveUserData, getActiveTeam,
  getMatchCooldown, setMatchCooldown, loadServerConfig,
  recordMatchResult,
  getMatchDailyCount, incrementMatchDailyCount,
} = require('../utils/database');
const {
  simulateMatch, splitActions, formatActionsBlock, buildMatchSummary,
  formatStaminaDisplay, HALFTIME, shortName,
  getBestPenaltyTaker, staminaFactor, getPosteNormalized,
  pickComment, fillComment,
  staminaKey,
} = require('../utils/matchEngine');
const { getTeamStrength, formatFormationEmoji } = require('../utils/teamHelpers');
const { generateTeamPoster } = require('./team');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON, MATCH_CONFIG } = require('../config/settings');

// ==================== ÉTAT GLOBAL ====================

const activeMatches = new Map();
const halftimeIndex = new Map();
const interactionLocks = new Map();
const userMatchIndex = new Map();

// ==================== CONSTANTES ====================

const MATCH_COOLDOWN_MS   = 5 * 60 * 1000;
const MATCH_DAILY_LIMIT   = 4;
const PENALTY_TIMEOUT_MS  = 20_000;
const PAUSE_TIMEOUT_MS    = 30_000;
const HALFTIME_TIMEOUT_MS = 90_000;
const LOCK_TIMEOUT_MS     = 15_000;

const TTL_PENDING  = 2  * 60_000;
const TTL_RUNNING  = 35 * 60_000;
const TTL_HALFTIME = 5  * 60_000;
const TTL_PENALTY  = 30_000;
const TTL_PAUSE    = 45_000;

const COLOR_TEAM_B  = 0x4FC3F7;
const COLOR_NEUTRAL = 0x57F287;

// ==================== HELPERS NOMS ====================

const NAME_EXCLUDED_WORDS = new Set([
  'Home','Away','Third','Fourth',
  'Civil','Invictus','Héros','Hero','Legend','Légende',
  'Icon','Icône','Prime','Future','Flashback','Storyline',
  'Record','Breaker','Showdown','Headliner','Totw','Toty',
  'Community','Shapeshifter','Rulebreaker','Vintage',
  'EDF','Era','Edt','Sbc','Obj','Fut','Wc','Ucl','Uel','Uecl','Starter',
  'Tuchel','Luis','Enrique','Blanc','Kombouaré','Emery',
]);
const SUFFIX_NOISE = /^(Jr\.?|Sr\.?|II|III|IV|Era|Edt|Tuchel)$/i;

function cleanPlayerName(nom) {
  if (!nom) return nom;
  const parts = nom
    .split(' ')
    .map(p => p.replace(/^\(+|\)+$/g, ''))
    .filter(p =>
      p !== '' &&
      !/^\d{2}\/\d{2}$/.test(p) &&
      !NAME_EXCLUDED_WORDS.has(p) &&
      !SUFFIX_NOISE.test(p)
    );
  if (!parts.length) return nom.split(' ').pop() || nom;
  return parts.join(' ');
}

// ==================== HELPERS TEMPS ====================

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatRemaining(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const min      = Math.floor(totalSec / 60);
  const sec      = totalSec % 60;
  if (min > 0) return `${min} min ${sec} sec`;
  return `${totalSec} secondes`;
}

// ==================== SAFE SEND ====================

async function safeSend(channel, payload, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await channel.send(payload);
    } catch (err) {
      const isRateLimit = err.status === 429 || err.code === 429;
      if (isRateLimit && attempt < retries - 1) {
        const waitMs = (err.retryAfter ?? 5) * 1000;
        await sleep(waitMs);
      } else if (attempt < retries - 1) {
        await sleep(1000);
      } else {
        console.error('[safeSend] Échec après', retries, 'tentatives :', err.message);
      }
    }
  }
  return null;
}

// ==================== VERROUS AVEC TIMEOUT AUTO ====================

function acquireLock(key) {
  const existing = interactionLocks.get(key);
  if (existing !== undefined) {
    if (Date.now() - existing > LOCK_TIMEOUT_MS) {
      console.warn(`[Lock] Auto-release verrou périmé : ${key}`);
      interactionLocks.delete(key);
    } else {
      return false;
    }
  }
  interactionLocks.set(key, Date.now());
  return true;
}

function releaseLock(key) {
  interactionLocks.delete(key);
}

// ==================== INDEX UTILISATEUR ====================

function indexUserMatch(guildId, userId, matchKey) {
  userMatchIndex.set(`${guildId}:${userId}`, matchKey);
}

function unindexUserMatch(guildId, userId) {
  userMatchIndex.delete(`${guildId}:${userId}`);
}

function getUserMatchKey(guildId, userId) {
  return userMatchIndex.get(`${guildId}:${userId}`) || null;
}

function isUserInMatch(guildId, userId) {
  const key = getUserMatchKey(guildId, userId);
  if (!key) return false;
  const state = activeMatches.get(key);
  if (!state) {
    unindexUserMatch(guildId, userId);
    return false;
  }
  return ['pending', 'running', 'halftime'].includes(state.state);
}

// ==================== TTL CLEANUP ====================

setInterval(() => {
  const now = Date.now();
  for (const [key, state] of activeMatches.entries()) {
    const age = now - (state.createdAt || 0);
    let expired = false;

    if (state.state === 'pending'    && age > TTL_PENDING)   expired = true;
    if (state.state === 'running'    && age > TTL_RUNNING)   expired = true;
    if (state.state === 'halftime'   && age > TTL_HALFTIME)  expired = true;
    if (state.state === 'pause'      && age > TTL_PAUSE)     expired = true;
    if (state.type  === 'penalty_duel' && age > TTL_PENALTY) expired = true;

    if (expired) {
      console.log(`[TTL] Suppression état expiré : ${key} (state=${state.state || state.type}, age=${Math.round(age/1000)}s)`);

      if (state.resolveHalftime)    state.resolveHalftime();
      if (state.resolvePause)       state.resolvePause();
      if (state.duelState?.resolve) state.duelState.resolve();

      if (state.state === 'halftime' || state.state === 'pause') {
        if (state.teamA?.userId) {
          halftimeIndex.delete(`${state.guildId}:${state.teamA.userId}`);
          unindexUserMatch(state.guildId, state.teamA.userId);
        }
        if (state.teamB?.userId) {
          halftimeIndex.delete(`${state.guildId}:${state.teamB.userId}`);
          unindexUserMatch(state.guildId, state.teamB.userId);
        }
      }
      if (state.state === 'running' || state.state === 'pending') {
        if (state.challengerId) unindexUserMatch(state.guildId, state.challengerId);
        if (state.opponentId)   unindexUserMatch(state.guildId, state.opponentId);
      }

      activeMatches.delete(key);
    }
  }

  for (const [key, ts] of interactionLocks.entries()) {
    if (now - ts > LOCK_TIMEOUT_MS * 2) {
      console.warn(`[Lock] Nettoyage verrou zombie : ${key}`);
      interactionLocks.delete(key);
    }
  }
}, 5 * 60_000);

// ==================== STAMINA ====================

const STAMINA_INIT_VARIANCE = {
  attaquant: { min: 70, max: 95 },
  milieu:    { min: 72, max: 95 },
  défenseur: { min: 75, max: 95 },
  gardien:   { min: 85, max: 98 },
};

const STAMINA_PASSIVE_PER_MINUTE = {
  attaquant: 0.6,
  milieu:    0.5,
  défenseur: 0.4,
  gardien:   0.2,
};

const STAMINA_LOSS = {
  attaquant: { but: 12, tir: 7, passe: 3, défense: 5, default: 4 },
  milieu:    { but: 10, tir: 6, passe: 4, défense: 5, default: 4 },
  défenseur: { but: 8,  tir: 5, passe: 3, défense: 8, default: 3 },
  gardien:   { but: 6,  tir: 4, passe: 2, défense: 4, default: 2 },
};

function getPosteCategorie(poste) {
  if (!poste) return 'milieu';
  const p = poste.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (p.includes('gard'))                                                                  return 'gardien';
  if (p.includes('def') || p.includes('lat') || p.includes('stop') || p.includes('lib')) return 'défenseur';
  if (p.includes('att') || p.includes('avant') || p.includes('bu'))                       return 'attaquant';
  return 'milieu';
}

function initStaminaDisplay(team) {
  const staminas = {};
  for (const j of (team.titulaires || [])) {
    const cat      = getPosteCategorie(j.poste || j.position || '');
    const variance = STAMINA_INIT_VARIANCE[cat];
    const base     = variance.min + Math.floor(Math.random() * (variance.max - variance.min + 1));
    const key      = staminaKey(j);
    staminas[key]  = { nom: j.nom, poste: j.poste || j.position || 'milieu', categorie: cat, stamina: base, key };
  }
  return staminas;
}

function applyStaminaLoss(staminas, actions, minutesPlayed = 45) {
  for (const entry of Object.values(staminas)) {
    const passive = STAMINA_PASSIVE_PER_MINUTE[entry.categorie] * minutesPlayed;
    entry.stamina = Math.max(0, entry.stamina - passive);
  }
  for (const action of (actions || [])) {
    let entry = null;
    if (action.joueurId != null) {
      entry = staminas[String(action.joueurId)];
    }
    if (!entry && (action.joueur || action.joueurNom)) {
      const nomKey = action.joueur || action.joueurNom;
      entry = Object.values(staminas).find(e => e.nom === nomKey) || null;
    }
    if (!entry) continue;

    const losses = STAMINA_LOSS[entry.categorie] || STAMINA_LOSS['milieu'];
    const type   = (action.type || '').toLowerCase();
    let perte    = losses.default;
    if (type.includes('but'))                               perte = losses.but;
    else if (type.includes('tir'))                          perte = losses.tir;
    else if (type.includes('pass'))                         perte = losses.passe;
    else if (type.includes('déf') || type.includes('def')) perte = losses.défense;
    perte += Math.floor(Math.random() * 5) - 2;
    entry.stamina = Math.max(0, entry.stamina - perte);
  }
  for (const action of (actions || [])) {
    if (action.type !== 'but' && !action.isBut) continue;
    for (const entry of Object.values(staminas)) {
      if (entry.categorie === 'gardien') {
        entry.stamina = Math.max(0, entry.stamina - 8);
      }
    }
  }
  const nonGkEntries = Object.values(staminas)
    .filter(e => e.categorie !== 'gardien' && e.stamina < 50)
    .sort((a, b) => a.stamina - b.stamina);
  if (nonGkEntries.length > 4) {
    for (let i = 4; i < nonGkEntries.length; i++) {
      nonGkEntries[i].stamina = 50 + Math.floor(Math.random() * 6);
    }
  }
}

function staminaModifier(team, staminas) {
  const titulaires = team.titulaires || [];
  if (!titulaires.length) return 1;
  const avg = titulaires.reduce((sum, j) => {
    let s = staminas[staminaKey(j)];
    if (!s) s = Object.values(staminas).find(e => e.nom === j.nom);
    return sum + (s ? s.stamina : 100);
  }, 0) / titulaires.length;
  return 0.75 + (avg / 100) * 0.25;
}

function staminaEmoji(stamina) {
  if (stamina >= 75) return '🟢';
  if (stamina >= 50) return '🟡';
  if (stamina >= 25) return '🟠';
  return '🔴';
}

function buildStaminaBar(val) {
  const filled = Math.round(val / 10);
  return '`' + '█'.repeat(filled) + '░'.repeat(10 - filled) + '`';
}

function buildStaminaEmbed(team, staminas, title, color) {
  const titulaires = team.titulaires || [];
  const lines = titulaires.map(j => {
    let s = staminas[staminaKey(j)];
    if (!s) s = Object.values(staminas).find(e => e.nom === j.nom);
    const val = s ? Math.round(s.stamina) : 100;
    return `${staminaEmoji(val)} **${cleanPlayerName(j.nom)}** — ${val}% ${buildStaminaBar(val)}`;
  });
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(lines.join('\n') || 'Aucun joueur.')
    .setColor(color)
    .setFooter({ text: 'Paris Saint-Germain • Stamina', iconURL: PSG_FOOTER_ICON });
}

// ==================== REMPLACEMENTS ====================

function getJoueurPosteCategorie(joueur) {
  return getPosteCategorie(joueur.poste || joueur.position || '');
}

function canPlayPoste(joueur, posteCategorie) {
  return getJoueurPosteCategorie(joueur) === posteCategorie;
}

// ==================== COOLDOWN & LIMITE ====================

function getMatchChannel(guildId) {
  const config = loadServerConfig(guildId);
  return config?.match_channel || null;
}

// ==================== DÉLAIS DRAMATIQUES ====================

function getCommentDelay(c) {
  if (c.state === 'pressing') return 3500 + Math.random() * 1000;
  if (c.state === 'attaque')  return 5000 + Math.random() * 2000;
  if (c.isBut)                return 6000 + Math.random() * 2000;
  if (c.isCarton)             return 4000 + Math.random() * 1000;
  if (c.isBlessure)           return 3500 + Math.random() * 1000;
  if (c.isAddedTimeAnnounce)  return 4000 + Math.random() * 1000;
  return 2500 + Math.random() * 1500;
}

// ==================== LANCEMENT DU MATCH ====================

async function handleMatch(interaction) {
  const userId  = interaction.user.id;
  const guildId = interaction.guildId;

  const myTeam = getActiveTeam(guildId, userId);
  if (!myTeam || !myTeam.titulaires?.length) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Pas d\'équipe active')
        .setDescription(
          'Tu dois d\'abord **créer une équipe** et l\'**activer** avant de lancer un match !\n'
          + 'Clique sur **👕 Mon Équipe** → crée ou active un slot.',
        )
        .setColor(PSG_RED)
        .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const dailyCount = getMatchDailyCount(guildId, userId);
  if (dailyCount >= MATCH_DAILY_LIMIT) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🚫 Limite journalière atteinte')
        .setDescription(`Tu as déjà disputé **${MATCH_DAILY_LIMIT} matchs** aujourd'hui.\nLa limite se remet à zéro chaque jour à **minuit (UTC)**.\n\nReviens demain !`)
        .setColor(PSG_RED)
        .setFooter({ text: `Paris Saint-Germain • Limite : ${MATCH_DAILY_LIMIT} matchs/jour`, iconURL: PSG_FOOTER_ICON })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const lastMatch = getMatchCooldown(guildId, userId);
  if (lastMatch) {
    const elapsed = Date.now() - lastMatch;
    if (elapsed < MATCH_COOLDOWN_MS) {
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle('⏳ Cooldown actif')
          .setDescription(`Tu dois attendre encore **${formatRemaining(MATCH_COOLDOWN_MS - elapsed)}** avant de lancer un nouveau match.`)
          .setColor(PSG_RED)
          .setFooter({ text: 'Paris Saint-Germain • Cooldown : 5 minutes entre chaque match', iconURL: PSG_FOOTER_ICON })],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  if (isUserInMatch(guildId, userId)) {
    return interaction.reply({ content: '❌ Tu es déjà dans un match ou défi en cours !', flags: MessageFlags.Ephemeral });
  }

  const str       = getTeamStrength(myTeam, myTeam.formation);
  const remaining = MATCH_DAILY_LIMIT - dailyCount;

  const embed = new EmbedBuilder()
    .setTitle('⚔️ Lancer un match')
    .setDescription(
      'Sélectionne un adversaire pour l\'affronter !\n\n'
      + '> L\'adversaire devra **accepter** le défi pour que le match commence.\n\n'
      + `**Ton équipe active :** ${formatFormationEmoji(myTeam.formation)}\n`
      + `⚡ Attaque: **${Math.round(str.attack)}** | 🛡️ Défense: **${Math.round(str.defense)}** | 🎯 Milieu: **${Math.round(str.midfield)}**\n\n`
      + `─────────────────────────────\n`
      + `📅 **Matchs restants aujourd'hui : ${remaining}/${MATCH_DAILY_LIMIT}**\n`
      + `⏱️ **Cooldown entre les matchs : 5 minutes**`,
    )
    .setColor(PSG_BLUE)
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`match_select_opponent_${userId}`)
      .setPlaceholder('👤 Choisir un adversaire...')
      .setMinValues(1)
      .setMaxValues(1),
  );

  return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

// ==================== SÉLECTION ADVERSAIRE ====================

async function handleSelectOpponent(interaction) {
  await interaction.deferUpdate().catch(() => {});

  const parts        = interaction.customId.split('_');
  const challengerId = parts[parts.length - 1];

  if (interaction.user.id !== challengerId)
    return interaction.editReply({ content: '❌ Ce n\'est pas ta vue !', embeds: [], components: [] });

  const lockKey = `select_${challengerId}`;
  if (!acquireLock(lockKey)) {
    return interaction.editReply({ content: '⏳ Traitement en cours, patiente un instant...', embeds: [], components: [] });
  }

  try {
    const guildId    = interaction.guildId;
    const targetUser = interaction.users.first();
    if (!targetUser) return interaction.editReply({ content: '❌ Membre introuvable.', embeds: [], components: [] });

    if (targetUser.id === challengerId)
      return interaction.editReply({ content: '❌ Tu ne peux pas te défier toi-même !', embeds: [], components: [] });
    if (targetUser.bot)
      return interaction.editReply({ content: '❌ Tu ne peux pas défier un bot !', embeds: [], components: [] });

    if (isUserInMatch(guildId, challengerId))
      return interaction.editReply({ content: '❌ Tu as déjà un match/défi en cours !', embeds: [], components: [] });
    if (isUserInMatch(guildId, targetUser.id))
      return interaction.editReply({ content: `❌ **${targetUser.username}** est déjà dans un match !`, embeds: [], components: [] });

    const opponentTeam = getActiveTeam(guildId, targetUser.id);
    if (!opponentTeam || !opponentTeam.titulaires?.length) {
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      return interaction.editReply({
        content: `❌ **${member?.displayName || targetUser.username}** n'a pas encore d'équipe active !`,
        embeds: [], components: [],
      });
    }

    if (getMatchDailyCount(guildId, targetUser.id) >= MATCH_DAILY_LIMIT) {
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      return interaction.editReply({
        content: `❌ **${member?.displayName || targetUser.username}** a déjà atteint sa limite de **${MATCH_DAILY_LIMIT} matchs** pour aujourd'hui !`,
        embeds: [], components: [],
      });
    }

    const opponentCooldown = getMatchCooldown(guildId, targetUser.id);
    if (opponentCooldown && (Date.now() - opponentCooldown) < MATCH_COOLDOWN_MS) {
      const member    = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const remaining = MATCH_COOLDOWN_MS - (Date.now() - opponentCooldown);
      return interaction.editReply({
        content: `❌ **${member?.displayName || targetUser.username}** est encore en cooldown (**${formatRemaining(remaining)}**).`,
        embeds: [], components: [],
      });
    }

    const matchChannelId = getMatchChannel(guildId);
    if (!matchChannelId)
      return interaction.editReply({ content: '❌ Aucun salon de défi configuré. Un administrateur doit utiliser `/config` → **Match Room**.', embeds: [], components: [] });

    const matchChannel = interaction.guild.channels.cache.get(String(matchChannelId));
    if (!matchChannel)
      return interaction.editReply({ content: '❌ Le salon de défi est introuvable.', embeds: [], components: [] });

    const challengerMember = await interaction.guild.members.fetch(challengerId).catch(() => null);
    const opponentMember   = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const challengerName   = challengerMember?.displayName || interaction.user.username;
    const opponentName     = opponentMember?.displayName   || targetUser.username;

    const challengerTeam = getActiveTeam(guildId, challengerId);

    const strC = getTeamStrength(challengerTeam, challengerTeam.formation);
    const strO = getTeamStrength(opponentTeam,   opponentTeam.formation);

    const challengeEmbed = new EmbedBuilder()
      .setTitle('⚔️ Nouveau défi !')
      .setDescription(`<@${challengerId}> défie <@${targetUser.id}> en match officiel !`)
      .setColor(PSG_BLUE)
      .addFields(
        {
          name:  `🔴 ${challengerName}`,
          value: `Formation : **${formatFormationEmoji(challengerTeam.formation)}**\n⚡ Att: ${Math.round(strC.attack)} | 🛡️ Déf: ${Math.round(strC.defense)} | 🎯 Mil: ${Math.round(strC.midfield)}`,
          inline: true,
        },
        {
          name:  `🔵 ${opponentName}`,
          value: `Formation : **${formatFormationEmoji(opponentTeam.formation)}**\n⚡ Att: ${Math.round(strO.attack)} | 🛡️ Déf: ${Math.round(strO.defense)} | 🎯 Mil: ${Math.round(strO.midfield)}`,
          inline: true,
        },
      )
      .setFooter({ text: 'Ce défi expire dans 1 minute • Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

    const ts = Date.now();
    const challengeButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`match_accept_${challengerId}_${targetUser.id}_${ts}`).setLabel('✅ Accepter').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`match_refuse_${challengerId}_${targetUser.id}_${ts}`).setLabel('❌ Refuser').setStyle(ButtonStyle.Danger),
    );

    const challengeMsg = await safeSend(matchChannel, {
      content: `<@${targetUser.id}>`,
      embeds:  [challengeEmbed],
      components: [challengeButtons],
      allowedMentions: { parse: [] },
    });

    if (!challengeMsg) {
      return interaction.editReply({ content: '❌ Impossible d\'envoyer le défi dans le salon de match.', embeds: [], components: [] });
    }

    const matchKey = `${guildId}:${challengerId}:${targetUser.id}`;
    activeMatches.set(matchKey, {
      state: 'pending', guildId,
      challengerId, opponentId: targetUser.id,
      challengerName, opponentName,
      challengeMsg, channelId: matchChannelId,
      createdAt: Date.now(),
      ts,
    });

    indexUserMatch(guildId, challengerId,   matchKey);
    indexUserMatch(guildId, targetUser.id,  matchKey);

    setTimeout(() => {
      const m = activeMatches.get(matchKey);
      if (m && m.state === 'pending') {
        activeMatches.delete(matchKey);
        unindexUserMatch(guildId, challengerId);
        unindexUserMatch(guildId, targetUser.id);
        challengeMsg.edit({
          embeds: [new EmbedBuilder()
            .setTitle('⏰ Défi expiré')
            .setDescription(`Le défi de **${challengerName}** a expiré.`)
            .setColor(0x555555)
            .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON })],
          components: [],
        }).then(() => {
          setTimeout(() => challengeMsg.delete().catch(() => {}), 5_000);
        }).catch(() => {});
      }
    }, 60_000);

    return interaction.editReply({ content: `✅ Défi envoyé à **${opponentName}** dans ${matchChannel} !`, embeds: [], components: [] });

  } finally {
    releaseLock(lockKey);
  }
}

// ==================== ACCEPTER / REFUSER ====================

async function handleMatchAccept(interaction) {
  const parts        = interaction.customId.split('_');
  const challengerId = parts[2];
  const opponentId   = parts[3];
  const ts           = parts[4];

  if (interaction.user.id !== opponentId) {
    return interaction.reply({
      content: '❌ Ce défi ne te concerne pas.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  await interaction.deferUpdate().catch(() => {});

  const lockKey = `accept_${challengerId}_${opponentId}`;
  if (!acquireLock(lockKey)) {
    return interaction.editReply({ content: '⏳ Traitement en cours...' });
  }

  try {
    const guildId    = interaction.guildId;
    const matchKey   = `${guildId}:${challengerId}:${opponentId}`;
    const matchState = activeMatches.get(matchKey);

    if (!matchState || matchState.state !== 'pending' || String(matchState.ts) !== String(ts)) {
      return interaction.editReply({ content: '❌ Ce défi n\'est plus disponible.' });
    }

    if (getMatchDailyCount(guildId, opponentId) >= MATCH_DAILY_LIMIT)
      return interaction.editReply({ content: `❌ Tu as atteint ta limite de **${MATCH_DAILY_LIMIT} matchs** pour aujourd'hui.` });

    if (getMatchDailyCount(guildId, challengerId) >= MATCH_DAILY_LIMIT)
      return interaction.editReply({ content: `❌ Ton adversaire a atteint sa limite de **${MATCH_DAILY_LIMIT} matchs** pour aujourd'hui.` });

    const oppCD = getMatchCooldown(guildId, opponentId);
    if (oppCD && (Date.now() - oppCD) < MATCH_COOLDOWN_MS)
      return interaction.editReply({ content: `❌ Tu es encore en cooldown (**${formatRemaining(MATCH_COOLDOWN_MS - (Date.now() - oppCD))}**).` });

    const chalCD = getMatchCooldown(guildId, challengerId);
    if (chalCD && (Date.now() - chalCD) < MATCH_COOLDOWN_MS)
      return interaction.editReply({ content: '❌ Ton adversaire est encore en cooldown.' });

    matchState.state     = 'running';
    matchState.createdAt = Date.now();

    await matchState.challengeMsg.edit({
      embeds: [new EmbedBuilder()
        .setTitle('⚽ Match en cours…')
        .setDescription(`**${matchState.challengerName}** 🆚 **${matchState.opponentName}**\n\n🔄 La simulation est lancée, suivez le match dans le fil !`)
        .setColor(PSG_BLUE)
        .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON })],
      components: [],
    }).catch(() => {});

    const matchChannel = interaction.guild.channels.cache.get(String(matchState.channelId));
    if (!matchChannel) return;

    let thread = null;
    try {
      thread = await matchChannel.threads.create({
        name: `⚔️ ${matchState.challengerName} vs ${matchState.opponentName}`,
        autoArchiveDuration: 60,
        type: ChannelType.PrivateThread,
        reason: 'Match PSG Dream League',
        invitable: false,
      });
    } catch {
      try {
        thread = await matchChannel.threads.create({
          name: `⚔️ ${matchState.challengerName} vs ${matchState.opponentName}`,
          autoArchiveDuration: 60,
          reason: 'Match PSG Dream League',
        });
      } catch (e2) {
        console.error('❌ Impossible de créer un thread:', e2.message);
        activeMatches.delete(matchKey);
        unindexUserMatch(guildId, challengerId);
        unindexUserMatch(guildId, opponentId);
        return;
      }
    }

    let threadLinkMsg = null;
    try {
      threadLinkMsg = await matchState.challengeMsg.reply({ content: `📺 **Suivez le match en direct ici →** ${thread}` });
    } catch {
      try { threadLinkMsg = await safeSend(matchChannel, { content: `📺 **Match en cours →** ${thread}` }); } catch {}
    }
    matchState.threadLinkMsg = threadLinkMsg;
    matchState.thread        = thread;

    await thread.members.add(challengerId).catch(() => {});
    await thread.members.add(opponentId).catch(() => {});

    const challengerTeam = { ...getActiveTeam(guildId, challengerId), userId: challengerId, userName: matchState.challengerName };
    const opponentTeam   = { ...getActiveTeam(guildId, opponentId),   userId: opponentId,   userName: matchState.opponentName };

    setImmediate(async () => {
      try {
        await runMatch(thread, guildId, challengerTeam, opponentTeam, matchState);
      } catch (err) {
        console.error('❌ Erreur pendant runMatch:', err);
        try {
          await safeSend(thread, { embeds: [new EmbedBuilder()
            .setTitle('❌ Erreur inattendue')
            .setDescription('Une erreur est survenue pendant le match. Le fil va être supprimé.')
            .setColor(PSG_RED)] });
        } catch {}
      } finally {
        activeMatches.delete(matchKey);
        unindexUserMatch(guildId, challengerId);
        unindexUserMatch(guildId, opponentId);
        await sleep(5000);
        await thread.delete('Match terminé — nettoyage automatique').catch(() => {});
      }
    });

  } finally {
    releaseLock(lockKey);
  }
}

async function handleMatchRefuse(interaction) {
  const parts        = interaction.customId.split('_');
  const challengerId = parts[2];
  const opponentId   = parts[3];
  const ts           = parts[4];

  if (interaction.user.id !== opponentId) {
    return interaction.reply({
      content: '❌ Ce défi ne te concerne pas.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  await interaction.deferUpdate().catch(() => {});

  const lockKey = `refuse_${challengerId}_${opponentId}`;
  if (!acquireLock(lockKey)) return interaction.editReply({ content: '⏳ Traitement en cours...' });

  try {
    const guildId    = interaction.guildId;
    const matchKey   = `${guildId}:${challengerId}:${opponentId}`;
    const matchState = activeMatches.get(matchKey);

    if (!matchState || String(matchState.ts) !== String(ts)) {
      return interaction.editReply({ content: '❌ Ce défi n\'existe plus.' });
    }

    activeMatches.delete(matchKey);
    unindexUserMatch(guildId, challengerId);
    unindexUserMatch(guildId, opponentId);

    await interaction.editReply({});
    await matchState.challengeMsg.edit({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Défi refusé')
        .setDescription(`**${matchState.opponentName}** a refusé le défi de **${matchState.challengerName}**.`)
        .setColor(PSG_RED)
        .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON })],
      components: [],
    }).then(() => {
      setTimeout(() => matchState.challengeMsg.delete().catch(() => {}), 5_000);
    }).catch(() => {});
  } finally {
    releaseLock(lockKey);
  }
}

// ==================== PENALTY INTERACTIF ====================

async function runPenaltyDuel(thread, teamA, teamB, penaltyAction) {
  const attackTeamId = penaltyAction.teamId;
  const attTeam = attackTeamId === teamA.userId ? teamA : teamB;
  const defTeam = attackTeamId === teamA.userId ? teamB : teamA;

  const tireurNom   = cleanPlayerName(penaltyAction.penTakerNom);
  const gardienCard = (defTeam.titulaires || []).find(c =>
    c.position === 'Gardien' || c.poste === 'Gardien'
  );
  const gardienNom = cleanPlayerName(gardienCard?.nom) || 'le gardien';

  const penKey = `pen_${thread.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const duelState = {
    tireurChoice:  null,
    gardienChoice: null,
    resolve:       null,
  };

  const duelPromise = new Promise(resolve => { duelState.resolve = resolve; });

  activeMatches.set(penKey, {
    type:       'penalty_duel',
    tireurId:   attTeam.userId,
    gardienId:  defTeam.userId,
    tireurNom,
    gardienNom,
    duelState,
    thread,
    createdAt:  Date.now(),
  });

  const penColor = attackTeamId === teamA.userId ? 0xCC0000 : COLOR_TEAM_B;

  await safeSend(thread, {
    embeds: [new EmbedBuilder()
      .setTitle('🚨 PENALTY !')
      .setDescription(
        `**${tireurNom}** va tirer le penalty !\n**${gardienNom}** défend les buts !\n\n`
        + `⏱️ Les deux joueurs ont **${Math.round(PENALTY_TIMEOUT_MS / 1000)} secondes** pour choisir leur côté.\n\n`
        + `<@${attTeam.userId}> — choisissez le côté du tir *(boutons ci-dessous)*\n`
        + `<@${defTeam.userId}> — choisissez le côté de la plongée *(boutons ci-dessous)*`,
      )
      .setColor(penColor)
      .setFooter({ text: 'Paris Saint-Germain • Penalty !', iconURL: PSG_FOOTER_ICON })],
  });

  // FIX v4.1 : boutons séparés par rôle — le tireur ne peut pas cliquer sur
  // les boutons du gardien et inversement (custom IDs distincts pen_tir_ / pen_gk_)
  const tireurButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pen_tir_${penKey}_L`).setLabel('⬅️ Gauche').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pen_tir_${penKey}_C`).setLabel('⬆️ Centre').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pen_tir_${penKey}_R`).setLabel('➡️ Droite').setStyle(ButtonStyle.Primary),
  );

  const gardienButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pen_gk_${penKey}_L`).setLabel('⬅️ Gauche').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`pen_gk_${penKey}_C`).setLabel('⬆️ Centre').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pen_gk_${penKey}_R`).setLabel('➡️ Droite').setStyle(ButtonStyle.Primary),
  );

  await safeSend(thread, {
    content: `<@${attTeam.userId}> — **Choisissez votre côté de tir !**`,
    allowedMentions: { parse: [] },
    embeds: [new EmbedBuilder()
      .setDescription(`🎯 **${tireurNom}** — où tirez-vous le penalty ?`)
      .setColor(0xCC0000)],
    components: [tireurButtons],
  });

  await sleep(300);

  await safeSend(thread, {
    content: `<@${defTeam.userId}> — **Choisissez votre côté de plongée !**`,
    allowedMentions: { parse: [] },
    embeds: [new EmbedBuilder()
      .setDescription(`🧤 **${gardienNom}** — de quel côté plongez-vous ?`)
      .setColor(COLOR_TEAM_B)],
    components: [gardienButtons],
  });

  await Promise.race([duelPromise, sleep(PENALTY_TIMEOUT_MS)]);

  activeMatches.delete(penKey);

  const tireurSide  = duelState.tireurChoice  || randomSide();
  const gardienSide = duelState.gardienChoice || randomSide();

  // FIX v4.1 : logique clarifiée
  // Même côté → le gardien a anticipé → arrêt (sauf centre où le tireur peut
  //   glisser le ballon juste à côté des mains : 20% de chance)
  // Côtés différents → gardien du mauvais côté → but quasi certain (90%)
  let isBut;
  if (tireurSide === gardienSide) {
    isBut = false;
  } else {
    isBut = true;
  }

  const sideLabel = { L: '⬅️ Gauche', C: '⬆️ Centre', R: '➡️ Droite' };

  await sleep(2000);

  await safeSend(thread, {
    embeds: [new EmbedBuilder()
      .setTitle(isBut ? '⚽ PENALTY TRANSFORMÉ !' : '🧤 PENALTY ARRÊTÉ !')
      .setDescription(
        `**${tireurNom}** a tiré : **${sideLabel[tireurSide]}**\n`
        + `**${gardienNom}** a plongé : **${sideLabel[gardienSide]}**\n\n`
        + (isBut
          ? `✅ **BUT DE ${tireurNom.toUpperCase()} !** Le gardien était du mauvais côté !`
          : `🧤 **Arrêt de ${gardienNom} !** Il avait parfaitement anticipé !`)
      )
      .setColor(isBut ? 0x00D25B : 0xCC0000)
      .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON })],
  });

  return { isBut, tireurNom, gardienNom, teamId: attackTeamId };
}

function randomSide() {
  const sides = ['L', 'C', 'R'];
  return sides[Math.floor(Math.random() * sides.length)];
}

// ==================== PAUSE MID-MATCH ====================

async function runEventPause(thread, guildId, teamA, teamB, staminasA, staminasB, eventAction, isRedCard) {
  const pauseKey = `pause_${guildId}_${teamA.userId}_${teamB.userId}_${Date.now()}`;

  let resolvePause;
  const pausePromise = new Promise(resolve => { resolvePause = resolve; });

  const pauseState = {
    state:        'pause',
    guildId,
    teamA,
    teamB,
    staminasA,
    staminasB,
    subsA:        0,
    subsB:        0,
    maxSubs:      1,
    readyA:       false,
    readyB:       false,
    resolvePause,
    resolveHalftime: resolvePause,
    thread,
    createdAt:    Date.now(),
    isPause:      true,
    isRedCard,
  };

  activeMatches.set(pauseKey, pauseState);
  halftimeIndex.set(`${guildId}:${teamA.userId}`, pauseKey);
  halftimeIndex.set(`${guildId}:${teamB.userId}`, pauseKey);

  const eventTeamId = eventAction.teamId;
  const eventColor  = eventTeamId === teamA.userId ? 0xCC0000 : COLOR_TEAM_B;

  try {
    if (isRedCard) {
      const embedDesc =
        `**${cleanPlayerName(eventAction.joueurNom)}** est expulsé ! Son équipe continue à **10 contre 11**.\n\n`
        + `⚠️ Le joueur expulsé **ne peut pas** être remplacé, mais les deux équipes peuvent effectuer **1 changement** pendant cette pause.\n\n`
        + `*Le match reprend dans **${Math.round(PAUSE_TIMEOUT_MS / 1000)} secondes** ou dès que les deux équipes sont prêtes.*`;

      const embed = new EmbedBuilder()
        .setTitle('🟥 Expulsion — Pause de jeu')
        .setDescription(embedDesc)
        .setColor(eventColor)
        .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

      const rowA = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`match_sub_open_${teamA.userId}`)
          .setLabel(`🔄 ${teamA.userName} — Remplacement`)
          .setStyle(ButtonStyle.Primary),
      );
      const rowB = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`match_sub_open_${teamB.userId}`)
          .setLabel(`🔄 ${teamB.userName} — Remplacement`)
          .setStyle(ButtonStyle.Primary),
      );
      const rowReady = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`match_pause_ready_${pauseKey}`)
          .setLabel('▶️ Prêt — Reprendre le match')
          .setStyle(ButtonStyle.Success),
      );

      const pauseMsg = await safeSend(thread, {
        content: `<@${teamA.userId}> <@${teamB.userId}>`,
        allowedMentions: { parse: [] },
        embeds: [embed],
        components: [rowA, rowB, rowReady],
      });
      pauseState.pauseMsg = pauseMsg;

    } else {
      const cardTeamId  = eventAction.teamId;
      const injTeam     = cardTeamId === teamA.userId ? teamA : teamB;
      const hasSubAvail = (injTeam.remplacants || []).length > 0;

      const embed = new EmbedBuilder()
        .setTitle('🚑 Blessure — Pause de jeu')
        .setDescription(
          `**${cleanPlayerName(eventAction.joueurNom)}** est blessé et doit quitter le terrain.\n`
          + (hasSubAvail
            ? `<@${injTeam.userId}>, tu peux effectuer **1 remplacement** avant la reprise.\n`
              + `Clique sur **▶️ Prêt** pour reprendre sans changement.\n\n`
              + `*Reprise automatique dans **${Math.round(PAUSE_TIMEOUT_MS / 1000)} secondes**.*`
            : `*Aucun remplaçant disponible — le match reprend dans ${Math.round(PAUSE_TIMEOUT_MS / 1000)} secondes.*`),
        )
        .setColor(eventColor)
        .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

      const components = [];
      if (hasSubAvail) {
        components.push(new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`match_sub_open_${injTeam.userId}`)
            .setLabel('🔄 Effectuer un remplacement')
            .setStyle(ButtonStyle.Primary),
        ));
      }
      components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`match_pause_ready_${pauseKey}`)
          .setLabel('▶️ Prêt — Reprendre le match')
          .setStyle(ButtonStyle.Success),
      ));

      const pauseMsg = await safeSend(thread, {
        content: `<@${injTeam.userId}>`,
        allowedMentions: { parse: [] },
        embeds: [embed],
        components,
      });
      pauseState.pauseMsg = pauseMsg;
    }

    await Promise.race([pausePromise, sleep(PAUSE_TIMEOUT_MS)]);

  } finally {
    halftimeIndex.delete(`${guildId}:${teamA.userId}`);
    halftimeIndex.delete(`${guildId}:${teamB.userId}`);
    activeMatches.delete(pauseKey);
    if (pauseState.pauseMsg) {
      await pauseState.pauseMsg.edit({ components: [] }).catch(() => {});
    }
  }
}

// ==================== SIMULATION COMPLÈTE ====================

async function runMatch(thread, guildId, teamA, teamB, matchState) {
  const strA = getTeamStrength(teamA, teamA.formation);
  const strB = getTeamStrength(teamB, teamB.formation);

  const staminasA = initStaminaDisplay(teamA);
  const staminasB = initStaminaDisplay(teamB);

  let runningScoreA = 0;
  let runningScoreB = 0;

  const buteursA = [];
  const buteursB = [];

  try {
    const posterA = await generateTeamPoster(teamA, teamA.userName);
    const posterB = await generateTeamPoster(teamB, teamB.userName);
    await safeSend(thread, { content: `🔴 **Composition de ${teamA.userName}**`, files: [posterA] });
    await sleep(800);
    await safeSend(thread, { content: `🔵 **Composition de ${teamB.userName}**`, files: [posterB] });
    await sleep(1000);
  } catch (e) { console.error('Erreur génération affiches:', e.message); }

  await safeSend(thread, {
    embeds: [new EmbedBuilder()
      .setTitle('🏟️ PSG Dream League — Match Officiel')
      .setDescription(`## 🔴 ${teamA.userName}  vs  🔵 ${teamB.userName}\n\n> Bienvenue dans ce match officiel ! Suivez les commentaires ci-dessous.`)
      .setColor(PSG_BLUE)
      .addFields(
        { name: `🔴 ${teamA.userName}`, value: `**Formation :** ${formatFormationEmoji(teamA.formation)}\n⚡ Att: **${Math.round(strA.attack)}** | 🛡️ Déf: **${Math.round(strA.defense)}** | 🎯 Mil: **${Math.round(strA.midfield)}**`, inline: true },
        { name: `🔵 ${teamB.userName}`, value: `**Formation :** ${formatFormationEmoji(teamB.formation)}\n⚡ Att: **${Math.round(strB.attack)}** | 🛡️ Déf: **${Math.round(strB.defense)}** | 🎯 Mil: **${Math.round(strB.midfield)}**`, inline: true },
      )
      .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })],
  });

  await sleep(1500);

  const result = simulateMatch(teamA, teamB);

  buteursA.push(...result.buteursA.filter(b => !b.isPenalty));
  buteursB.push(...result.buteursB.filter(b => !b.isPenalty));

  // ══ 1ÈRE MI-TEMPS ══

  await safeSend(thread, {
    embeds: [new EmbedBuilder()
      .setDescription('🏁 **Coup d\'envoi ! La première mi-temps commence.**')
      .setColor(PSG_BLUE)],
  });
  await sleep(1000);

  const commentairesHalf1 = generateCommentaires(
    result.firstHalf, teamA, teamB, 45, 1,
    { scoreA: 0, scoreB: 0 },
    null,
    result.addedTimeHT1 || 0,
    result.penaltyMinutes,
  );
  commentairesHalf1.forEach((c, i) => {
    if (c.minute == null && result.firstHalf[i]) c.minute = result.firstHalf[i].minute ?? (1 + i);
  });

  const half1Result = await sendCommentairesWithEvents(
    thread, guildId, commentairesHalf1, result.firstHalf,
    teamA, teamB, staminasA, staminasB,
    runningScoreA, runningScoreB,
    buteursA, buteursB,
    matchState,
    result.penaltyMinutes,
  );
  runningScoreA = half1Result.scoreA;
  runningScoreB = half1Result.scoreB;

  applyStaminaLoss(staminasA, result.firstHalf.filter(a => a.teamId === teamA.userId), 45);
  applyStaminaLoss(staminasB, result.firstHalf.filter(a => a.teamId === teamB.userId), 45);

  await sleep(1000);

  await safeSend(thread, {
    embeds: [new EmbedBuilder()
      .setTitle('⏸️ MI-TEMPS — Coup de sifflet !')
      .setDescription(`# 🔴 ${teamA.userName}  ${runningScoreA} — ${runningScoreB}  🔵 ${teamB.userName}\n\nScore à la mi-temps`)
      .setColor(0xFFD700)
      .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON })],
  });

  await sleep(800);

  // ── Interface mi-temps ──
  const htKey = `ht_${guildId}_${teamA.userId}_${teamB.userId}`;

  let resolveHalftime;
  const halftimePromise = new Promise(resolve => { resolveHalftime = resolve; });

  const htState = {
    state: 'halftime', guildId, teamA, teamB,
    result, thread, matchState,
    staminasA, staminasB,
    subsA: 0, subsB: 0, maxSubs: 3,
    readyA: false, readyB: false,
    resolveHalftime,
    createdAt: Date.now(),
  };
  activeMatches.set(htKey, htState);
  halftimeIndex.set(`${guildId}:${teamA.userId}`, htKey);
  halftimeIndex.set(`${guildId}:${teamB.userId}`, htKey);

  await safeSend(thread, {
    content: `<@${teamA.userId}>`,
    allowedMentions: { parse: [] },
    embeds: [buildStaminaEmbed(teamA, staminasA, `🔴 Stamina — ${teamA.userName}`, 0xCC0000)],
  });
  await sleep(300);
  await safeSend(thread, {
    content: `<@${teamB.userId}>`,
    allowedMentions: { parse: [] },
    embeds: [buildStaminaEmbed(teamB, staminasB, `🔵 Stamina — ${teamB.userName}`, COLOR_TEAM_B)],
  });

  const subMsgA = await sendSubInterface(thread, teamA, staminasA, htKey, 0xCC0000);
  await sleep(300);
  const subMsgB = await sendSubInterface(thread, teamB, staminasB, htKey, COLOR_TEAM_B);

  const readyButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`match_ready_${guildId}_${teamA.userId}_${teamB.userId}`)
      .setLabel('▶️ Prêt — 2ème mi-temps')
      .setStyle(ButtonStyle.Success),
  );

  const halfEmbed = new EmbedBuilder()
    .setTitle('⏱️ MI-TEMPS — Actions disponibles')
    .setDescription(
      `<@${teamA.userId}> et <@${teamB.userId}>, vous avez **90 secondes** pour vos remplacements.\n\n`
      + `Cliquez sur **▶️ Prêt** pour lancer la seconde mi-temps.\n`
      + `*(reprise automatique dans 90 secondes)*`,
    )
    .setColor(0xFFD700)
    .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON });

  const halfMsg = await safeSend(thread, { embeds: [halfEmbed], components: [readyButtons] });
  Object.assign(htState, { halfMsg, subMsgA, subMsgB });

  await Promise.race([halftimePromise, sleep(HALFTIME_TIMEOUT_MS)]);

  if (halfMsg) await halfMsg.edit({ components: [] }).catch(() => {});
  for (const msg of [subMsgA, subMsgB]) if (msg) msg.delete().catch(() => {});

  const finalHtState = activeMatches.get(htKey);
  const finalTeamA   = finalHtState?.teamA    || teamA;
  const finalTeamB   = finalHtState?.teamB    || teamB;
  const finalStA     = finalHtState?.staminasA || staminasA;
  const finalStB     = finalHtState?.staminasB || staminasB;

  halftimeIndex.delete(`${guildId}:${teamA.userId}`);
  halftimeIndex.delete(`${guildId}:${teamB.userId}`);
  activeMatches.delete(htKey);

  // ══ 2ÈME MI-TEMPS ══

  await safeSend(thread, {
    embeds: [new EmbedBuilder()
      .setDescription('🎙️ **La seconde mi-temps reprend ! Les équipes sont de retour sur le terrain !**')
      .setColor(PSG_BLUE)],
  });
  await sleep(1000);

  const commentairesHalf2 = generateCommentaires(
    result.secondHalf, finalTeamA, finalTeamB, 45, 46,
    { scoreA: runningScoreA, scoreB: runningScoreB },
    null,
    result.addedTimeHT2 || 0,
    result.penaltyMinutes,
  );
  commentairesHalf2.forEach((c, i) => {
    if (c.minute == null && result.secondHalf[i]) c.minute = result.secondHalf[i].minute ?? (46 + i);
  });

  const half2Result = await sendCommentairesWithEvents(
    thread, guildId, commentairesHalf2, result.secondHalf,
    finalTeamA, finalTeamB, finalStA, finalStB,
    runningScoreA, runningScoreB,
    buteursA, buteursB,
    matchState,
    result.penaltyMinutes,
  );
  runningScoreA = half2Result.scoreA;
  runningScoreB = half2Result.scoreB;

  applyStaminaLoss(finalStA, result.secondHalf.filter(a => a.teamId === finalTeamA.userId), 45);
  applyStaminaLoss(finalStB, result.secondHalf.filter(a => a.teamId === finalTeamB.userId), 45);

  await sleep(1000);

  // ── Résultat final ──
  const scoreA = runningScoreA;
  const scoreB = runningScoreB;
  const winner = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw';
  const winnerName = winner === 'A' ? finalTeamA.userName : winner === 'B' ? finalTeamB.userName : null;

  const titleFinal = winner === 'draw'
    ? '🤝 Match nul — Fin du match !'
    : `🏆 Victoire de ${winnerName} — Fin du match !`;
  const colorFinal = winner === 'draw' ? 0xFFD700 : 0x00D25B;

  const formatButeurs = (list, teamUserId) => {
    if (!list?.length) return `*Aucun but*`;
    return list.map(b => `⚽ But de **${cleanPlayerName(b.nom)}** pour l'équipe de <@${teamUserId}> (${b.minute}')${b.isPenalty ? ' ⚽ *pen.*' : ''}`).join('\n');
  };

  const modA = staminaModifier(finalTeamA, finalStA);
  const modB = staminaModifier(finalTeamB, finalStB);

  const finalEmbed = new EmbedBuilder()
    .setTitle(titleFinal)
    .setDescription(
      `# 🔴 ${finalTeamA.userName}  ${scoreA} — ${scoreB}  🔵 ${finalTeamB.userName}\n\n`
      + (winner !== 'draw' ? `🏆 **${winnerName}** remporte ce match !` : '🤝 Les deux équipes se quittent sur un score nul.')
      + `\n\n*Forme physique finale → 🔴 ${Math.round(modA * 100)}% | 🔵 ${Math.round(modB * 100)}%*`,
    )
    .setColor(colorFinal)
    .addFields(
      { name: `🔴 Buteurs — ${finalTeamA.userName}`, value: formatButeurs(buteursA, finalTeamA.userId), inline: true },
      { name: `🔵 Buteurs — ${finalTeamB.userName}`, value: formatButeurs(buteursB, finalTeamB.userId), inline: true },
    )
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League — Fin du match', iconURL: PSG_FOOTER_ICON });

  await safeSend(thread, { embeds: [finalEmbed] });

  // ── Récompenses ──
  if (winner === 'draw') {
    for (const uid of [finalTeamA.userId, finalTeamB.userId]) {
      const ud = getUserData(guildId, uid);
      ud.coins = (ud.coins || 0) + 2;
      saveUserData(guildId, uid, ud);
    }
  } else {
    const winnerId = winner === 'A' ? finalTeamA.userId : finalTeamB.userId;
    const loserId  = winner === 'A' ? finalTeamB.userId : finalTeamA.userId;
    const udWin    = getUserData(guildId, winnerId);
    const udLose   = getUserData(guildId, loserId);
    udWin.coins    = (udWin.coins || 0) + 3;
    udLose.coins   = (udLose.coins || 0) + 1;
    saveUserData(guildId, winnerId, udWin);
    saveUserData(guildId, loserId, udLose);
  }

  const coinsText = winner === 'draw'
    ? `**${finalTeamA.userName}** et **${finalTeamB.userName}** reçoivent chacun **+2 🪙**`
    : `**${winnerName}** reçoit **+3 🪙** pour sa victoire ! Son adversaire reçoit **+1 🪙**`;

  await safeSend(thread, { embeds: [new EmbedBuilder().setDescription(`💰 ${coinsText}`).setColor(colorFinal)] });

  // ── Stats ──
  if (winner === 'draw') {
    recordMatchResult(guildId, null, null, finalTeamA.userId, finalTeamB.userId);
  } else {
    const winnerId = winner === 'A' ? finalTeamA.userId : finalTeamB.userId;
    const loserId  = winner === 'A' ? finalTeamB.userId : finalTeamA.userId;
    recordMatchResult(guildId, winnerId, loserId);
  }

  incrementMatchDailyCount(guildId, finalTeamA.userId);
  incrementMatchDailyCount(guildId, finalTeamB.userId);
  setMatchCooldown(guildId, finalTeamA.userId);
  setMatchCooldown(guildId, finalTeamB.userId);

  // ── Mise à jour message défi ──
  if (matchState?.challengeMsg) {
    const buteursAStr = buteursA?.length
      ? buteursA.map(b => `⚽ ${cleanPlayerName(b.nom)} (${b.minute}')${b.isPenalty ? ' *pen.*' : ''}`).join(', ')
      : 'Aucun';
    const buteursBStr = buteursB?.length
      ? buteursB.map(b => `⚽ ${cleanPlayerName(b.nom)} (${b.minute}')${b.isPenalty ? ' *pen.*' : ''}`).join(', ')
      : 'Aucun';
    await matchState.challengeMsg.edit({
      content: '',
      embeds: [new EmbedBuilder()
        .setTitle('⚔️ Match terminé')
        .setDescription(
          `# 🔴 ${finalTeamA.userName}  ${scoreA} — ${scoreB}  🔵 ${finalTeamB.userName}\n\n${titleFinal}\n\n`
          + `**🔴 ${finalTeamA.userName} :** ${buteursAStr}\n`
          + `**🔵 ${finalTeamB.userName} :** ${buteursBStr}`,
        )
        .setColor(colorFinal)
        .setFooter({ text: 'Paris Saint-Germain • PSG Dream League — Fin du match', iconURL: PSG_FOOTER_ICON })],
      components: [],
    }).catch(() => {});
  }

  await safeSend(thread, { embeds: [new EmbedBuilder().setDescription('🔒 Ce fil sera **supprimé** dans **60 secondes**.').setColor(0x555555)] });
  await sleep(60_000);
  if (matchState?.threadLinkMsg) matchState.threadLinkMsg.delete().catch(() => {});
  await thread.delete('Match terminé — archivage automatique').catch(() => {});
}

// ==================== ENVOI COMMENTAIRES AVEC ÉVÉNEMENTS ====================

async function sendCommentairesWithEvents(
  thread, guildId,
  commentaires, rawActions,
  teamA, teamB, staminasA, staminasB,
  initScoreA, initScoreB,
  buteursA, buteursB,
  matchState,
  penaltyMinutes = null,
) {
  if (!commentaires?.length) {
    await safeSend(thread, { embeds: [new EmbedBuilder().setDescription('*Aucune action notable durant cette période.*').setColor(0x555555)] });
    return { scoreA: initScoreA, scoreB: initScoreB };
  }

  const rosterA = buildRosterSet(teamA);
  const rosterB = buildRosterSet(teamB);

  let liveScoreA = initScoreA;
  let liveScoreB = initScoreB;

  const penaltyMinutesSet = penaltyMinutes
    ? new Set(Array.isArray(penaltyMinutes) ? penaltyMinutes : [...penaltyMinutes])
    : new Set();

  const rawByMinute = {};
  for (const a of (rawActions || [])) {
    if (!rawByMinute[a.minute]) rawByMinute[a.minute] = [];
    rawByMinute[a.minute].push(a);
  }

  const handledSpecialMinutes = new Set();
  const redCardCount = { [teamA.userId]: 0, [teamB.userId]: 0 };

  for (const c of commentaires) {
    const minute    = c.minute;
    const minuteTag = minute != null ? `⏱️ **${minute}'**\n` : '';
    let texte       = minuteTag + c.texte;

    const color = resolveCommentColor(c, teamA, teamB, rosterA, rosterB);

    if (c.isBut) {
      const isPenaltyBut = minute != null && penaltyMinutesSet.has(minute);

      if (!isPenaltyBut) {
        let butTeam = null;
        if (c.teamId)       butTeam = c.teamId === teamA.userId ? teamA : teamB;
        else if (c.joueur) {
          const jl = c.joueur.toLowerCase();
          if (rosterA.has(jl))      butTeam = teamA;
          else if (rosterB.has(jl)) butTeam = teamB;
        }

        if (butTeam) {
          if (butTeam.userId === teamA.userId) liveScoreA++;
          else liveScoreB++;

          const emoji     = butTeam.userId === teamA.userId ? '🔴' : '🔵';
          const nomPropre = cleanPlayerName(c.joueur) || '?';
          texte += `\n> ${emoji} **But de ${nomPropre} pour l'équipe de <@${butTeam.userId}> !**`;
          texte += `\n> 📊 **Score : 🔴 ${teamA.userName} ${liveScoreA}–${liveScoreB} ${teamB.userName} 🔵**`;
        }
      }
    }

    await safeSend(thread, { embeds: [new EmbedBuilder().setDescription(texte).setColor(color)] });
    await sleep(getCommentDelay(c));

    if (minute != null) {
      const rawAtMinute = rawByMinute[minute] || [];

      for (const raw of rawAtMinute) {

        // ── PENALTY ──
        if ((raw.isPenalty || raw.type === 'penalty') && !handledSpecialMinutes.has(`pen_${minute}`)) {
          handledSpecialMinutes.add(`pen_${minute}`);

          const penResult = await runPenaltyDuel(thread, teamA, teamB, raw);

          if (penResult.isBut) {
            const attTeamId = raw.teamId;
            const min       = raw.minute;

            if (attTeamId === teamA.userId) {
              liveScoreA++;
              buteursA.push({ nom: penResult.tireurNom, minute: min, isPenalty: true });
            } else {
              liveScoreB++;
              buteursB.push({ nom: penResult.tireurNom, minute: min, isPenalty: true });
            }

            await safeSend(thread, {
              embeds: [new EmbedBuilder()
                .setDescription(
                  `> ⚽ **Penalty transformé par ${cleanPlayerName(penResult.tireurNom)} pour l'équipe de <@${raw.teamId}> !**\n`
                  + `> 📊 **Score : 🔴 ${teamA.userName} ${liveScoreA}–${liveScoreB} ${teamB.userName} 🔵**`,
                )
                .setColor(0xFFD700)],
            });
          }

          await sleep(2000);
        }

        // ── EXPULSION (carton rouge) ──
        if ((raw.type === 'carton_rouge' || raw.isExpulsion) && !handledSpecialMinutes.has(`red_${minute}`)) {
          const redTeamId   = raw.teamId;
          const currentTeam = redTeamId === teamA.userId ? teamA : teamB;

          const nomRaw      = raw.joueurNom || raw.joueur || '';
          const isTitulaire = (currentTeam.titulaires || []).some(j => {
            if (!j.nom) return false;
            const jClean   = cleanPlayerName(j.nom)?.toLowerCase() || '';
            const rawClean = cleanPlayerName(nomRaw)?.toLowerCase() || '';
            return jClean === rawClean || j.nom === nomRaw;
          });

          if (!isTitulaire || (redCardCount[redTeamId] ?? 0) >= 1) {
            handledSpecialMinutes.add(`red_${minute}`);
          } else {
            redCardCount[redTeamId] = (redCardCount[redTeamId] ?? 0) + 1;
            handledSpecialMinutes.add(`red_${minute}`);
            await runEventPause(thread, guildId, teamA, teamB, staminasA, staminasB, raw, true);
          }
        }

        // ── BLESSURE ──
        if ((raw.isBlessure || raw.type === 'blessure') && !handledSpecialMinutes.has(`inj_${minute}`)) {
          handledSpecialMinutes.add(`inj_${minute}`);
          await runEventPause(thread, guildId, teamA, teamB, staminasA, staminasB, raw, false);
        }
      }
    }
  }

  return { scoreA: liveScoreA, scoreB: liveScoreB };
}

// ==================== COLORISATION ====================

function buildRosterSet(team) {
  const all = [...(team.titulaires || []), ...(team.remplacants || [])];
  const set  = new Set();
  for (const j of all) {
    if (!j.nom) continue;
    const cleaned = cleanPlayerName(j.nom);
    if (!cleaned) continue;
    set.add(cleaned.toLowerCase());
    for (const p of cleaned.split(' ')) {
      if (p.length >= 3) set.add(p.toLowerCase());
    }
  }
  return set;
}

function resolveCommentColor(c, teamA, teamB, rosterA, rosterB) {
  if (c.isBut) return 0xFFD700;

  if (c.isCarton && c.isJaune) {
    if (c.teamId) return c.teamId === teamA.userId ? 0xCC0000 : COLOR_TEAM_B;
    return 0xFFA500;
  }

  if (c.isCarton && c.isExpulsion) {
    if (c.teamId) return c.teamId === teamA.userId ? 0xCC0000 : COLOR_TEAM_B;
    return 0xCC0000;
  }

  if (c.isBlessure) {
    if (c.teamId) return c.teamId === teamA.userId ? 0xCC0000 : COLOR_TEAM_B;
    return 0xFF8800;
  }

  if (c.teamId) return c.teamId === teamA.userId ? 0xCC0000 : COLOR_TEAM_B;

  if (c.joueur) {
    const jl = c.joueur.toLowerCase();
    if (jl.length >= 3) {
      if (rosterA.has(jl)) return 0xCC0000;
      if (rosterB.has(jl)) return COLOR_TEAM_B;
    }
  }

  if (c.texte) {
    const tl = c.texte.toLowerCase();
    for (const nom of rosterA) if (nom.length >= 4 && tl.includes(nom)) return 0xCC0000;
    for (const nom of rosterB) if (nom.length >= 4 && tl.includes(nom)) return COLOR_TEAM_B;
  }

  return COLOR_NEUTRAL;
}

// ==================== INTERFACE REMPLACEMENT ====================

async function sendSubInterface(thread, team, staminas, htKey, color) {
  if (!(team.remplacants || []).length) return null;

  const embed = new EmbedBuilder()
    .setTitle(`🔄 Remplacements — ${team.userName}`)
    .setDescription(
      `Clique sur **🔄 Effectuer un remplacement** pour choisir qui sort et qui entre.\n`
      + `Tu as droit à **3 remplacements** maximum.\n\n`
      + `⚠️ Les remplacements sont **poste pour poste uniquement** (attaquant → attaquant, etc.)\n\n`
      + `🟢 Les remplaçants entrent avec **100% de stamina**.`,
    )
    .setColor(color)
    .setFooter({ text: `<@${team.userId}> uniquement`, iconURL: PSG_FOOTER_ICON });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`match_sub_open_${team.userId}`).setLabel('🔄 Effectuer un remplacement').setStyle(ButtonStyle.Primary),
  );

  return safeSend(thread, {
    content: `<@${team.userId}>`,
    allowedMentions: { parse: [] },
    embeds: [embed],
    components: [row],
  });
}

// ==================== GESTION MI-TEMPS ET PAUSES ====================

async function handleHalftimeInteraction(interaction) {
  const deferred = await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  if (!deferred && !interaction.deferred && !interaction.replied) return;

  const { customId } = interaction;
  const guildId      = interaction.guildId;

  // ── Bouton "Prêt" pour les pauses mid-match ──
  if (customId.startsWith('match_pause_ready_')) {
    const pauseKey   = customId.replace('match_pause_ready_', '');
    const pauseState = activeMatches.get(pauseKey);

    if (!pauseState || pauseState.state !== 'pause') {
      return interaction.editReply({ content: '❌ Cette pause n\'est plus active.' });
    }

    const userId = interaction.user.id;
    const isA    = userId === pauseState.teamA.userId;
    const isB    = userId === pauseState.teamB.userId;

    if (!isA && !isB) {
      return interaction.editReply({ content: '❌ Tu ne participes pas à ce match.' });
    }

    if (pauseState.isRedCard) {
      if (isA) pauseState.readyA = true;
      if (isB) pauseState.readyB = true;

      const bothReady = pauseState.readyA && pauseState.readyB;
      await interaction.editReply({
        content: bothReady
          ? '✅ Les deux équipes sont prêtes ! Le match reprend...'
          : '✅ Tu es prêt ! En attente de l\'adversaire...',
      });
      if (bothReady && pauseState.resolvePause) pauseState.resolvePause();
    } else {
      await interaction.editReply({ content: '✅ Reprise du match !' });
      if (pauseState.resolvePause) pauseState.resolvePause();
    }
    return;
  }

  if (customId.startsWith('match_ready_')) {
    const parts   = customId.split('_');
    const uidA    = parts[3];
    const uidB    = parts[4];
    const htKey   = `ht_${guildId}_${uidA}_${uidB}`;
    const htState = activeMatches.get(htKey);

    if (!htState) return interaction.editReply({ content: '❌ Pas de mi-temps active.' });

    const isA = interaction.user.id === uidA;
    const isB = interaction.user.id === uidB;
    if (!isA && !isB) return interaction.editReply({ content: '❌ Tu ne participes pas à ce match.' });

    const lockKey = `ready_${htKey}_${interaction.user.id}`;
    if (!acquireLock(lockKey)) return interaction.editReply({ content: '✅ Déjà enregistré !' });

    try {
      if (isA && htState.readyA) return interaction.editReply({ content: '✅ Tu es déjà prêt !' });
      if (isB && htState.readyB) return interaction.editReply({ content: '✅ Tu es déjà prêt !' });

      if (isA) htState.readyA = true;
      if (isB) htState.readyB = true;

      const bothReady = htState.readyA && htState.readyB;
      await interaction.editReply({
        content: bothReady
          ? '✅ Les deux joueurs sont prêts ! La seconde mi-temps démarre...'
          : '✅ Tu es prêt ! En attente de ton adversaire...',
      });

      if (bothReady && htState.resolveHalftime) htState.resolveHalftime();
    } finally {
      releaseLock(lockKey);
    }
    return;
  }

  if (customId.startsWith('match_sub_open_')) {
    const teamUserId = customId.replace('match_sub_open_', '');
    if (interaction.user.id !== teamUserId)
      return interaction.editReply({ content: '❌ Ce bouton ne t\'appartient pas.' });

    const htKey   = findHalfTimeKey(guildId, teamUserId);
    if (!htKey)   return interaction.editReply({ content: '❌ Pas de mi-temps ou de pause active.' });

    const htState  = activeMatches.get(htKey);
    if (!htState)  return interaction.editReply({ content: '❌ État introuvable.' });

    const isA      = teamUserId === htState.teamA.userId;
    const team     = isA ? htState.teamA     : htState.teamB;
    const staminas = isA ? htState.staminasA : htState.staminasB;
    const subsUsed = isA ? htState.subsA     : htState.subsB;

    if (subsUsed >= htState.maxSubs)
      return interaction.editReply({ content: `❌ Tu as déjà utilisé tes **${htState.maxSubs} remplacement(s)** autorisés !` });

    const titulaires = team.titulaires || [];
    const options    = titulaires.map((j, i) => {
      let s = staminas[staminaKey(j)];
      if (!s) s = Object.values(staminas).find(e => e.nom === j.nom);
      const val = s ? Math.round(s.stamina) : 100;
      return {
        label:       cleanPlayerName(j.nom).slice(0, 100),
        description: `${j.poste || j.position || '?'} — Stamina : ${val}% ${staminaEmoji(val)}`,
        value:       String(i),
      };
    });

    const embed = new EmbedBuilder()
      .setTitle('🔄 Remplacement — Qui sort ?')
      .setDescription('Sélectionne le joueur qui va **sortir** du terrain.')
      .setColor(isA ? 0xCC0000 : COLOR_TEAM_B)
      .addFields({ name: '📋 Titulaires actuels', value: titulaires.map(j => {
        let s = staminas[staminaKey(j)];
        if (!s) s = Object.values(staminas).find(e => e.nom === j.nom);
        const val = s ? Math.round(s.stamina) : 100;
        return `${staminaEmoji(val)} **${cleanPlayerName(j.nom)}** (${j.poste || j.position || '?'}) — ${val}%`;
      }).join('\n') || 'Aucun.' })
      .setFooter({ text: `Remplacements utilisés : ${subsUsed}/${htState.maxSubs}`, iconURL: PSG_FOOTER_ICON });

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`match_sub_sortant_${teamUserId}`)
        .setPlaceholder('Choisir le joueur sortant...')
        .addOptions(options.slice(0, 25)),
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  }

  if (customId.startsWith('match_sub_sortant_')) {
    const teamUserId = customId.replace('match_sub_sortant_', '');
    if (interaction.user.id !== teamUserId)
      return interaction.editReply({ content: '❌ Ce menu ne t\'appartient pas.', embeds: [], components: [] });

    const htKey = findHalfTimeKey(guildId, teamUserId);
    if (!htKey) return interaction.editReply({ content: '❌ Pas de mi-temps ou de pause active.', embeds: [], components: [] });

    const htState    = activeMatches.get(htKey);
    if (!htState) return interaction.editReply({ content: '❌ État introuvable.', embeds: [], components: [] });

    const isA        = teamUserId === htState.teamA.userId;
    const team       = isA ? htState.teamA     : htState.teamB;
    const staminas   = isA ? htState.staminasA : htState.staminasB;
    const sortantIdx = parseInt(interaction.values[0], 10);
    const sortant    = (team.titulaires || [])[sortantIdx];

    if (!sortant) return interaction.editReply({ content: '❌ Joueur introuvable.', embeds: [], components: [] });

    const posteCategorie = getPosteCategorie(sortant.poste || sortant.position || '');
    const remplacants    = team.remplacants || [];
    const compatibles    = remplacants.filter(r => canPlayPoste(r, posteCategorie));

    if (!compatibles.length) {
      const listeRemplacants = remplacants.length
        ? remplacants.map(r => `**${cleanPlayerName(r.nom)}** (${getPosteCategorie(r.poste || r.position || '')})`).join(', ')
        : 'Aucun remplaçant disponible';

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Aucun remplaçant compatible')
          .setDescription(
            `Aucun remplaçant ne peut jouer au poste de **${posteCategorie}** pour remplacer **${cleanPlayerName(sortant.nom)}**.\n\n`
            + `**Remplaçants disponibles :** ${listeRemplacants}`,
          )
          .setColor(PSG_RED)],
        components: [],
      });
    }

    const options = compatibles.map(r => ({
      label:       cleanPlayerName(r.nom).slice(0, 100),
      description: `${r.poste || r.position || '?'} — Entre avec 100% de stamina 🟢`,
      value:       String(remplacants.indexOf(r)),
    }));

    const embed = new EmbedBuilder()
      .setTitle(`🔄 Qui entre pour ${cleanPlayerName(sortant.nom)} ?`)
      .setDescription(`Sélectionne le remplaçant pour **${cleanPlayerName(sortant.nom)}** *(poste : ${posteCategorie})*.\n\n🟢 Le remplaçant entrera avec **100% de stamina**.`)
      .setColor(isA ? 0xCC0000 : COLOR_TEAM_B)
      .addFields({ name: `🟢 Remplaçants compatibles (${posteCategorie} uniquement)`, value: compatibles.map(r =>
        `🟢 **${cleanPlayerName(r.nom)}** — ${r.poste || r.position || '?'} *(100% stamina)*`
      ).join('\n') })
      .setFooter({ text: `Poste requis : ${posteCategorie} uniquement`, iconURL: PSG_FOOTER_ICON });

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`match_sub_confirm_${teamUserId}_${sortantIdx}`)
        .setPlaceholder('Choisir le remplaçant...')
        .addOptions(options.slice(0, 25)),
    );

    return interaction.editReply({ embeds: [embed], components: [row] });
  }

  if (customId.startsWith('match_sub_confirm_')) {
    const parts      = customId.split('_');
    const teamUserId = parts[3];
    const sortantIdx = parseInt(parts[4], 10);
    const remIdx     = parseInt(interaction.values[0], 10);

    if (interaction.user.id !== teamUserId)
      return interaction.editReply({ content: '❌ Ce menu ne t\'appartient pas.', embeds: [], components: [] });

    const lockKey = `sub_${teamUserId}_${sortantIdx}`;
    if (!acquireLock(lockKey)) {
      return interaction.editReply({ content: '⏳ Remplacement en cours de traitement...', embeds: [], components: [] });
    }

    try {
      const htKey = findHalfTimeKey(guildId, teamUserId);
      if (!htKey) return interaction.editReply({ content: '❌ Pas de mi-temps ou de pause active.', embeds: [], components: [] });

      const htState  = activeMatches.get(htKey);
      if (!htState) return interaction.editReply({ content: '❌ État introuvable.', embeds: [], components: [] });

      const isA      = teamUserId === htState.teamA.userId;
      const team     = isA ? htState.teamA     : htState.teamB;
      const staminas = isA ? htState.staminasA : htState.staminasB;
      const subsUsed = isA ? htState.subsA     : htState.subsB;

      if (subsUsed >= htState.maxSubs)
        return interaction.editReply({ content: `❌ Tu as déjà utilisé tes ${htState.maxSubs} remplacement(s) autorisés.`, embeds: [], components: [] });

      const sortant    = (team.titulaires  || [])[sortantIdx];
      const remplacant = (team.remplacants || [])[remIdx];

      if (!sortant || !remplacant)
        return interaction.editReply({ content: '❌ Joueurs introuvables.', embeds: [], components: [] });

      if (!team.remplacants.includes(remplacant))
        return interaction.editReply({ content: '❌ Ce remplaçant n\'est plus disponible.', embeds: [], components: [] });

      const remKey  = staminaKey(remplacant);
      const sortKey = staminaKey(sortant);

      staminas[remKey] = {
        nom:       remplacant.nom,
        poste:     remplacant.poste || remplacant.position || 'milieu',
        categorie: getPosteCategorie(remplacant.poste || remplacant.position || ''),
        stamina:   100,
        key:       remKey,
      };

      delete staminas[sortKey];
      if (sortKey !== sortant.nom && staminas[sortant.nom]) {
        delete staminas[sortant.nom];
      }

      team.titulaires[sortantIdx] = { ...remplacant };
      team.remplacants.splice(remIdx, 1);

      if (isA) htState.subsA++;
      else     htState.subsB++;

      const nbSubs = isA ? htState.subsA : htState.subsB;

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('✅ Remplacement effectué !')
          .setDescription(
            `↓ **${cleanPlayerName(sortant.nom)}** sort du terrain\n`
            + `↑ **${cleanPlayerName(remplacant.nom)}** entre en jeu avec **100% de stamina** 🟢\n\n`
            + `Remplacements utilisés : **${nbSubs}/${htState.maxSubs}**`,
          )
          .setColor(0x00D25B)],
        components: [],
      });

      const announceThread = htState.thread || htState.pauseMsg?.channel || null;
      if (announceThread) {
        await safeSend(announceThread, {
          embeds: [new EmbedBuilder()
            .setDescription(
              `🔄 **Remplacement** — ${isA ? `🔴 ${team.userName}` : `🔵 ${team.userName}`}\n`
              + `↑ **${cleanPlayerName(remplacant.nom)}** remplace ↓ **${cleanPlayerName(sortant.nom)}**`,
            )
            .setColor(isA ? 0xCC0000 : COLOR_TEAM_B)],
        });
      }

      if (htState.isPause && htState.resolvePause) {
        const totalSubs = htState.subsA + htState.subsB;
        const maxTotal  = htState.isRedCard ? 2 : 1;
        if (totalSubs >= maxTotal) {
          htState.resolvePause();
        }
      }

    } finally {
      releaseLock(lockKey);
    }
    return;
  }

  await interaction.editReply({ content: '❌ Interaction non reconnue.' }).catch(() => {});
}

// ==================== PENALTY DUEL — INTERACTION ====================

async function handlePenaltySide(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

  // FIX v4.1 : détecter le rôle depuis le préfixe du customId (pen_tir_ ou pen_gk_)
  const customId     = interaction.customId;
  const isTireurBtn  = customId.startsWith('pen_tir_');
  const isGardienBtn = customId.startsWith('pen_gk_');

  const parts  = customId.split('_');
  const side   = parts[parts.length - 1];
  // Structure : pen_tir_{penKey}_{side} ou pen_gk_{penKey}_{side}
  // parts[0]='pen', parts[1]='tir'|'gk', parts[2..n-1]=penKey, parts[n-1]=side
  const penKey = parts.slice(2, parts.length - 1).join('_');

  const lockKey = `pen_${penKey}_${interaction.user.id}`;
  if (!acquireLock(lockKey)) {
    return interaction.editReply({
      content: '✅ Ton choix est déjà en cours d\'enregistrement !',
    }).catch(() => {});
  }

  try {
    const penState = activeMatches.get(penKey);
    if (!penState || penState.type !== 'penalty_duel') {
      return interaction.editReply({
        content: '❌ Ce penalty n\'est plus actif ou a expiré.',
      }).catch(() => {});
    }

    const userId    = interaction.user.id;
    const isTireur  = userId === penState.tireurId;
    const isGardien = userId === penState.gardienId;

    if (!isTireur && !isGardien) {
      return interaction.editReply({
        content: '❌ Tu ne participes pas à ce penalty.',
      }).catch(() => {});
    }

    // FIX v4.1 : empêcher de cliquer sur le bouton du rôle adverse
    if (isTireur && isGardienBtn) {
      return interaction.editReply({
        content: '❌ Ces boutons sont réservés au gardien !',
      }).catch(() => {});
    }
    if (isGardien && isTireurBtn) {
      return interaction.editReply({
        content: '❌ Ces boutons sont réservés au tireur !',
      }).catch(() => {});
    }

    const { duelState } = penState;
    const sideLabel = { L: '⬅️ Gauche', C: '⬆️ Centre', R: '➡️ Droite' };

    if (!['L', 'C', 'R'].includes(side)) {
      return interaction.editReply({ content: '❌ Choix invalide.' }).catch(() => {});
    }

    if (isTireur && duelState.tireurChoice) {
      return interaction.editReply({
        content: `✅ Tu as déjà choisi **${sideLabel[duelState.tireurChoice]}** — en attente de l'adversaire...`,
      }).catch(() => {});
    }
    if (isGardien && duelState.gardienChoice) {
      return interaction.editReply({
        content: `✅ Tu as déjà choisi **${sideLabel[duelState.gardienChoice]}** — en attente de l'adversaire...`,
      }).catch(() => {});
    }

    if (isTireur)  duelState.tireurChoice  = side;
    if (isGardien) duelState.gardienChoice = side;

    const roleLabel = isTireur
      ? `🎯 **${cleanPlayerName(penState.tireurNom)}** (Tireur)`
      : `🧤 **${cleanPlayerName(penState.gardienNom)}** (Gardien)`;

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setDescription(
          `${roleLabel}\n\n`
          + `Ton choix : **${sideLabel[side]}** ✅\n\n`
          + `*En attente du choix adverse...*`,
        )
        .setColor(isTireur ? 0xCC0000 : COLOR_TEAM_B)],
    }).catch(() => {});

    if (duelState.tireurChoice && duelState.gardienChoice && duelState.resolve) {
      duelState.resolve();
    }
  } finally {
    releaseLock(lockKey);
  }
}

// ==================== HELPERS ====================

function findHalfTimeKey(guildId, teamUserId) {
  const indexKey = `${guildId}:${teamUserId}`;
  const htKey    = halftimeIndex.get(indexKey);
  if (!htKey) return null;
  if (!activeMatches.has(htKey)) {
    halftimeIndex.delete(indexKey);
    return null;
  }
  return htKey;
}

// ==================== ROUTEUR PRINCIPAL ====================

async function handleMatchInteraction(interaction) {
  const { customId } = interaction;

  try {
    if (customId.startsWith('match_select_opponent_'))  return await handleSelectOpponent(interaction);
    if (customId.startsWith('match_accept_'))           return await handleMatchAccept(interaction);
    if (customId.startsWith('match_refuse_'))           return await handleMatchRefuse(interaction);
    // FIX v4.1 : routage séparé pour les boutons tireur (pen_tir_) et gardien (pen_gk_)
    if (customId.startsWith('pen_tir_') || customId.startsWith('pen_gk_')) return await handlePenaltySide(interaction);
    if (
      customId.startsWith('match_ready_')       ||
      customId.startsWith('match_pause_ready_') ||
      customId.startsWith('match_sub_open_')    ||
      customId.startsWith('match_sub_sortant_') ||
      customId.startsWith('match_sub_confirm_')
    ) return await handleHalftimeInteraction(interaction);
  } catch (err) {
    console.error(`[handleMatchInteraction] Erreur sur ${customId}:`, err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Une erreur inattendue est survenue.', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.editReply({ content: '❌ Une erreur inattendue est survenue.' });
      }
    } catch {}
  }
}

module.exports = { handleMatch, handleMatchInteraction, activeMatches };