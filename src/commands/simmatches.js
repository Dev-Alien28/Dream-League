// src/commands/simmatches.js — Simulation de matchs en masse (ADMIN)
// /simmatches
//
// Lance 3 sessions de 30 matchs en parallèle :
//   • Session 1 — Fort (top 0) vs Nul  (overall ~50)
//   • Session 2 — Fort (top 0) vs Moyen (offset 15)
//   • Session 3 — Fort (top 0) vs Légèrement moins fort (offset 3)
//
// Affiche les compos puis le bilan de chaque session.
//
// FIX : runSilentMatch utilisait result.actions qui n'existe pas.
//       simulateMatch retourne firstHalf + secondHalf, pas un tableau actions unifié.
//       Correction : fusion des deux halves + utilisation de result.scoreA/B du moteur.

'use strict';

const { EmbedBuilder, MessageFlags } = require('discord.js');

const { loadServerConfig }                                                                       = require('../utils/database');
const { simulateMatch }                                                                          = require('../utils/matchEngine');
const { getTeamStrength, getRawCardStrength, formatFormationEmoji, FORMATIONS: FORMATIONS_DATA } = require('../utils/teamHelpers');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON, PACKS_DIR }                                         = require('../config/settings');

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────────

const FORMATIONS = Object.keys(FORMATIONS_DATA);
const NB_MATCHS  = 30;

// Les 3 scénarios : [nomA, nomB, offsetA, offsetB, labelSession]
const SCENARIOS = [
  {
    label:   '⚔️ Fort vs Nul',
    nameA:   '⭐ Les Étoiles',
    nameB:   '💀 Les Sacrifiés',
    offsetA: 0,
    modeB:   'dummy',    // overall fixé à ~50 (cartes artificielles)
  },
  {
    label:   '⚔️ Fort vs Moyen',
    nameA:   '⭐ Les Étoiles',
    nameB:   '⚽ Les Moyens',
    offsetA: 0,
    modeB:   'middle',   // milieu du classement
  },
  {
    label:   '⚔️ Fort vs Légèrement moins fort',
    nameA:   '⭐ Les Étoiles',
    nameB:   '🔵 Les Challengers',
    offsetA: 0,
    modeB:   'near-top', // offset 3
  },
];

function getSlotsForFormation(formationKey) {
  return FORMATIONS_DATA[formationKey]?.postes || { Gardien: 1, Défenseur: 4, Milieu: 3, Attaquant: 3 };
}

function randFormation() {
  return FORMATIONS[Math.floor(Math.random() * FORMATIONS.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARGEMENT BDD
// ─────────────────────────────────────────────────────────────────────────────

function loadAllPlayerCards() {
  const cards = { Gardien: [], Défenseur: [], Milieu: [], Attaquant: [] };
  if (!fs.existsSync(PACKS_DIR)) return cards;

  for (const file of fs.readdirSync(PACKS_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, file), 'utf-8'));
      for (const card of list) {
        if (card.type !== 'joueur') continue;
        if (!card.position) continue;
        if (['Give', 'Encounter'].includes(card.rareté)) continue;
        if (cards[card.position] !== undefined) cards[card.position].push(card);
      }
    } catch (e) {
      console.error(`❌ Erreur lecture ${file}:`, e.message);
    }
  }
  return cards;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTION DES ÉQUIPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit une équipe selon un mode :
 *   'top'      → offset 0, meilleures cartes brutes
 *   'near-top' → offset 3
 *   'middle'   → milieu du classement
 *   'dummy'    → cartes artificielles à stats = 50 (overall ~50)
 */
function buildTeam(allCards, formation, teamName, userId, mode) {
  const slots      = getSlotsForFormation(formation);
  const titulaires = [];

  for (const [poste, count] of Object.entries(slots)) {
    let pool = [...(allCards[poste] || [])].sort(
      (a, b) => getRawCardStrength(b) - getRawCardStrength(a),
    );

    let picked;

    if (mode === 'dummy') {
      // Cartes artificielles : on prend les vraies cartes mais on écrase leurs stats
      // pour avoir un overall ~50, sans toucher à la structure attendue par simulateMatch.
      const base = pool.slice(0, count);
      picked = base.map(card => ({
        ...card,
        stats: Object.fromEntries(
          Object.keys(card.stats || {}).map(k => [k, 50])
        ),
      }));
    } else if (mode === 'top') {
      picked = pool.slice(0, count);
    } else if (mode === 'near-top') {
      const offset = 3;
      picked = pool.slice(offset, offset + count);
      if (picked.length < count) picked = [...picked, ...pool.slice(0, count)].slice(0, count);
    } else {
      // middle
      const mid   = Math.floor(pool.length / 2);
      const start = Math.max(0, mid - Math.floor(count / 2));
      picked = pool.slice(start, start + count);
    }

    // Sécurité remplissage
    while (picked.length < count && pool.length > 0)
      picked.push({ ...pool[picked.length % pool.length] });

    for (const card of picked) titulaires.push({ ...card });
  }

  // Remplaçants
  const allPool = Object.values(allCards).flat().sort(
    (a, b) => getRawCardStrength(b) - getRawCardStrength(a),
  );
  const usedIds     = new Set(titulaires.map(c => c.id));
  const subPool     = allPool.filter(c => !usedIds.has(c.id));
  let remplacants;

  if (mode === 'dummy') {
    remplacants = subPool.slice(0, 3).map(card => ({
      ...card,
      stats: Object.fromEntries(Object.keys(card.stats || {}).map(k => [k, 50])),
    }));
  } else if (mode === 'top') {
    remplacants = subPool.slice(0, 3);
  } else if (mode === 'near-top') {
    remplacants = subPool.slice(3, 6);
  } else {
    const mid = Math.floor(subPool.length / 2);
    remplacants = subPool.slice(Math.max(0, mid - 1), mid + 2);
  }

  return { formation, titulaires, remplacants, userId, userName: teamName };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION SILENCIEUSE
//
// FIX : result.actions n'existe pas — simulateMatch retourne firstHalf + secondHalf.
//       On fusionne les deux halves pour les calculs par action (h1A/h1B),
//       et on utilise result.scoreA/B du moteur comme source de vérité pour le score
//       (inclut correctement les penalties transformés).
// ─────────────────────────────────────────────────────────────────────────────

function runSilentMatch(teamA, teamB) {
  const result = simulateMatch(teamA, teamB);

  // ✅ FIX : utiliser result.scoreA/B calculé par le moteur (source de vérité)
  // Évite aussi le problème des penalties dont l'action a type='penalty' et non 'but'
  const scoreA = result.scoreA ?? 0;
  const scoreB = result.scoreB ?? 0;

  // Score mi-temps calculé depuis firstHalf uniquement
  const h1A = (result.firstHalf || []).filter(
    a => a.type === 'but' && a.teamId === teamA.userId
  ).length;
  const h1B = (result.firstHalf || []).filter(
    a => a.type === 'but' && a.teamId === teamB.userId
  ).length;

  return {
    scoreA,
    scoreB,
    h1A,
    h1B,
    winner:   scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : 'draw',
    buteursA: result.buteursA || [],
    buteursB: result.buteursB || [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATAGE
// ─────────────────────────────────────────────────────────────────────────────

function formatCompo(team) {
  const byPoste = {};
  for (const j of team.titulaires) {
    const p = j.position || '?';
    if (!byPoste[p]) byPoste[p] = [];
    byPoste[p].push(`${j.nom} *(${Math.round(getRawCardStrength(j))})*`);
  }
  const lines = [];
  for (const poste of ['Gardien', 'Défenseur', 'Milieu', 'Attaquant']) {
    if (byPoste[poste]?.length)
      lines.push(`**${poste}s :** ${byPoste[poste].join(', ')}`);
  }
  if (team.remplacants?.length) {
    lines.push(`**Remplaçants :** ${team.remplacants.map(j => `${j.nom} *(${Math.round(getRawCardStrength(j))})*`).join(', ')}`);
  }
  return lines.join('\n') || '*Aucun joueur*';
}

function avgOvr(team) {
  return Math.round(
    team.titulaires.reduce((s, j) => s + getRawCardStrength(j), 0) / (team.titulaires.length || 1),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION D'UNE SESSION (30 matchs)
// ─────────────────────────────────────────────────────────────────────────────

function runSession(teamA, teamB, nb) {
  const results = [];
  for (let i = 0; i < nb; i++) {
    try {
      results.push({ matchNum: i + 1, ...runSilentMatch(teamA, teamB) });
    } catch (e) {
      results.push({ matchNum: i + 1, error: e.message });
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD EMBEDS POUR UNE SESSION
// ─────────────────────────────────────────────────────────────────────────────

function buildSessionEmbeds(scenario, teamA, teamB, strA, strB, results) {
  const ovrA = avgOvr(teamA);
  const ovrB = avgOvr(teamB);

  // ── Embed compos ──
  const embedCompos = new EmbedBuilder()
    .setTitle(`${scenario.label} — Compositions`)
    .setColor(PSG_BLUE)
    .addFields(
      {
        name:  `${scenario.nameA} — \`${teamA.formation}\` — Moy. brute: **${ovrA}** — Overall: **${strA.overall}**`,
        value: [`⚡ Att: **${strA.attack}** | 🛡️ Déf: **${strA.defense}** | 🎯 Mil: **${strA.midfield}**`, '', formatCompo(teamA)].join('\n'),
        inline: false,
      },
      {
        name:  `${scenario.nameB} — \`${teamB.formation}\` — Moy. brute: **${ovrB}** — Overall: **${strB.overall}**`,
        value: [`⚡ Att: **${strB.attack}** | 🛡️ Déf: **${strB.defense}** | 🎯 Mil: **${strB.midfield}**`, '', formatCompo(teamB)].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

  // ── Stats ──
  const valid       = results.filter(r => !r.error);
  const totalGoals  = valid.reduce((s, r) => s + r.scoreA + r.scoreB, 0);
  const winsA       = valid.filter(r => r.winner === 'A').length;
  const winsB       = valid.filter(r => r.winner === 'B').length;
  const draws       = valid.filter(r => r.winner === 'draw').length;
  const cleanSheets = valid.filter(r => r.scoreA === 0 || r.scoreB === 0).length;
  const avg         = valid.length ? (totalGoals / valid.length).toFixed(2) : '0';

  const biggestWin = valid.reduce(
    (best, r) => { const d = Math.abs(r.scoreA - r.scoreB); return d > best.diff ? { diff: d, r } : best; },
    { diff: -1, r: null },
  );
  const highestScoring = valid.reduce(
    (best, r) => { const t = r.scoreA + r.scoreB; return t > best.total ? { total: t, r } : best; },
    { total: -1, r: null },
  );

  const allButeurs = {};
  for (const r of valid)
    for (const b of [...(r.buteursA || []), ...(r.buteursB || [])])
      allButeurs[b.nom] = (allButeurs[b.nom] ?? 0) + 1;

  const topButeurs = Object.entries(allButeurs)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([nom, n]) => `⚽ **${nom}** — ${n} but${n > 1 ? 's' : ''}`)
    .join('\n') || '*Aucun but marqué*';

  const resultLines = results.map(r => {
    if (r.error) return `❌ Match ${r.matchNum} — erreur : ${r.error}`;
    const icon  = r.winner === 'draw' ? '🤝' : r.winner === 'A' ? '⭐' : '🔵';
    return `${icon} M${r.matchNum} — ${scenario.nameA} **${r.scoreA}—${r.scoreB}** ${scenario.nameB} *(MT:${r.h1A}-${r.h1B})*`;
  }).join('\n');

  const anecdotes = [];
  if (biggestWin.r && biggestWin.diff > 0) {
    const r = biggestWin.r;
    anecdotes.push(`🏆 **Plus grosse victoire :** M${r.matchNum} — **${r.scoreA}-${r.scoreB}** (+${biggestWin.diff})`);
  }
  if (highestScoring.r) {
    const r = highestScoring.r;
    anecdotes.push(`🔥 **+ prolifique :** M${r.matchNum} — **${r.scoreA}-${r.scoreB}** (${highestScoring.total} buts)`);
  }

  const embedRecap = new EmbedBuilder()
    .setTitle(`📋 ${scenario.label} — Bilan ${NB_MATCHS} matchs`)
    .setDescription(resultLines || '—')
    .setColor(0x00D25B)
    .addFields(
      {
        name:  '📊 Stats',
        value: [
          `⭐ Victoires ${scenario.nameA} : **${winsA}** | 🔵 Victoires ${scenario.nameB} : **${winsB}** | 🤝 Nuls : **${draws}**`,
          `⚽ Buts totaux : **${totalGoals}** (moy. **${avg}**/match) | 🧤 Clean sheets : **${cleanSheets}**`,
          `📐 Overall: **${strA.overall}** vs **${strB.overall}** | Écart brut: **${Math.abs(ovrA - ovrB)} pt(s)**`,
          ...(anecdotes),
        ].join('\n'),
        inline: false,
      },
      {
        name:   '🥇 Top buteurs',
        value:  topButeurs,
        inline: false,
      },
    )
    .setTimestamp()
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

  return { embedCompos, embedRecap };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMANDE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

async function simMatchesCommand(interaction) {
  const config      = loadServerConfig(String(interaction.guildId));
  const matchChanId = config?.match_channel;

  if (!matchChanId) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Salon de match non configuré')
        .setDescription('Configure d\'abord un **Match Room** via `/config`.')
        .setColor(PSG_RED)
        .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON })],
      flags: MessageFlags.Ephemeral,
    });
  }

  const allCards = loadAllPlayerCards();
  const totaux   = Object.entries(allCards).map(([p, l]) => `${p}: ${l.length}`).join(' | ');

  // Minimum absolu : assez pour le scénario 'middle' qui va le plus loin dans le pool
  const minRequired = { Gardien: 5, Défenseur: 10, Milieu: 10, Attaquant: 6 };
  for (const [pos, min] of Object.entries(minRequired)) {
    if ((allCards[pos] || []).length < min) {
      return interaction.reply({
        content: `❌ Pas assez de cartes **${pos}** (besoin: ${min}, trouvé: ${(allCards[pos] || []).length}).`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  await interaction.deferReply();

  // ── Construction des équipes et simulation en parallèle ──
  const sessionData = SCENARIOS.map(scenario => {
    const formA = randFormation();
    const formB = randFormation();

    const teamA = buildTeam(allCards, formA, scenario.nameA, 'sim_team_a', 'top');
    const teamB = buildTeam(allCards, formB, scenario.nameB, 'sim_team_b', scenario.modeB);

    const strA = getTeamStrength(teamA, formA);
    const strB = getTeamStrength(teamB, formB);

    // Simulation synchrone (déjà rapide — pas d'I/O)
    const results = runSession(teamA, teamB, NB_MATCHS);

    return { scenario, teamA, teamB, strA, strB, results };
  });

  // ── Envoi des embeds pour chaque session ──
  let first = true;
  for (const { scenario, teamA, teamB, strA, strB, results } of sessionData) {
    const { embedCompos, embedRecap } = buildSessionEmbeds(scenario, teamA, teamB, strA, strB, results);

    if (first) {
      await interaction.editReply({ embeds: [embedCompos] });
      first = false;
    } else {
      await interaction.followUp({ embeds: [embedCompos] });
    }
    await interaction.followUp({ embeds: [embedRecap] });
  }

  await interaction.followUp({
    embeds: [new EmbedBuilder()
      .setDescription(`✅ 3 sessions de ${NB_MATCHS} matchs terminées — BDD: ${totaux}`)
      .setColor(PSG_BLUE)
      .setFooter({ text: `Simulé par ${interaction.user.tag}`, iconURL: PSG_FOOTER_ICON })],
  });
}

module.exports = { simMatchesCommand };