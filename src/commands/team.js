// src/commands/team.js - Système de création et gestion d'équipe PSG Dream League — V5
// CHANGEMENTS V5 :
//   - Starter pack (16 joueurs) offert directement à la 1ère création d'équipe
//   - 3 slots d'équipe (squads) par joueur
//   - Sélection de l'équipe active pour les matchs
//   - Migration transparente de l'ancien format
//
// PROTECTIONS CONCURRENCE (ajoutées) :
//   - withLock() sur handleClaimStarter → empêche le double-claim
//   - newSession() protégé → ne pas écraser une session active en cours de sélection
//   - processingUsers Set → ignore les clics en doublon / spam bouton
//   - Messages d'expiration clairs en cas de session introuvable
//
// FIX V5.1 :
//   - Ajout de 'Jr' et 'Sr' dans NAME_EXCLUDED_WORDS
//     → "Neymar Jr" s'affichait "Jr" dans les SUBS (shortCleanName prenait le dernier mot)
//     → Désormais shortCleanName("Neymar Jr") retourne "Neymar"

const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, UserSelectMenuBuilder, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');

const {
  getUserData, saveUserData,
  getTeamData, saveTeamData,
  getMatchStats,
  loadPackCards,
} = require('../utils/database');
const {
  FORMATIONS,
  getAvailableCards,
  getAvailableSubCards,
  validateTeamComposition,
  getTitulairesCount,
  getPostesOrder,
  formatFormationEmoji,
  getRarityEmoji,
  getTeamStrength,
  getCardStrength,
  formatStrengthBar,
} = require('../utils/teamHelpers');
const { PSG_BLUE, PSG_RED, PSG_FOOTER_ICON, PACKS_CONFIG } = require('../config/settings');


// ==================== VERROU ASYNC (anti race-condition) ====================

const _locks = new Map();

async function withLock(key, fn) {
  while (_locks.has(key)) {
    await _locks.get(key);
  }
  let resolve;
  const promise = new Promise(r => (resolve = r));
  _locks.set(key, promise);
  try {
    return await fn();
  } finally {
    _locks.delete(key);
    resolve();
  }
}

// ==================== MOTS EXCLUS DES NOMS ====================

const NAME_EXCLUDED_WORDS = new Set([
  'Home','Away','Third','Fourth',
  'Civil','Invictus','Héros','Hero','Legend','Légende',
  'Icon','Icône','Prime','Future','Flashback','Storyline',
  'Record','Breaker','Showdown','Headliner','Totw','Toty',
  'Community','Shapeshifter','Rulebreaker','Vintage','Tuchel','Era',
  'EDF','Starter',
  // FIX V5.1 — suffixes de noms propres mal interprétés par shortCleanName
  'Jr','Sr',
]);

function cleanName(nom) {
  if (!nom) return nom;
  const parts = nom
    .split(' ')
    .map(p => p.replace(/^\(+|\)+$/g, ''))
    .filter(p =>
      p !== '' &&
      !/^\d{2}\/\d{2}$/.test(p) &&
      !NAME_EXCLUDED_WORDS.has(p)
    );
  return parts.join(' ') || nom;
}

function shortCleanName(nom) {
  if (!nom) return nom;
  const parts = nom
    .split(' ')
    .map(p => p.replace(/^\(+|\)+$/g, ''))
    .filter(p =>
      p !== '' &&
      !/^\d{2}\/\d{2}$/.test(p) &&
      !NAME_EXCLUDED_WORDS.has(p)
    );
  return parts[parts.length - 1] || nom;
}

// ==================== SESSIONS DE CRÉATION ====================

const teamSessions = new Map();

// Set des interactions en cours de traitement — empêche le spam bouton
const processingUsers = new Set();

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of teamSessions.entries()) {
    if (s.expireAt && now > s.expireAt) teamSessions.delete(k);
  }
}, 5 * 60 * 1000);

function newSession(userId, guildId, slotIndex = 0) {
  // Protéger une session active : si l'utilisateur est en train de sélectionner
  // des joueurs (step != 'formation'), on ne lui écrase pas son travail.
  const existing = teamSessions.get(userId);
  if (existing && Date.now() < existing.expireAt && existing.step !== 'formation') {
    // On met seulement à jour le slotIndex si l'utilisateur change explicitement
    // de slot depuis l'étape formation ; sinon on retourne la session en cours.
    return existing;
  }

  teamSessions.set(userId, {
    guildId,
    userId,
    slotIndex,
    formation:   null,
    titulaires:  [],
    remplacants: [],
    step:        'formation',
    posteIndex:  0,
    playerPage:  0,
    subPage:     0,
    expireAt:    Date.now() + 20 * 60 * 1000,
  });
  return teamSessions.get(userId);
}

// Helper : réponse standardisée quand la session est expirée
function replySessionExpired(interaction) {
  const payload = {
    embeds: [new EmbedBuilder()
      .setDescription(
        '⏱️ **Ta session a expiré.**\n'
        + 'Clique à nouveau sur **✨ Créer** ou **✏️ Modifier** pour recommencer.\n'
        + '*(Les sessions expirent après 20 minutes d\'inactivité.)*',
      )
      .setColor(PSG_RED)
      .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })],
    components: [],
  };

  if (interaction.deferred) return interaction.editReply(payload);
  if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
    return interaction.update({ ...payload, flags: MessageFlags.Ephemeral }).catch(() =>
      interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }),
    );
  }
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

// ==================== HELPERS CANVAS ====================

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  let size = parseInt(ctx.font);
  while (ctx.measureText(text).width > maxWidth && size > 10) {
    size--;
    ctx.font = ctx.font.replace(/\d+px/, `${size}px`);
  }
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split('  •  ');
  const lines  = [];
  let current  = '';

  for (const word of words) {
    const test = current ? `${current}  •  ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ==================== AFFICHE D'ÉQUIPE (Canvas) ====================

async function generateTeamPoster(team, userName) {
  const W = 900;

  const measure = createCanvas(W, 100);
  const mctx    = measure.getContext('2d');

  const posOrder = ['Gardien', 'Défenseur', 'Milieu', 'Attaquant'];
  const grouped  = {};
  for (const card of team.titulaires) {
    const pos = card.position || 'Milieu';
    if (!grouped[pos]) grouped[pos] = [];
    grouped[pos].push(card);
  }

  const rowH        = 64;
  const sectionGap  = 22;
  const labelH      = 40;
  const FOOTER_H    = 100;
  const PADDING_BOT = 20;

  let estimatedY = 385;

  for (const pos of posOrder) {
    const cards = grouped[pos] || [];
    if (!cards.length) continue;
    estimatedY += labelH;
    estimatedY += cards.length * rowH;
    estimatedY += sectionGap;
  }

  let subsLineCount = 0;
  if (team.remplacants && team.remplacants.length > 0) {
    mctx.font = `bold 16px Arial, sans-serif`;
    const subsNames = team.remplacants
      .map(c => shortCleanName(c.nom))
      .join('  •  ')
      .toUpperCase();
    const subsLines = wrapText(mctx, subsNames, W - 220);
    subsLineCount   = subsLines.length;
    estimatedY += 12 + 24 + (subsLineCount * 26) + 20 + 16;
  }

  estimatedY += FOOTER_H + PADDING_BOT;
  const H = Math.max(1400, estimatedY);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Fond dégradé sombre
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0,    '#0A0E1A');
  bgGrad.addColorStop(0.45, '#0D1B3E');
  bgGrad.addColorStop(1,    '#060912');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Texture grain
  ctx.save();
  ctx.globalAlpha = 0.03;
  for (let i = 0; i < 12000; i++) {
    const gx = Math.random() * W;
    const gy = Math.random() * H;
    ctx.fillStyle = Math.random() > 0.5 ? '#FFFFFF' : '#003087';
    ctx.fillRect(gx, gy, 1, 1);
  }
  ctx.restore();

  // Splash bleu
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#003087';
  ctx.beginPath();
  ctx.moveTo(-60, H * 0.55); ctx.lineTo(180, H * 0.3);
  ctx.lineTo(220, H * 0.35); ctx.lineTo(60,  H * 0.62);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.moveTo(-40, H * 0.65); ctx.lineTo(100, H * 0.45);
  ctx.lineTo(130, H * 0.5);  ctx.lineTo(20,  H * 0.72);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // Splash rouge
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#DA020E';
  ctx.beginPath();
  ctx.moveTo(W + 40, H * 0.1);  ctx.lineTo(W - 160, H * 0.35);
  ctx.lineTo(W - 190, H * 0.28); ctx.lineTo(W + 20,  H * 0.04);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.10;
  ctx.beginPath();
  ctx.moveTo(W + 60, H * 0.18);  ctx.lineTo(W - 100, H * 0.42);
  ctx.lineTo(W - 130, H * 0.36); ctx.lineTo(W + 30,  H * 0.12);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // Ligne décorative haut
  const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
  lineGrad.addColorStop(0,   'transparent');
  lineGrad.addColorStop(0.2, '#DA020E');
  lineGrad.addColorStop(0.5, '#FFFFFF');
  lineGrad.addColorStop(0.8, '#003087');
  lineGrad.addColorStop(1,   'transparent');
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth   = 3;
  ctx.beginPath(); ctx.moveTo(40, 90); ctx.lineTo(W - 40, 90); ctx.stroke();

  // Titre
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font        = `bold 112px 'Arial Black', Arial, sans-serif`;
  ctx.fillStyle   = '#FFFFFF';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur  = 20;
  ctx.fillText('STARTING', 50, 185);
  ctx.font        = `bold 112px 'Arial Black', Arial, sans-serif`;
  ctx.fillStyle   = '#DA020E';
  ctx.shadowColor = 'rgba(218,2,14,0.5)';
  ctx.shadowBlur  = 30;
  ctx.fillText('XI', 50, 285);
  ctx.restore();

  // Badge formation + nom
  ctx.save();
  ctx.shadowColor = 'transparent';
  const formationText = team.formation || '4-3-3';
  const badgeW = 120, badgeH = 36, badgeX = 50, badgeY = 300;
  const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY);
  badgeGrad.addColorStop(0, '#DA020E');
  badgeGrad.addColorStop(1, '#FF3344');
  drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 6);
  ctx.fillStyle = badgeGrad; ctx.fill();
  ctx.font      = `bold 20px Arial, sans-serif`;
  ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
  ctx.fillText(formationText, badgeX + badgeW / 2, badgeY + 25);
  ctx.textAlign = 'left';
  ctx.font      = `bold 20px Arial, sans-serif`;
  ctx.fillStyle = '#8BAACF';
  ctx.fillText(`XI de ${userName}`.toUpperCase(), badgeX + badgeW + 18, badgeY + 25);
  ctx.restore();

  // Ligne séparatrice
  ctx.save();
  ctx.globalAlpha = 0.35; ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth   = 1;    ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(50, 358); ctx.lineTo(W - 50, 358); ctx.stroke();
  ctx.restore();

  // Liste des joueurs
  let playerNumber = 1;
  let yPos         = 385;

  for (const pos of posOrder) {
    const cards = grouped[pos] || [];
    if (!cards.length) continue;

    const barColor = pos === 'Gardien'   ? '#FFD700'
                   : pos === 'Défenseur' ? '#4A90D9'
                   : pos === 'Milieu'    ? '#5CB85C'
                   :                       '#DA020E';

    ctx.save();
    ctx.fillStyle = barColor;
    ctx.fillRect(50, yPos, 4, labelH - 8);
    ctx.font        = `bold 13px Arial, sans-serif`;
    ctx.fillStyle   = barColor; ctx.textAlign = 'left';
    ctx.letterSpacing = '4px';
    ctx.fillText(pos.toUpperCase(), 64, yPos + 23);
    const lblW = ctx.measureText(pos.toUpperCase()).width + 80;
    ctx.globalAlpha = 0.2; ctx.strokeStyle = barColor;
    ctx.lineWidth   = 1;   ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(lblW, yPos + 16); ctx.lineTo(W - 50, yPos + 16); ctx.stroke();
    ctx.restore();

    yPos += labelH;

    for (const card of cards) {
      ctx.save();
      ctx.globalAlpha = playerNumber % 2 === 0 ? 0.07 : 0.02;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(50, yPos - 12, W - 100, rowH - 2);
      ctx.restore();

      // Numéro fantôme
      ctx.save();
      ctx.font = `bold 42px 'Arial Black', Arial, sans-serif`;
      ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = 0.08; ctx.textAlign = 'right';
      ctx.fillText(String(playerNumber).padStart(2, '0'), 150, yPos + 38);
      ctx.restore();

      // Numéro visible
      ctx.save();
      ctx.font      = `bold 22px Arial, sans-serif`;
      ctx.fillStyle = playerNumber === 1 ? '#FFD700' : '#6A8FBF'; ctx.textAlign = 'left';
      ctx.fillText(String(playerNumber).padStart(2, '0'), 55, yPos + 32);
      ctx.restore();

      const displayName = cleanName(card.nom).toUpperCase();

      ctx.save();
      ctx.font        = `bold 30px 'Arial Black', Arial, sans-serif`;
      ctx.fillStyle   = '#FFFFFF'; ctx.textAlign = 'left';
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 8;
      fitText(ctx, displayName, W - 300);
      ctx.fillText(displayName, 160, yPos + 34);
      ctx.restore();

      // Badge rareté
      const rareteColor = card.rareté === 'Légendaire' ? '#FFD700'
                        : card.rareté === 'Épique'      ? '#B36AFF'
                        : card.rareté === 'Rare'        ? '#4A90D9'
                        :                                 '#6B7F92';
      ctx.save();
      const rW = 88, rH = 26, rX = W - 50 - rW, rY = yPos + 10;
      drawRoundedRect(ctx, rX, rY, rW, rH, 5);
      ctx.fillStyle = rareteColor + '28'; ctx.fill();
      ctx.strokeStyle = rareteColor; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = `bold 11px Arial, sans-serif`;
      ctx.fillStyle = rareteColor; ctx.textAlign = 'center';
      ctx.fillText((card.rareté || 'Normal').toUpperCase(), rX + rW / 2, rY + 17);
      ctx.restore();

      yPos += rowH;
      playerNumber++;
    }
    yPos += sectionGap;
  }

  // Remplaçants
  if (team.remplacants && team.remplacants.length > 0) {
    yPos += 12;
    ctx.save();
    ctx.globalAlpha = 0.3; ctx.strokeStyle = '#8BAACF';
    ctx.lineWidth   = 1;   ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(50, yPos); ctx.lineTo(W - 50, yPos); ctx.stroke();
    ctx.restore();
    yPos += 28;

    ctx.save();
    ctx.font = `bold 13px Arial, sans-serif`;
    ctx.fillStyle = '#6A8FBF'; ctx.textAlign = 'left'; ctx.letterSpacing = '3px';
    ctx.fillText('SUBS :', 55, yPos);
    ctx.restore();

    const subsNames = team.remplacants
      .map(c => shortCleanName(c.nom))
      .join('  •  ').toUpperCase();

    ctx.save();
    ctx.font = `bold 16px Arial, sans-serif`;
    ctx.fillStyle = '#AABBDD'; ctx.textAlign = 'left'; ctx.letterSpacing = '1px';
    const subsLineH = 26;
    const subsLines = wrapText(ctx, subsNames, W - 220);
    let   subsY     = yPos;
    for (const line of subsLines) {
      ctx.fillText(line, 130, subsY);
      subsY += subsLineH;
    }
    ctx.restore();
    yPos = Math.max(yPos + subsLineH, subsY) + 16;
  }

  // Ligne bas
  yPos += 20;
  const lineGrad2 = ctx.createLinearGradient(0, 0, W, 0);
  lineGrad2.addColorStop(0,   'transparent');
  lineGrad2.addColorStop(0.2, '#DA020E');
  lineGrad2.addColorStop(0.5, '#FFFFFF');
  lineGrad2.addColorStop(0.8, '#003087');
  lineGrad2.addColorStop(1,   'transparent');
  ctx.strokeStyle = lineGrad2; ctx.lineWidth = 3; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(40, yPos); ctx.lineTo(W - 40, yPos); ctx.stroke();

  // Pied de page
  ctx.save();
  ctx.font = `bold 15px Arial, sans-serif`;
  ctx.fillStyle = '#8BAACF'; ctx.textAlign = 'center'; ctx.letterSpacing = '3px';
  ctx.fillText('PARIS SAINT-GERMAIN  •  PSG DREAM LEAGUE', W / 2, yPos + 35);
  ctx.restore();

  return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'equipe.png' });
}

// ==================== EMBED PRINCIPAL TEAM ROOM ====================

async function sendTeamRoomEmbed(channel) {
  const embed = new EmbedBuilder()
    .setTitle('Matchmaking ⚽')
    .setDescription(
      '**Construis ton équipe de rêve et affronte les autres membres !**\n\n'
      + '👕 **Mon Équipe**\n'
      + 'Crée ou modifie tes équipes (jusqu\'à 3 effectifs), consulte tes compos, ou jette un œil à celle d\'un adversaire.\n\n'
      + '⚔️ **Match**\n'
      + 'Lance un défi à un autre membre qui possède une équipe.\n\n'
      + '──────────────────────────\n'
      + '💬 **Venez discuter des matchs et des équipes de PSG Dream League dans <#1326910792146354318> !**',
    )
    .setColor(PSG_BLUE)
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tr_equipe').setLabel('👕 Mon Équipe').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('tr_match').setLabel('⚔️ Match').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('tr_soon').setLabel('…').setStyle(ButtonStyle.Secondary),
    ),
  ];

  return channel.send({ embeds: [embed], components });
}

// ==================== BOUTON : MON ÉQUIPE (V5 — affiche les 3 slots) ====================

async function handleEquipe(interaction) {
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;
  const td      = getTeamData(guildId, userId);
  const { squads, activeSquad } = td;
  const userData      = getUserData(guildId, userId);
  const starterClaimed = userData.starterClaimed === true;

  // Résumé des 3 slots
  const squadLines = [0, 1, 2].map(i => {
    const sq      = squads[i];
    const isActive = i === activeSquad;
    const activeTag = isActive ? ' ── 🟢 **ACTIF**' : '';
    if (sq) {
      const str = getTeamStrength(sq, sq.formation);
      return `**Slot ${i + 1}** — ${sq.name ?? `Équipe ${i + 1}`} *(${sq.formation})* | ⚡${Math.round(str.attack)} 🛡️${Math.round(str.defense)} 🎯${Math.round(str.midfield)}${activeTag}`;
    }
    return `**Slot ${i + 1}** — *Vide*`;
  });

  const hasAnyTeam = squads.some(s => s !== null);

  let description = squadLines.join('\n')
    + '\n\n'
    + (hasAnyTeam
      ? 'Sélectionne un slot pour **créer/modifier** une équipe.\nL\'équipe **🟢 Active** est celle utilisée pour les matchs.'
      : 'Tu n\'as pas encore d\'équipe !\nClique sur **✨ Créer slot 1** pour commencer.');

  if (!starterClaimed) {
    description += '\n\n🎖️ **Pack Starter disponible !** Clique sur le bouton vert ci-dessous pour recevoir tes **16 premiers joueurs gratuitement** (une seule fois).';
  }

  const embed = new EmbedBuilder()
    .setTitle('👕 Mes Équipes')
    .setDescription(description)
    .setColor(PSG_BLUE)
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

  // Ligne 1 : boutons créer/modifier les 3 slots
  const slotButtons = new ActionRowBuilder().addComponents(
    [0, 1, 2].map(i =>
      new ButtonBuilder()
        .setCustomId(`tr_edit_squad_${i}_${userId}`)
        .setLabel(squads[i] ? `✏️ Modifier slot ${i + 1}` : `✨ Créer slot ${i + 1}`)
        .setStyle(squads[i] ? ButtonStyle.Primary : ButtonStyle.Success),
    ),
  );

  const rows = [slotButtons];

  // Ligne 2 : bouton Pack Starter si pas encore réclamé
  if (!starterClaimed) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tr_claim_starter_${userId}`)
        .setLabel('🎖️ Pack Starter — 0 🪙')
        .setStyle(ButtonStyle.Success),
    ));
  }

  // Ligne suivante : boutons "Activer" pour les slots remplis non actifs
  const activateCandidates = [0, 1, 2].filter(i => squads[i] && i !== activeSquad);
  if (activateCandidates.length) {
    const activateButtons = activateCandidates.map(i =>
      new ButtonBuilder()
        .setCustomId(`tr_activate_squad_${i}_${userId}`)
        .setLabel(`🟢 Activer Slot ${i + 1}`)
        .setStyle(ButtonStyle.Secondary),
    );
    if (squads[activeSquad]) {
      activateButtons.push(
        new ButtonBuilder()
          .setCustomId(`tr_view_team_self_${userId}`)
          .setLabel('📋 Voir équipe active')
          .setStyle(ButtonStyle.Danger),
      );
    }
    rows.push(new ActionRowBuilder().addComponents(activateButtons));
  } else if (squads[activeSquad]) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tr_view_team_self_${userId}`)
        .setLabel('📋 Voir mon équipe')
        .setStyle(ButtonStyle.Danger),
    ));
  }

  // Dernière ligne : voir l'équipe d'un autre membre
  // Discord limite à 5 ActionRows max — on vérifie avant d'ajouter
  if (rows.length < 5) {
    rows.push(new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`tr_view_team_other_${userId}`)
        .setPlaceholder('👤 Voir l\'équipe d\'un membre...')
        .setMinValues(1).setMaxValues(1),
    ));
  }

  return interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
}

// ==================== BOUTON : TEASER ====================

async function handleSoon(interaction) {
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setDescription('🔴🔵 **Prochains modes de jeu en préparation…**\n\nRestez connectés — de grandes choses arrivent !')
      .setColor(PSG_RED)
      .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })],
    flags: MessageFlags.Ephemeral,
  });
}

// ==================== ACTIVER UN SQUAD ====================

async function handleActivateSquad(interaction, slotIndex) {
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;
  const td      = getTeamData(guildId, userId);

  if (!td.squads[slotIndex]) {
    return interaction.reply({ content: '❌ Ce slot est vide.', flags: MessageFlags.Ephemeral });
  }

  td.activeSquad = slotIndex;
  saveTeamData(guildId, userId, td);

  const sq = td.squads[slotIndex];
  return interaction.update({
    embeds: [new EmbedBuilder()
      .setTitle('✅ Équipe active mise à jour')
      .setDescription(
        `Le **Slot ${slotIndex + 1}** — *${sq.name ?? `Équipe ${slotIndex + 1}`}* (${sq.formation})\n`
        + `est maintenant ton effectif **actif** pour les matchs.`,
      )
      .setColor(0x00D25B)
      .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })],
    components: [],
  });
}

// ==================== CLAIM STARTER PACK ====================

async function handleClaimStarter(interaction) {
  const userId   = interaction.user.id;
  const guildId  = interaction.guildId;

  // Acquitter immédiatement Discord pour éviter le timeout de 3 s
  // pendant que le verrou s'exécute
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  return withLock(`starter:${guildId}:${userId}`, async () => {
    // Re-lire les données DANS le verrou pour avoir la version la plus fraîche
    const userData = getUserData(guildId, userId);

    if (userData.starterClaimed === true) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Pack Starter déjà réclamé')
          .setDescription('Tu as déjà récupéré ton Pack Starter !\nCe pack n\'est disponible **qu\'une seule fois** par joueur.')
          .setColor(PSG_RED)
          .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })],
      });
    }

    const starterCards = loadPackCards('starter_pack');

    if (!starterCards || starterCards.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Pack Starter introuvable')
          .setDescription('Le fichier `pack_starter.json` est absent ou vide. Contacte un administrateur.')
          .setColor(PSG_RED)
          .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })],
      });
    }

    // Ajouter les cartes et marquer comme réclamé
    for (const card of starterCards) {
      userData.collection.push({ ...card });
    }
    userData.starterClaimed = true;
    saveUserData(guildId, userId, userData);

    // Groupement par position pour l'affichage
    const byPosition = {};
    for (const c of starterCards) {
      if (!byPosition[c.position]) byPosition[c.position] = [];
      byPosition[c.position].push(cleanName(c.nom));
    }
    const posOrder  = ['Gardien', 'Défenseur', 'Milieu', 'Attaquant'];
    const posEmoji  = { Gardien: '🧤', Défenseur: '🛡️', Milieu: '⚙️', Attaquant: '⚽' };
    const posPlural = { Gardien: 'Gardiens', Défenseur: 'Défenseurs', Milieu: 'Milieux', Attaquant: 'Attaquants' };

    const groupedLines = posOrder
      .filter(p => byPosition[p])
      .map(p => `${posEmoji[p]} **${posPlural[p]}** : ${byPosition[p].join(', ')}`)
      .join('\n');

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('🎖️ Pack Starter réclamé !')
        .setDescription(
          `Tu as reçu **${starterCards.length} joueurs Basic** !\n\n`
          + groupedLines
          + `\n\n⚪ **Stats communes** : 60 / 60 / 60\n`
          + `🪙 Solde actuel : **${userData.coins} PSG Coins**\n\n`
          + `Tu peux maintenant créer ton équipe depuis **👕 Mon Équipe** !`,
        )
        .setColor(0x00D25B)
        .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })],
    });
  });
}

// ==================== CRÉATION / MODIFICATION D'UN SLOT ====================

async function handleEditSquad(interaction, slotIndex) {
  const userId   = interaction.user.id;
  const guildId  = interaction.guildId;
  const userData = getUserData(guildId, userId);
  const joueurs  = (userData.collection || []).filter(c => c.type === 'joueur');
  const uniqueIds = new Set(joueurs.map(c => c.id));

  if (uniqueIds.size < 16) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Collection insuffisante')
        .setDescription(
          `Il te faut au moins **16 cartes joueurs différentes** pour créer une équipe.\n`
          + `Tu en as actuellement **${uniqueIds.size}**.\n\n`
          + (!userData.starterClaimed
            ? '🎖️ Clique sur le bouton **"Récupérer mon Pack Starter"** pour obtenir 16 joueurs gratuitement !'
            : 'Ouvre des packs dans la Gaming Room pour en obtenir davantage !'),
        )
        .setColor(PSG_RED)
        .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON })],
      flags: MessageFlags.Ephemeral,
    });
  }

  // Forcer une nouvelle session pour ce slot (le guard de newSession ne bloque
  // que si on est en milieu de sélection sur le MÊME slot ; ici on démarre
  // explicitement, donc on réinitialise proprement)
  teamSessions.delete(userId);
  newSession(userId, guildId, slotIndex);

  const embed = new EmbedBuilder()
    .setTitle(`✨ Slot ${slotIndex + 1} — Choix de la formation`)
    .setDescription('Sélectionne ta **formation tactique**.\nCelle-ci définira automatiquement ton **style de jeu**.')
    .setColor(PSG_BLUE)
    .setFooter({ text: `Slot ${slotIndex + 1} • Étape 1/3 • Paris Saint-Germain`, iconURL: PSG_FOOTER_ICON });

  for (const [, f] of Object.entries(FORMATIONS)) {
    embed.addFields({ name: `${f.label} — ${f.styleLabel}`, value: f.description, inline: true });
  }

  const options = Object.entries(FORMATIONS).map(([key, f]) => ({
    label: f.label,
    description: f.styleLabel,
    value: key,
  }));

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tr_select_formation_${userId}`)
      .setPlaceholder('Choisis ta formation...')
      .addOptions(options),
  );

  if (interaction.isButton()) {
    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }
  return interaction.update({ embeds: [embed], components: [row] });
}

// ==================== CRÉATION D'ÉQUIPE : SÉLECTION FORMATION ====================

async function handleSelectFormation(interaction) {
  const userId    = interaction.user.id;
  const formation = interaction.values[0];
  const session   = teamSessions.get(userId);

  if (!session) return replySessionExpired(interaction);

  session.formation  = formation;
  session.titulaires = [];
  session.posteIndex = 0;
  session.playerPage = 0;
  session.step       = 'titulaires';

  return sendPosteStep(interaction, session, true);
}

// ==================== HELPER : répondre selon l'état de l'interaction ====================

async function safeReply(interaction, payload, isUpdate = false) {
  if (interaction.deferred) return interaction.editReply(payload);
  if (isUpdate)             return interaction.update(payload);
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

// ==================== ÉTAPE POSTE (avec pagination) ====================

async function sendPosteStep(interaction, session, isUpdate = false) {
  const { userId, guildId, formation, titulaires, posteIndex, playerPage, slotIndex } = session;
  const postes = getPostesOrder(formation);
  const poste  = postes[posteIndex];
  const total  = postes.length;

  const userData = getUserData(guildId, userId);
  const excludeIds = titulaires.map(c => c.id);

  const { cards: available, totalPages, total: totalCards } = getAvailableCards(
    userData.collection || [], poste, excludeIds, playerPage,
  );

  const embed = new EmbedBuilder()
    .setTitle(`✨ Slot ${slotIndex + 1} — Titulaires ${posteIndex + 1}/${total}`)
    .setDescription(
      `Sélectionne ton **${poste}** (poste ${posteIndex + 1}/${total})\n\n`
      + `Formation : **${formation}** — ${formatFormationEmoji(formation)}\n`
      + `Déjà sélectionné : ${titulaires.length} joueur(s)\n`
      + (totalPages > 1 ? `\nPage **${playerPage + 1}/${totalPages}** — ${totalCards} cartes disponibles` : ''),
    )
    .setColor(PSG_BLUE)
    .setFooter({ text: `Slot ${slotIndex + 1} • Étape 2/3 — Titulaires • Expire dans 20 min`, iconURL: PSG_FOOTER_ICON });

  if (!available.length) {
    embed.addFields({
      name: '⚠️ Aucune carte disponible',
      value: `Tu n\'as pas de carte **${poste}** dans ta collection.\nOuvre des packs pour en obtenir !`,
    });
    return safeReply(interaction, { embeds: [embed], components: [] }, isUpdate);
  }

  const rows = [];

  rows.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`tr_select_player_${userId}`)
      .setPlaceholder(`${poste} — Choisis un joueur... (meilleurs en premier)`)
      .addOptions(available.map(c => {
        const strength = Math.round(getCardStrength(c));
        return {
          label: cleanName(c.nom).slice(0, 100),
          description: `${getRarityEmoji(c.rareté)} ${c.rareté} • Force : ${strength}`.slice(0, 100),
          value: c.id,
        };
      })),
  ));

  if (totalPages > 1) {
    const navButtons = [
      new ButtonBuilder()
        .setCustomId(`tr_player_prev_${userId}`)
        .setLabel('◀ Précédent')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(playerPage === 0),
      new ButtonBuilder()
        .setCustomId(`tr_player_next_${userId}`)
        .setLabel('Suivant ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(playerPage >= totalPages - 1),
    ];
    rows.push(new ActionRowBuilder().addComponents(navButtons));
  }

  return safeReply(interaction, { embeds: [embed], components: rows }, isUpdate);
}

// ── Navigation pages titulaires ──────────────────────────────────────────────

async function handlePlayerPageNav(interaction, direction) {
  const userId  = interaction.user.id;
  const session = teamSessions.get(userId);
  if (!session) return replySessionExpired(interaction);

  await interaction.deferUpdate();
  session.playerPage = Math.max(0, session.playerPage + direction);
  return sendPosteStep(interaction, session, true);
}

// ── Sélection d'un titulaire ─────────────────────────────────────────────────

async function handleSelectPlayer(interaction) {
  const userId  = interaction.user.id;
  const session = teamSessions.get(userId);
  if (!session) return replySessionExpired(interaction);

  await interaction.deferUpdate();

  const cardId   = interaction.values[0];
  const userData = getUserData(session.guildId, userId);
  const card     = (userData.collection || []).find(c => c.id === cardId);

  if (!card) return interaction.editReply({ content: '❌ Carte introuvable.', embeds: [], components: [] });
  if (session.titulaires.some(c => c.id === cardId)) {
    return interaction.editReply({ content: '❌ Cette carte est déjà sélectionnée.', embeds: [], components: [] });
  }

  const legendsInTitulaires = session.titulaires.filter(c => c.rareté === 'Legend').length;
  if (card.rareté === 'Legend' && legendsInTitulaires >= 1) {
    return interaction.editReply({
      content: '❌ Tu ne peux avoir qu\'**une seule carte Legend** dans ton équipe (titulaires + remplaçants).',
      embeds: [],
      components: [],
    });
  }

  session.titulaires.push(card);
  session.posteIndex++;
  session.playerPage = 0;

  const postes = getPostesOrder(session.formation);
  if (session.posteIndex < postes.length) return sendPosteStep(interaction, session, true);

  session.step    = 'remplacants';
  session.subPage = 0;
  return sendRemplacantStep(interaction, session);
}

// ==================== CRÉATION D'ÉQUIPE : REMPLAÇANTS ====================

async function sendRemplacantStep(interaction, session) {
  const { userId, guildId, titulaires, remplacants, subPage, slotIndex } = session;
  const excludeIds = [...titulaires.map(c => c.id), ...remplacants.map(c => c.id)];

  const userData = getUserData(guildId, userId);
  const { cards: available, totalPages, total: totalCards } = getAvailableSubCards(
    userData.collection || [], excludeIds, subPage,
  );

  const remaining = 5 - remplacants.length;

  const embed = new EmbedBuilder()
    .setTitle(`✨ Slot ${slotIndex + 1} — Remplaçants ${remplacants.length}/5`)
    .setDescription(
      `Sélectionne **exactement 5 remplaçants** depuis ta collection (tous postes).\n`
      + `Les 5 remplaçants sont **obligatoires** pour valider ton équipe.\n\n`
      + `Déjà sélectionnés : ${remplacants.length ? remplacants.map(c => shortCleanName(c.nom)).join(', ') : 'Aucun'}\n`
      + `Il te reste **${remaining}** remplaçant(s) à choisir.`
      + (totalPages > 1 ? `\n\nPage **${subPage + 1}/${totalPages}** — ${totalCards} cartes disponibles` : ''),
    )
    .setColor(PSG_BLUE)
    .setFooter({ text: `Slot ${slotIndex + 1} • Étape 3/3 — Remplaçants • Expire dans 20 min`, iconURL: PSG_FOOTER_ICON });

  const rows = [];

  if (available.length && remplacants.length < 5) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`tr_select_remplacant_${userId}`)
        .setPlaceholder('Ajouter un remplaçant... (meilleurs en premier)')
        .addOptions(available.map(c => {
          const strength = Math.round(getCardStrength(c));
          return {
            label: cleanName(c.nom).slice(0, 100),
            description: `${getRarityEmoji(c.rareté)} ${c.rareté} • ${c.position} • Force : ${strength}`.slice(0, 100),
            value: c.id,
          };
        })),
    ));
  }

  const actionButtons = [];

  if (totalPages > 1) {
    actionButtons.push(
      new ButtonBuilder()
        .setCustomId(`tr_sub_prev_${userId}`)
        .setLabel('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(subPage === 0),
      new ButtonBuilder()
        .setCustomId(`tr_sub_next_${userId}`)
        .setLabel('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(subPage >= totalPages - 1),
    );
  }

  actionButtons.push(
    new ButtonBuilder()
      .setCustomId(`tr_validate_team_${userId}`)
      .setLabel(remplacants.length < 5 ? `✅ Valider (${remplacants.length}/5 remplaçants)` : '✅ Valider l\'équipe')
      .setStyle(ButtonStyle.Success)
      .setDisabled(remplacants.length < 5),
  );

  rows.push(new ActionRowBuilder().addComponents(actionButtons));

  const payload = { embeds: [embed], components: rows };
  if (interaction.deferred) return interaction.editReply(payload);
  return interaction.editReply(payload);
}

async function handleSubPageNav(interaction, direction) {
  const userId  = interaction.user.id;
  const session = teamSessions.get(userId);
  if (!session) return replySessionExpired(interaction);

  await interaction.deferUpdate();
  session.subPage = Math.max(0, session.subPage + direction);
  return sendRemplacantStep(interaction, session);
}

async function handleSelectRemplacant(interaction) {
  const userId  = interaction.user.id;
  const session = teamSessions.get(userId);
  if (!session) return replySessionExpired(interaction);

  await interaction.deferUpdate();

  const cardId   = interaction.values[0];
  const userData = getUserData(session.guildId, userId);
  const card     = (userData.collection || []).find(c => c.id === cardId);
  if (!card) return;

  if (session.remplacants.some(c => c.id === cardId)) return sendRemplacantStep(interaction, session);

  const legendsAlready = [
    ...session.titulaires,
    ...session.remplacants,
  ].filter(c => c.rareté === 'Legend').length;

  if (card.rareté === 'Legend' && legendsAlready >= 1) {
    return interaction.editReply({
      content: '❌ Tu ne peux avoir qu\'**une seule carte Legend** dans ton équipe (titulaires + remplaçants).',
      embeds: [],
      components: [],
    });
  }

  session.remplacants.push(card);
  return sendRemplacantStep(interaction, session);
}

// ==================== VALIDATION ====================

async function handleValidateTeam(interaction) {
  const userId  = interaction.user.id;
  const session = teamSessions.get(userId);
  if (!session) return replySessionExpired(interaction);

  await interaction.deferUpdate();

  const { valid, errors } = validateTeamComposition(session.titulaires, session.formation, session.remplacants);

  if (!valid) {
    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Composition invalide')
        .setDescription(errors.join('\n'))
        .setColor(PSG_RED)],
      components: [],
    });
  }

  // Sauvegarder dans le bon slot avec un verrou pour éviter l'écrasement concurrent
  const guildId  = session.guildId;
  const slotIndex = session.slotIndex ?? 0;

  await withLock(`squad:${guildId}:${userId}:${slotIndex}`, async () => {
    const td       = getTeamData(guildId, userId);
    const slotName = `Équipe ${slotIndex + 1}`;

    const squadData = {
      name:        slotName,
      formation:   session.formation,
      titulaires:  session.titulaires,
      remplacants: session.remplacants,
      updatedAt:   new Date().toISOString(),
    };

    td.squads[slotIndex] = squadData;

    // Si c'est le premier squad créé → l'activer automatiquement
    const filledCount = td.squads.filter(Boolean).length;
    if (filledCount === 1) td.activeSquad = slotIndex;

    saveTeamData(guildId, userId, td);
  });

  teamSessions.delete(userId);

  const td       = getTeamData(guildId, userId);
  const isActive = td.activeSquad === slotIndex;

  const member   = await interaction.guild.members.fetch(userId).catch(() => null);
  const userName = member?.displayName || interaction.user.username;

  const squadData = td.squads[slotIndex];

  const embed = new EmbedBuilder()
    .setTitle(`✅ Slot ${slotIndex + 1} sauvegardé !`)
    .setDescription(
      `Ton équipe **${squadData.formation}** (Slot ${slotIndex + 1}) est prête !\n`
      + (isActive ? '🟢 **Cette équipe est maintenant ton effectif actif pour les matchs.**\n' : '')
      + `\n**Titulaires :** ${session.titulaires.map(c => shortCleanName(c.nom)).join(', ')}\n`
      + `**Remplaçants :** ${session.remplacants.map(c => shortCleanName(c.nom)).join(', ')}`,
    )
    .setColor(0x00D25B)
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

  const poster    = await generateTeamPoster(squadData, userName);
  const replyOpts = { embeds: [embed], components: [] };
  if (poster) {
    embed.setImage('attachment://equipe.png');
    replyOpts.files = [poster];
  }

  return interaction.editReply(replyOpts);
}

// ==================== VOIR UNE ÉQUIPE ====================

async function handleViewTeamSelf(interaction) {
  const userId = interaction.user.id;
  return showTeam(interaction, userId, interaction.user.username, true);
}

async function handleViewTeamOther(interaction) {
  const targetUser = interaction.users.first();
  if (!targetUser) return interaction.reply({ content: '❌ Membre introuvable.', flags: MessageFlags.Ephemeral });
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  return showTeam(interaction, targetUser.id, member?.displayName || targetUser.username, false);
}

// ==================== HELPER : BLOC STATS MATCH ====================

function buildMatchStatsField(guildId, userId) {
  const s = getMatchStats(guildId, userId);
  if (!s || s.played === 0) {
    return { name: '📊 Statistiques matchs', value: '*Aucun match joué pour l\'instant.*', inline: false };
  }

  const winRate = s.played > 0 ? Math.round((s.won / s.played) * 100) : 0;
  const filled  = Math.round((s.won / s.played) * 10);
  const bar     = '🟩'.repeat(filled) + '⬛'.repeat(10 - filled);

  const value = [
    `🎮 **Matchs joués :** ${s.played}`,
    `🏆 **Victoires :** ${s.won}`,
    `🤝 **Nuls :** ${s.drawn}`,
    `❌ **Défaites :** ${s.lost}`,
    `📈 **Win rate :** ${winRate}% ${bar}`,
  ].join('\n');

  return { name: '📊 Statistiques matchs', value, inline: false };
}

// ==================== AFFICHAGE ÉQUIPE ====================

async function showTeam(interaction, targetId, targetName, isSelf = false) {
  const guildId = interaction.guildId;
  const td      = getTeamData(guildId, targetId);

  const activeSquad = td.squads[td.activeSquad] ?? null;

  if (!activeSquad || !activeSquad.titulaires || !activeSquad.titulaires.length) {
    const opts = {
      embeds: [new EmbedBuilder()
        .setTitle(`👕 Équipe de ${targetName}`)
        .setDescription(isSelf
          ? 'Tu n\'as pas encore d\'équipe active. Crée-en une !'
          : `**${targetName}** n\'a pas encore d\'équipe active.`)
        .setColor(PSG_BLUE)
        .setFooter({ text: 'Paris Saint-Germain', iconURL: PSG_FOOTER_ICON })],
      components: [],
    };
    if (interaction.isUserSelectMenu() || interaction.isButton()) return interaction.update(opts);
    return interaction.reply({ ...opts, flags: MessageFlags.Ephemeral });
  }

  const str = getTeamStrength(activeSquad, activeSquad.formation);

  const embed = new EmbedBuilder()
    .setTitle(`👕 Équipe de ${targetName} — ${activeSquad.name ?? 'Équipe active'} 🟢`)
    .setDescription(`Formation : **${activeSquad.formation}** — ${formatFormationEmoji(activeSquad.formation)}`)
    .setColor(PSG_BLUE)
    .addFields(
      {
        name: '🏃 Titulaires',
        value: activeSquad.titulaires.map(c =>
          `${getRarityEmoji(c.rareté)} **${cleanName(c.nom)}** — ${c.position}`,
        ).join('\n'),
        inline: false,
      },
      {
        name: '🔄 Remplaçants',
        value: activeSquad.remplacants?.length
          ? activeSquad.remplacants.map(c => `• ${shortCleanName(c.nom)}`).join(', ')
          : 'Aucun',
        inline: false,
      },
      { name: '⚡ Force attaque',  value: `${Math.round(str.attack)}`,   inline: true },
      { name: '🛡️ Force défense', value: `${Math.round(str.defense)}`,  inline: true },
      { name: '🎯 Force milieu',  value: `${Math.round(str.midfield)}`, inline: true },
      buildMatchStatsField(guildId, targetId),
    )
    .setFooter({ text: 'Paris Saint-Germain • PSG Dream League', iconURL: PSG_FOOTER_ICON });

  const poster = await generateTeamPoster(activeSquad, targetName);
  const opts   = { embeds: [embed], components: [] };
  if (poster) { embed.setImage('attachment://equipe.png'); opts.files = [poster]; }

  if (interaction.isUserSelectMenu() || interaction.isButton()) return interaction.update(opts);
  return interaction.reply({ ...opts, flags: MessageFlags.Ephemeral });
}

// ==================== ROUTEUR INTERACTIONS ====================

function extractOwner(customId) {
  const match = customId.match(/(\d{17,20})$/);
  return match ? match[1] : null;
}

async function routeInteraction(interaction) {
  const { customId } = interaction;

  const checkOwner = (id) => {
    if (interaction.user.id !== id) {
      interaction.reply({ content: "❌ Ce n'est pas ta vue !", flags: MessageFlags.Ephemeral });
      return false;
    }
    return true;
  };

  if (customId.startsWith('tr_claim_starter_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handleClaimStarter(interaction);
  }

  if (customId.startsWith('tr_edit_squad_')) {
    const m = customId.match(/^tr_edit_squad_(\d)_(\d{17,20})$/);
    if (!m) return;
    const [, slotStr, ownerId] = m;
    if (!checkOwner(ownerId)) return;
    return handleEditSquad(interaction, parseInt(slotStr));
  }

  if (customId.startsWith('tr_activate_squad_')) {
    const m = customId.match(/^tr_activate_squad_(\d)_(\d{17,20})$/);
    if (!m) return;
    const [, slotStr, ownerId] = m;
    if (!checkOwner(ownerId)) return;
    return handleActivateSquad(interaction, parseInt(slotStr));
  }

  if (customId.startsWith('tr_view_team_self_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handleViewTeamSelf(interaction);
  }

  if (customId.startsWith('tr_view_team_other_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handleViewTeamOther(interaction);
  }

  if (customId.startsWith('tr_select_formation_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handleSelectFormation(interaction);
  }

  if (customId.startsWith('tr_select_player_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handleSelectPlayer(interaction);
  }

  if (customId.startsWith('tr_player_prev_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handlePlayerPageNav(interaction, -1);
  }

  if (customId.startsWith('tr_player_next_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handlePlayerPageNav(interaction, +1);
  }

  if (customId.startsWith('tr_select_remplacant_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handleSelectRemplacant(interaction);
  }

  if (customId.startsWith('tr_sub_prev_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handleSubPageNav(interaction, -1);
  }

  if (customId.startsWith('tr_sub_next_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handleSubPageNav(interaction, +1);
  }

  if (customId.startsWith('tr_validate_team_')) {
    const ownerId = extractOwner(customId);
    if (!checkOwner(ownerId)) return;
    return handleValidateTeam(interaction);
  }
}

// ==================== POINT D'ENTRÉE PRINCIPAL ====================
// Toutes les interactions passent par ici. Le Set processingUsers garantit
// qu'une même clé (userId + customId) n'est traitée qu'une seule fois à la fois.

async function handleTeamInteraction(interaction) {
  const userId = interaction.user.id;
  const key    = `${userId}:${interaction.customId}`;

  // Si cette interaction exacte est déjà en vol, on l'acquitte sans rien faire
  // pour éviter "Cette interaction a échoué" côté Discord.
  if (processingUsers.has(key)) {
    return interaction.deferUpdate().catch(() => {});
  }

  processingUsers.add(key);
  try {
    await routeInteraction(interaction);
  } catch (err) {
    console.error(`[team] Erreur interaction ${key} :`, err);
    // Tenter de répondre avec un message d'erreur générique
    const errPayload = {
      content: '❌ Une erreur inattendue est survenue. Réessaie dans quelques secondes.',
      flags: MessageFlags.Ephemeral,
    };
    try {
      if (interaction.deferred) await interaction.editReply(errPayload);
      else await interaction.reply(errPayload);
    } catch (_) { /* interaction déjà répondue ou expirée */ }
  } finally {
    processingUsers.delete(key);
  }
}

module.exports = {
  sendTeamRoomEmbed,
  handleEquipe,
  handleSoon,
  handleTeamInteraction,
  generateTeamPoster,
};